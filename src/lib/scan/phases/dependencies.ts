import { chunk } from "@/lib/concurrency";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";

/**
 * Phase 4 — MetadataComponentDependency (Tooling API, Beta).
 * Port of scan_dependency_api in salesforce/jobs/ingest_field_references.py.
 *
 * The broadest of the four reference sources: Layouts, Apex classes and triggers,
 * Flows, Validation Rules, formula fields (which arrive as CustomField-type
 * references), Email Templates, Web Links, Aura and LWC bundles.
 *
 * It does NOT cover Reports, Report Types or Flexipage field instances — hence
 * phases 6, 7 and 8. Anyone who stops here ships a tool that tells people to
 * delete fields their reports depend on.
 */

/**
 * MetadataComponentDependency caps a result set at 2,000 rows and does not
 * paginate. The production job issues one unfiltered query, which is correct on
 * an org the size of ours but would silently truncate on a large one — and a
 * truncated dependency list reads as "no dependencies", the single most
 * dangerous wrong answer this tool can give. Landing near the cap is treated as
 * evidence of truncation and triggers the chunked path below.
 */
const TRUNCATION_THRESHOLD = 1_900;

/** Field Ids per chunked query — keeps the SOQL comfortably under URL limits. */
const ID_CHUNK_SIZE = 200;

/**
 * The Dependency API reports Lightning page usage at page grain and calls it
 * FlexiPage; Setup (and phase 6) call the same thing FlexipageFieldInstance.
 * Normalising here is what lets the two sources dedupe in field_references_deduped
 * instead of double-counting every field on a record page.
 */
const TYPE_ALIASES: Record<string, string> = { FlexiPage: "FlexipageFieldInstance" };

interface DependencyRow {
  MetadataComponentId: string | null;
  MetadataComponentName: string | null;
  MetadataComponentType: string;
  RefMetadataComponentId: string | null;
}

interface TrackedField {
  object_name: string;
  field_api_name: string;
  field_id: string;
}

export async function runDependencies(ctx: PhaseContext): Promise<PhaseResult> {
  const fields = await loadTrackedFields(ctx);
  if (fields.length === 0) {
    ctx.log("No custom fields with Ids — nothing to attribute dependencies to");
    return { done: true, total: 0, scanned: 0, failed: 0 };
  }

  // Ids are matched at both widths: RefMetadataComponentId comes back 18-char,
  // but 15-char forms appear often enough in Salesforce APIs to be worth guarding.
  const byId = new Map<string, TrackedField>();
  for (const f of fields) {
    byId.set(f.field_id, f);
    byId.set(f.field_id.slice(0, 15), f);
  }

  const mode = (ctx.cursor.mode as string) ?? "bulk";
  if (mode === "bulk") {
    return runBulk(ctx, fields, byId);
  }
  return runChunked(ctx, fields, byId, Number(ctx.cursor.chunkIndex ?? 0));
}

async function runBulk(
  ctx: PhaseContext,
  fields: TrackedField[],
  byId: Map<string, TrackedField>,
): Promise<PhaseResult> {
  let rows: DependencyRow[];
  try {
    rows = await ctx.sf.query<DependencyRow>(
      "SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, " +
        "RefMetadataComponentId FROM MetadataComponentDependency " +
        "WHERE RefMetadataComponentType = 'CustomField'",
      { tooling: true },
    );
  } catch (err) {
    ctx.log(`Bulk dependency query failed, falling back to chunked — ${String(err).slice(0, 160)}`);
    return { done: false, cursor: { mode: "chunked", chunkIndex: 0 }, total: fields.length };
  }

  if (rows.length >= TRUNCATION_THRESHOLD) {
    // Discard rather than insert: a partial set inserted now would be
    // indistinguishable from a complete one after the chunked pass appends to it.
    ctx.log(
      `Bulk query returned ${rows.length} rows (at or near the 2,000 cap) — ` +
        "assuming truncation and re-querying per field Id",
    );
    return { done: false, cursor: { mode: "chunked", chunkIndex: 0 }, total: fields.length };
  }

  const inserted = await insertReferences(ctx, rows, byId);
  ctx.log(`dependency_api: ${inserted} reference rows across ${fields.length} fields`);
  return { done: true, total: fields.length, scanned: fields.length, failed: 0 };
}

async function runChunked(
  ctx: PhaseContext,
  fields: TrackedField[],
  byId: Map<string, TrackedField>,
  startChunk: number,
): Promise<PhaseResult> {
  const chunks = chunk(
    fields.map((f) => f.field_id),
    ID_CHUNK_SIZE,
  );

  let chunkIndex = startChunk;
  let failed = Number(ctx.cursor.failed ?? 0);

  for (; chunkIndex < chunks.length; chunkIndex++) {
    if (chunkIndex > startChunk && outOfTime(ctx)) break;

    const ids = chunks[chunkIndex].map((id) => `'${id}'`).join(",");
    try {
      const rows = await ctx.sf.query<DependencyRow>(
        "SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, " +
          "RefMetadataComponentId FROM MetadataComponentDependency " +
          `WHERE RefMetadataComponentType = 'CustomField' AND RefMetadataComponentId IN (${ids})`,
        { tooling: true },
      );
      await insertReferences(ctx, rows, byId);
    } catch (err) {
      failed += chunks[chunkIndex].length;
      ctx.log(`dependency chunk ${chunkIndex} failed — ${String(err).slice(0, 160)}`);
    }
  }

  const done = chunkIndex >= chunks.length;
  return {
    done,
    cursor: done ? {} : { mode: "chunked", chunkIndex, failed },
    total: fields.length,
    scanned: Math.min(chunkIndex * ID_CHUNK_SIZE, fields.length) - failed,
    failed,
    note: done ? "Queried per field Id (bulk result hit the 2,000-row cap)" : undefined,
  };
}

async function insertReferences(
  ctx: PhaseContext,
  rows: DependencyRow[],
  byId: Map<string, TrackedField>,
): Promise<number> {
  const records = [];
  for (const r of rows) {
    const refId = r.RefMetadataComponentId ?? "";
    const field = byId.get(refId) ?? byId.get(refId.slice(0, 15));
    if (!field) continue; // a dependency on a field outside the tracked set

    records.push({
      scan_id: ctx.scanId,
      object_name: field.object_name,
      field_api_name: field.field_api_name,
      reference_type: TYPE_ALIASES[r.MetadataComponentType] ?? r.MetadataComponentType,
      reference_id: r.MetadataComponentId,
      reference_name: r.MetadataComponentName,
      reference_label: r.MetadataComponentName,
      reference_detail: null,
      source: "dependency_api",
    });
  }

  if (records.length) {
    const { error } = await ctx.db.from("scan_field_refs").insert(records);
    if (error) throw new Error(`scan_field_refs insert failed: ${error.message}`);
  }
  return records.length;
}

async function loadTrackedFields(ctx: PhaseContext): Promise<TrackedField[]> {
  const rows: TrackedField[] = [];
  const pageSize = 1000;

  // PostgREST caps responses at 1,000 rows. Taking the first page and moving on
  // would drop fields from the Id map, and a field missing from that map gets no
  // dependencies attributed to it — reading as "0 deps · safe to delete" when it
  // may be referenced everywhere. Page it properly.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await ctx.db
      .from("scan_fields")
      .select("object_name, field_api_name, field_id")
      .eq("scan_id", ctx.scanId)
      .eq("is_custom", true)
      .not("field_id", "is", null)
      .order("object_name")
      .order("field_api_name")
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed to load tracked fields: ${error.message}`);
    const batch = (data ?? []) as TrackedField[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}
