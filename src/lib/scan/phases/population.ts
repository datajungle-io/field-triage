import { COUNT_BATCH_SIZE, OBJECTS, QUERYALL_OBJECTS } from "@/lib/constants";
import { chunk, mapLimit } from "@/lib/concurrency";
import type { DescribeField } from "@/lib/salesforce/client";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";

/**
 * Phase 3 — field population.
 * Port of salesforce/jobs/ingest_field_population_sf.py.
 *
 * This is the phase that makes the report worth anything: "<1% populated" is the
 * core of the delete-ready signal, and it is measured against Salesforce itself
 * rather than a warehouse copy. The production job exists precisely because
 * warehouse-side counting lies in two ways — schema-refresh gaps (a column added
 * without a backfill reads as NULL on every unmodified record; one incident had
 * SOQL reporting 9,295 populated against BigQuery's 165) and sync-scope gaps
 * (archived activities never re-sync). Neither is visible from downstream.
 */

/** Salesforce tolerates parallel aggregates comfortably at this width. */
const QUERY_CONCURRENCY = 4;

/**
 * Deliberately carries no sf_type or field_label.
 *
 * Both phases write to scan_fields, and describe reports types as "string" /
 * "picklist" while FieldDefinition reports "Text(40)" / "Lookup(Contact)". When
 * both wrote the column the Type shown depended on which phase last touched the
 * row, so the same table mixed both vocabularies. FieldDefinition wins: it is
 * the broader source (describe omits anything hidden by field-level security)
 * and its formatting is more useful to a human deciding what to delete.
 */
interface PopulationRow {
  scan_id: string;
  object_name: string;
  field_api_name: string;
  is_custom: boolean;
  populated_count: number | null;
  total_records: number | null;
  population_pct: number | null;
  is_boolean: boolean;
  aggregatable: boolean;
  includes_archived: boolean;
}

export async function runPopulation(ctx: PhaseContext): Promise<PhaseResult> {
  const startIndex = Number(ctx.cursor.objectIndex ?? 0);
  let index = startIndex;
  let failed = Number(ctx.cursor.failed ?? 0);

  // Objects are only started, never interrupted: the batch fan-out below bounds
  // a single object to a few seconds even on a wide schema, so the coarse cursor
  // costs nothing and avoids threading partial counts through the resume state.
  for (; index < OBJECTS.length; index++) {
    if (index > startIndex && outOfTime(ctx, 8_000)) break;

    const object = OBJECTS[index];
    try {
      const rows = await measureObject(ctx, object);
      if (rows.length) {
        const { error } = await ctx.db
          .from("scan_fields")
          .upsert(rows, { onConflict: "scan_id,object_name,field_api_name" });
        if (error) throw new Error(`scan_fields upsert failed: ${error.message}`);
      }
      ctx.log(
        `${object}: measured ${rows.length} fields ` +
          `(${rows.filter((r) => !r.aggregatable).length} not aggregatable)`,
      );
    } catch (err) {
      failed++;
      ctx.log(`${object}: population skipped — ${String(err).slice(0, 160)}`);
    }
  }

  const done = index >= OBJECTS.length;
  return {
    done,
    cursor: done ? {} : { objectIndex: index, failed },
    total: OBJECTS.length,
    scanned: index - failed,
    failed,
  };
}

async function measureObject(ctx: PhaseContext, object: string): Promise<PopulationRow[]> {
  // Archived and recycle-bin activities are invisible to a normal query, so
  // Task/Event totals would otherwise describe a frozen subset of history.
  const includeArchived = QUERYALL_OBJECTS.has(object);

  const describe = await ctx.sf.describe(object);
  const fields = describe.fields ?? [];

  const totalRow = await ctx.sf.queryAggregate(
    `SELECT COUNT(Id) c0 FROM ${object}`,
    includeArchived,
  );
  const total = toNumber(totalRow.c0);

  // Describe metadata is authoritative about what SOQL will accept:
  // COUNT(field) needs aggregatable, `WHERE field = true` needs filterable.
  // Derived booleans such as CanCreateQuoteLineItems are neither, and asking
  // about them is a guaranteed error.
  const booleans = fields.filter((f) => f.type === "boolean" && f.filterable);
  const countables = fields.filter((f) => f.type !== "boolean" && f.aggregatable);
  const measurable = new Set([...booleans, ...countables]);
  const skipped = fields.filter((f) => !measurable.has(f));

  const counts = new Map<string, number | null>();

  const batches = chunk(
    countables.map((f) => f.name),
    COUNT_BATCH_SIZE,
  );
  const batchResults = await mapLimit(batches, QUERY_CONCURRENCY, (names) =>
    countBatch(ctx, object, names, includeArchived),
  );
  for (const result of batchResults) {
    if (result.ok) for (const [name, value] of result.value) counts.set(name, value);
    // A batch that fails even after bisecting leaves its fields absent from
    // `counts`, which reads below as null — "not measurable", not zero.
  }

  // Checkboxes are never null in Salesforce, so COUNT() on one returns the record
  // count and tells you nothing. Counting `= true` is the only meaningful measure.
  const booleanResults = await mapLimit(booleans, QUERY_CONCURRENCY, async (f) => {
    try {
      const row = await ctx.sf.queryAggregate(
        `SELECT COUNT(Id) c0 FROM ${object} WHERE ${f.name} = true`,
        includeArchived,
      );
      return [f.name, toNumber(row.c0)] as const;
    } catch {
      return [f.name, null] as const;
    }
  });
  for (const result of booleanResults) {
    if (result.ok) counts.set(result.value[0], result.value[1]);
  }

  return [...booleans, ...countables, ...skipped].map((f) =>
    toRow(ctx.scanId, object, f, counts.get(f.name) ?? null, total, includeArchived),
  );
}

function toRow(
  scanId: string,
  object: string,
  field: DescribeField,
  populated: number | null,
  total: number | null,
  includeArchived: boolean,
): PopulationRow {
  return {
    scan_id: scanId,
    object_name: object,
    field_api_name: field.name,
    is_custom: field.name.endsWith("__c"),
    populated_count: populated,
    total_records: total,
    // Null when unmeasurable or when the object holds no records at all. The
    // census turns that into the 'No Data' bucket rather than calling the field
    // dead — absence of evidence is not evidence of disuse, and a field wrongly
    // marked delete-ready is the one failure mode this tool cannot afford.
    population_pct: populated !== null && total ? populated / total : null,
    is_boolean: field.type === "boolean",
    aggregatable: populated !== null,
    includes_archived: includeArchived,
  };
}

/**
 * COUNT(field) for a batch of fields in one query, bisecting on failure to
 * isolate whichever field SOQL refuses.
 *
 * Describe already filters the obviously impossible, but describe and SOQL do
 * disagree in practice, and one bad field would otherwise cost the other 24 in
 * its batch their measurement.
 */
async function countBatch(
  ctx: PhaseContext,
  object: string,
  names: string[],
  includeArchived: boolean,
): Promise<Array<readonly [string, number | null]>> {
  if (names.length === 0) return [];

  const aliases = names.map((name, i) => `COUNT(${name}) c${i}`).join(", ");
  try {
    const row = await ctx.sf.queryAggregate(
      `SELECT ${aliases} FROM ${object}`,
      includeArchived,
    );
    return names.map((name, i) => [name, toNumber(row[`c${i}`])] as const);
  } catch (err) {
    if (names.length === 1) {
      ctx.log(`  ${object}.${names[0]} not countable — marking not aggregatable`);
      return [[names[0], null] as const];
    }
    const mid = Math.floor(names.length / 2);
    const [left, right] = await Promise.all([
      countBatch(ctx, object, names.slice(0, mid), includeArchived),
      countBatch(ctx, object, names.slice(mid), includeArchived),
    ]);
    return [...left, ...right];
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
