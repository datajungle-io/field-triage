import { chunk, mapLimit } from "@/lib/concurrency";
import { makeObjectResolver, type TrackedField } from "@/lib/salesforce/resolver";
import type { PhaseContext, PhaseResult } from "@/lib/scan/types";
import { loadCustomFieldIndex } from "@/lib/scan/phases/shared";

/**
 * Phase 7 — report column sweep.
 * Port of scan_reports in salesforce/jobs/ingest_field_references.py.
 *
 * MetadataComponentDependency omits Reports entirely, so without this pass a
 * field used by fifty reports reads as having zero dependencies. It is the
 * longest phase in the scan — one describe call per report, and enterprise orgs
 * run to thousands — which is exactly why the scan is resumable.
 */

/**
 * `Account.My_Field__c` tokens anywhere in reportMetadata: columns, groupings,
 * filters, cross-filters, bucket definitions and custom summary formulas.
 *
 * Only reportMetadata is scanned, never the full describe payload — the other
 * sections list every field available to the report type, which would match
 * fields the report does not use and inflate every count.
 */
const TOKEN_RE = /\b([A-Za-z][A-Za-z0-9_.]*)\.([A-Za-z][A-Za-z0-9_]*__c)\b/g;

const REPORT_CONCURRENCY = 12;
/** Reports described per tick before yielding. */
const REPORT_BATCH = 150;
/** Reports per progress write — small enough that the counter visibly moves. */
const PROGRESS_BATCH = 25;

interface ReportRow {
  Id: string;
  DeveloperName: string | null;
  Name: string | null;
  FolderName: string | null;
}

export async function runReports(ctx: PhaseContext): Promise<PhaseResult> {
  // ORDER BY Id makes the cursor meaningful: without a stable sort, resuming at
  // index N could skip reports and re-scan others.
  const reports = await ctx.sf.query<ReportRow>(
    "SELECT Id, DeveloperName, Name, FolderName FROM Report ORDER BY Id",
  );

  if (reports.length === 0) {
    return { done: true, total: 0, scanned: 0, failed: 0 };
  }

  const customFields = await loadCustomFieldIndex(ctx);
  const resolve = makeObjectResolver(customFields as TrackedField[]);

  const startIndex = Number(ctx.cursor.reportIndex ?? 0);
  let failed = Number(ctx.cursor.failed ?? 0);

  const slice = reports.slice(startIndex, startIndex + REPORT_BATCH);

  // Worked in sub-batches, writing progress after each, so the phase row moves
  // several times per tick. A tick can hold its connection for ~35s; without
  // this the UI has nothing new to show for that entire window and a scan that
  // is working perfectly well looks stalled.
  let processed = startIndex;
  let referenceCount = 0;

  for (const sub of chunk(slice, PROGRESS_BATCH)) {
    const results = await mapLimit(sub, REPORT_CONCURRENCY, async (report) => {
      const described = await ctx.sf.describeReport(report.Id);
      return { report, metadata: described.reportMetadata ?? {} };
    });

    const records = [];
    for (const result of results) {
      if (!result.ok) {
        // Almost always a 403: the connecting user can't see that report's
        // folder. Counted, disclosed in the coverage banner, never silently
        // dropped.
        failed++;
        continue;
      }

      const { report, metadata } = result.value;
      const raw = JSON.stringify(metadata);

      // Dedupe within a report: the same field appears as a column, a grouping
      // and a filter, but that is one report depending on it, not three.
      const seen = new Set<string>();
      for (const match of raw.matchAll(TOKEN_RE)) {
        const [, prefix, field] = match;
        const key = `${prefix}.${field}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const owners = resolve(prefix, field);
        // Unresolvable tokens are stored with a NULL object so the row stays
        // auditable; field_references_deduped filters them out of every count.
        for (const object of owners.length ? owners : [null]) {
          records.push({
            scan_id: ctx.scanId,
            object_name: object,
            field_api_name: field,
            reference_type: "Report",
            reference_id: report.Id,
            reference_name: report.DeveloperName,
            reference_label: report.Name,
            reference_detail: report.FolderName,
            source: "report_scan",
          });
        }
      }
    }

    if (records.length) {
      const { error } = await ctx.db.from("scan_field_refs").insert(records);
      if (error) throw new Error(`scan_field_refs insert failed: ${error.message}`);
      referenceCount += records.length;
    }

    processed += sub.length;
    await ctx.db
      .from("scan_phases")
      .update({ scanned: Math.max(0, processed - failed), total: reports.length })
      .eq("scan_id", ctx.scanId)
      .eq("phase", "reports");
  }

  const nextIndex = startIndex + slice.length;
  const done = nextIndex >= reports.length;

  ctx.log(
    `report_scan: ${referenceCount} references from ${slice.length} reports ` +
      `(${nextIndex}/${reports.length}, ${failed} inaccessible)`,
  );

  return {
    done,
    cursor: done ? {} : { reportIndex: nextIndex, failed },
    total: reports.length,
    scanned: nextIndex - failed,
    failed,
    note:
      done && failed > 0
        ? `${failed} report${failed === 1 ? "" : "s"} could not be read — usually folders this user cannot access`
        : undefined,
  };
}
