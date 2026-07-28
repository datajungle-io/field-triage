import { OBJECTS } from "@/lib/constants";
import { chunk, mapLimit } from "@/lib/concurrency";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";

/**
 * Phase 6 — Lightning record pages.
 * Port of scan_flexipages in salesforce/jobs/ingest_field_references.py.
 *
 * MetadataComponentDependency reports FlexiPage usage at page grain but omits
 * field instances, so a field placed on a Lightning page can look unreferenced.
 * FlexiPage.Metadata is only queryable one Id at a time, which is why this is a
 * fan-out rather than one query.
 */

/** `Record.Foo__c` field-instance tokens inside the page metadata. */
const TOKEN_RE = /\bRecord\.([A-Za-z][A-Za-z0-9_]*__c)\b/g;

const PAGE_CONCURRENCY = 8;
/** Pages fetched per tick before yielding. */
const PAGE_BATCH = 40;
/** Pages per time check — same reasoning as the report sweep. */
const PROGRESS_BATCH = 10;

interface FlexiPageRow {
  Id: string;
  DeveloperName: string;
  MasterLabel: string | null;
  EntityDefinitionId: string | null;
  Type: string | null;
}

export async function runFlexipages(ctx: PhaseContext): Promise<PhaseResult> {
  // The page list is small and cheap; re-listing on resume avoids carrying it
  // through the cursor.
  // ORDER BY Id keeps the cursor meaningful across ticks — an unsorted result
  // could shift between calls and skip pages on resume.
  const pages = (
    await ctx.sf.query<FlexiPageRow>(
      "SELECT Id, DeveloperName, MasterLabel, EntityDefinitionId, Type FROM FlexiPage ORDER BY Id",
      { tooling: true },
    )
  ).filter((p) => p.EntityDefinitionId && OBJECTS.includes(p.EntityDefinitionId));

  const startIndex = Number(ctx.cursor.pageIndex ?? 0);
  let failed = Number(ctx.cursor.failed ?? 0);

  if (pages.length === 0) {
    return { done: true, total: 0, scanned: 0, failed: 0 };
  }

  const slice = pages.slice(startIndex, startIndex + PAGE_BATCH);
  let processed = startIndex;
  let referenceCount = 0;

  for (const sub of chunk(slice, PROGRESS_BATCH)) {
    // Yield once the budget is spent, so a tight function ceiling can't kill the
    // tick before its cursor is returned and leave the phase repeating forever.
    if (processed > startIndex && outOfTime(ctx)) break;

    const results = await mapLimit(sub, PAGE_CONCURRENCY, async (page) => {
      const rows = await ctx.sf.query<{ Metadata?: unknown }>(
        `SELECT Metadata FROM FlexiPage WHERE Id = '${page.Id}'`,
        { tooling: true },
      );
      return { page, metadata: rows[0]?.Metadata };
    });

    const records = [];
    for (const result of results) {
      if (!result.ok) {
        failed++;
        continue;
      }
      const { page, metadata } = result.value;
      if (!metadata) continue;

      // Serialise and regex rather than walking the component tree: the metadata
      // shape varies by page type and region, and a field reference reads the
      // same in all of them.
      const raw = JSON.stringify(metadata);
      const fields = new Set<string>();
      for (const match of raw.matchAll(TOKEN_RE)) fields.add(match[1]);

      for (const field of fields) {
        records.push({
          scan_id: ctx.scanId,
          object_name: page.EntityDefinitionId,
          field_api_name: field,
          reference_type: "FlexipageFieldInstance",
          reference_id: page.Id,
          reference_name: page.DeveloperName,
          reference_label: page.MasterLabel,
          reference_detail: page.Type,
          source: "flexipage_scan",
        });
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
      .update({ scanned: Math.max(0, processed - failed), total: pages.length })
      .eq("scan_id", ctx.scanId)
      .eq("phase", "flexipages");
  }

  const nextIndex = processed;
  const done = nextIndex >= pages.length;

  ctx.log(
    `flexipage_scan: ${referenceCount} references from ${nextIndex - startIndex} pages ` +
      `(${nextIndex}/${pages.length})`,
  );

  return {
    done,
    cursor: done ? {} : { pageIndex: nextIndex, failed },
    total: pages.length,
    scanned: nextIndex - failed,
    failed,
  };
}
