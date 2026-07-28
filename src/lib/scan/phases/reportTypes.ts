import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import { API_VERSION } from "@/lib/constants";
import { makeObjectResolver, type TrackedField } from "@/lib/salesforce/resolver";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";
import { loadCustomFieldIndex } from "@/lib/scan/phases/shared";

/**
 * Phase 8 — custom report types.
 * Port of scan_report_types in salesforce/jobs/ingest_field_references.py.
 *
 * A field exposed by a custom report type blocks deletion even when no report
 * currently uses it, so omitting this phase produces confidently wrong "0 deps"
 * verdicts. It is also the only phase requiring the SOAP Metadata API, and
 * therefore the one most likely to fail on permissions — which is handled by
 * degrading and disclosing, never by pretending the count is complete.
 *
 * Two hard-won constraints from the production job, both preserved here:
 *   - readMetadata is NOT usable. It silently returns sections without columns
 *     for some report types (~9 of 60 in one org, one of them hiding 173
 *     custom-field columns). Only retrieve is complete.
 *   - Members must be listed explicitly. The "*" wildcard excludes
 *     managed-package report types.
 *
 * retrieve is asynchronous, so this phase spans ticks: it fires the request,
 * stores the async job id in its cursor, and polls on subsequent ticks instead
 * of blocking an invocation for three minutes.
 */

const MAX_POLLS = 90;
const VERSION = API_VERSION.replace(/^v/, "");

const parser = new XMLParser({
  ignoreAttributes: true,
  // Namespace prefixes vary between the SOAP envelope and the package XML;
  // stripping them lets one set of selectors read both.
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export async function runReportTypes(ctx: PhaseContext): Promise<PhaseResult> {
  const stage = (ctx.cursor.stage as string) ?? "start";

  if (stage === "start") return startRetrieve(ctx);
  return pollRetrieve(ctx);
}

async function startRetrieve(ctx: PhaseContext): Promise<PhaseResult> {
  const listed = await listReportTypes(ctx);
  if (listed.size === 0) {
    ctx.log("No custom report types in this org");
    return { done: true, total: 0, scanned: 0, failed: 0 };
  }

  const members = [...listed.keys()]
    .map((name) => `<met:members>${escapeXml(name)}</met:members>`)
    .join("");

  const response = await ctx.sf.metadataSoap(
    "<met:retrieve><met:retrieveRequest>" +
      `<met:apiVersion>${VERSION}</met:apiVersion>` +
      "<met:singlePackage>true</met:singlePackage>" +
      `<met:unpackaged><met:types>${members}<met:name>ReportType</met:name></met:types>` +
      `<met:version>${VERSION}</met:version></met:unpackaged>` +
      "</met:retrieveRequest></met:retrieve>",
  );

  const jobId = /<id>([^<]+)<\/id>/.exec(response)?.[1];
  if (!jobId) {
    throw new Error(`retrieve request returned no job id: ${response.slice(0, 300)}`);
  }

  ctx.log(`ReportType retrieve started for ${listed.size} types (job ${jobId})`);
  return {
    done: false,
    cursor: {
      stage: "poll",
      jobId,
      polls: 0,
      ids: Object.fromEntries(listed),
    },
    total: listed.size,
  };
}

async function pollRetrieve(ctx: PhaseContext): Promise<PhaseResult> {
  const jobId = ctx.cursor.jobId as string;
  const ids = (ctx.cursor.ids ?? {}) as Record<string, string>;
  let polls = Number(ctx.cursor.polls ?? 0);
  const total = Object.keys(ids).length;

  // Poll within this tick until the deadline, then hand the job id to the next
  // one. The retrieve keeps running on Salesforce's side either way.
  while (!outOfTime(ctx, 5_000) && polls < MAX_POLLS) {
    polls++;
    await sleep(2_000);

    const status = await ctx.sf.metadataSoap(
      `<met:checkRetrieveStatus><met:asyncProcessId>${jobId}</met:asyncProcessId>` +
        "<met:includeZip>true</met:includeZip></met:checkRetrieveStatus>",
    );

    if (!status.includes("<done>true</done>")) continue;

    const zipB64 = /<zipFile>([^<]+)<\/zipFile>/.exec(status)?.[1];
    if (!zipB64) {
      throw new Error(`retrieve finished without a zipFile: ${status.slice(0, 300)}`);
    }
    return parseArchive(ctx, zipB64, ids, total);
  }

  if (polls >= MAX_POLLS) {
    throw new Error(`ReportType retrieve did not complete after ${MAX_POLLS} polls`);
  }

  return {
    done: false,
    cursor: { stage: "poll", jobId, polls, ids },
    total,
  };
}

async function parseArchive(
  ctx: PhaseContext,
  zipB64: string,
  ids: Record<string, string>,
  total: number,
): Promise<PhaseResult> {
  const files = unzipSync(Buffer.from(zipB64, "base64"));
  const entries = Object.keys(files).filter((name) => name.endsWith(".reportType"));

  const customFields = await loadCustomFieldIndex(ctx);
  const resolve = makeObjectResolver(customFields as TrackedField[]);

  const records = [];
  let failed = 0;

  for (const entry of entries) {
    const name = entry.split("/").pop()!.replace(/\.reportType$/, "");
    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(strFromU8(files[entry]));
    } catch (err) {
      failed++;
      ctx.log(`ReportType ${name} failed to parse — ${String(err).slice(0, 120)}`);
      continue;
    }

    const root = (doc.ReportType ?? {}) as Record<string, unknown>;
    const label = typeof root.label === "string" ? root.label : name;

    const seen = new Set<string>();
    for (const column of collectColumns(root)) {
      const field = column.field;
      if (!field || !field.endsWith("__c")) continue;

      // Lookup columns are relationship paths ("BillingAccount.Foo__c"): the
      // field is the last segment and the earlier ones are relationship names,
      // which the resolver can fall through to unique-name attribution.
      const segments = field.split(".");
      const fieldName = segments.pop()!;
      const prefix = [column.table ?? "", ...segments].filter(Boolean).join(".");

      const key = `${prefix}.${fieldName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const owners = resolve(prefix, fieldName);
      for (const object of owners.length ? owners : [null]) {
        records.push({
          scan_id: ctx.scanId,
          object_name: object,
          field_api_name: fieldName,
          reference_type: "ReportType",
          reference_id: ids[name] ?? null,
          reference_name: name,
          reference_label: label,
          reference_detail: null,
          source: "reporttype_scan",
        });
      }
    }
  }

  if (records.length) {
    const { error } = await ctx.db.from("scan_field_refs").insert(records);
    if (error) throw new Error(`scan_field_refs insert failed: ${error.message}`);
  }

  ctx.log(
    `reporttype_scan: ${records.length} references from ${entries.length - failed}/${entries.length} report types`,
  );

  return {
    done: true,
    total: total || entries.length,
    scanned: entries.length - failed,
    failed,
  };
}

/** fullName -> 070… Id, used to build Setup deep links on the drill page. */
async function listReportTypes(ctx: PhaseContext): Promise<Map<string, string>> {
  const response = await ctx.sf.metadataSoap(
    "<met:listMetadata><met:queries><met:type>ReportType</met:type></met:queries>" +
      `<met:asOfVersion>${VERSION}</met:asOfVersion></met:listMetadata>`,
  );

  const parsed = parser.parse(response) as Record<string, any>;
  const results = toArray(parsed?.Envelope?.Body?.listMetadataResponse?.result);

  const map = new Map<string, string>();
  for (const entry of results) {
    const item = entry as { fullName?: unknown; id?: unknown };
    if (typeof item.fullName === "string" && item.fullName) {
      map.set(item.fullName, typeof item.id === "string" ? item.id : "");
    }
  }
  return map;
}

interface ReportTypeColumn {
  field?: string;
  table?: string;
}

/**
 * Every <columns> element under every <sections> element.
 *
 * Written defensively because fast-xml-parser collapses a single child to an
 * object and only produces an array for repeats — so a report type with one
 * section and one column has a completely different shape from one with several.
 */
function collectColumns(root: Record<string, unknown>): ReportTypeColumn[] {
  const columns: ReportTypeColumn[] = [];
  for (const section of toArray(root.sections)) {
    for (const column of toArray((section as Record<string, unknown>)?.columns)) {
      const c = column as Record<string, unknown>;
      columns.push({
        field: typeof c?.field === "string" ? c.field : undefined,
        table: typeof c?.table === "string" ? c.table : undefined,
      });
    }
  }
  return columns;
}

function toArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
