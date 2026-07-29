import { serviceClient } from "@/lib/supabase";
import type { Bucket } from "@/lib/constants";

/**
 * Read layer for the report.
 *
 * Every aggregate goes through the SQL functions in migration 0002 rather than
 * being recomputed here, so these numbers and the ones on the paid dashboard
 * come from the same expressions.
 */

export interface Summary {
  objects_scanned: number;
  fields_scanned: number;
  dead_fields: number;
  delete_ready: number;
  ready_no_deps: number;
}

export interface ObjectRow {
  object_name: string;
  total_fields: number;
  custom_fields: number;
  standard_fields: number;
  managed_fields: number;
  dead_fields: number;
  low_fields: number;
  partial_fields: number;
  healthy_fields: number;
  no_data_fields: number;
  delete_ready: number;
  ready_no_deps: number;
  total_dependencies: number;
}

export interface CensusRow {
  object_name: string;
  field_api_name: string;
  field_id: string | null;
  field_label: string | null;
  sf_type: string | null;
  namespace_prefix: string | null;
  namespace_category: "Custom" | "Standard" | "Managed Package";
  is_custom: boolean;
  is_deprecated_label: boolean;
  last_modified_date: string | null;
  populated_count: number | null;
  total_records: number | null;
  population_pct: number | null;
  bucket: Bucket;
  /** Set only when bucket is 'No Data'. See migration 0005. */
  no_data_reason: "not_visible" | "not_aggregatable" | "no_records" | null;
  on_layout: boolean;
  is_reference_tracked: boolean;
  dependency_count: number | null;
  is_safe_to_delete: boolean;
}

export interface ReferenceRow {
  object_name: string;
  field_api_name: string;
  reference_type: string;
  reference_id: string | null;
  reference_name: string | null;
  reference_label: string | null;
  reference_detail: string | null;
  source: string;
}

export async function loadSummary(scanId: string): Promise<Summary> {
  const { data, error } = await serviceClient().rpc("scan_summary", { p_scan_id: scanId });
  if (error) throw new Error(`scan_summary failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    objects_scanned: Number(row.objects_scanned ?? 0),
    fields_scanned: Number(row.fields_scanned ?? 0),
    dead_fields: Number(row.dead_fields ?? 0),
    delete_ready: Number(row.delete_ready ?? 0),
    ready_no_deps: Number(row.ready_no_deps ?? 0),
  };
}

export async function loadByObject(scanId: string): Promise<ObjectRow[]> {
  const { data, error } = await serviceClient().rpc("scan_by_object", { p_scan_id: scanId });
  if (error) throw new Error(`scan_by_object failed: ${error.message}`);
  return (data ?? []) as ObjectRow[];
}

/**
 * How much of the org the scan could actually *measure*, as opposed to
 * cross-reference.
 *
 * These are different failures with the same symptom. The coverage banner
 * already discloses references we couldn't read; this covers fields we couldn't
 * read at all. A field hidden by field-level security has no population figure,
 * so it can never qualify as a deletion candidate — meaning an org that blocked
 * half the scan produces a low candidate count and a clean-looking report.
 *
 * Only `not_visible` is a coverage problem. `not_aggregatable` (compound and
 * long-text fields Salesforce won't COUNT) and `no_records` (an empty object)
 * are facts about the data, not gaps in the scan, and inflating the warning
 * with them would train people to ignore it.
 */
export interface MeasurementCoverage {
  customFields: number;
  /** Absent from the describe — almost always field-level security. */
  notVisible: number;
  /** Salesforce won't aggregate the type. Expected, not a gap. */
  notAggregatable: number;
  /** The object has no rows at all. */
  noRecords: number;
  /** notVisible as a share of custom fields, 0–1. */
  hiddenShare: number;
}

export async function loadMeasurementCoverage(scanId: string): Promise<MeasurementCoverage> {
  const rows = await loadCensus(scanId, { customOnly: true, includeNoData: true });

  const count = (reason: string) => rows.filter((r) => r.no_data_reason === reason).length;
  const notVisible = count("not_visible");

  return {
    customFields: rows.length,
    notVisible,
    notAggregatable: count("not_aggregatable"),
    noRecords: count("no_records"),
    hiddenShare: rows.length > 0 ? notVisible / rows.length : 0,
  };
}

export interface CensusFilter {
  object?: string;
  safeOnly?: boolean;
  zeroDepsOnly?: boolean;
  /**
   * Standard fields cannot be deleted, whatever their health — they are context,
   * not candidates, and they outnumber custom fields roughly ten to one.
   */
  customOnly?: boolean;
  /**
   * Fields with no population measurement. Always unactionable for standard
   * fields; for custom ones it's worth being able to bring them back, since
   * "not visible" can mean field-level security is hiding something.
   */
  includeNoData?: boolean;
  limit?: number;
}

export async function loadCensus(
  scanId: string,
  filter: CensusFilter = {},
): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  const pageSize = 1000;
  const cap = filter.limit ?? Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < cap; offset += pageSize) {
    let query = serviceClient()
      .from("field_census")
      .select("*")
      .eq("scan_id", scanId)
      .order("object_name")
      .order("field_api_name")
      .range(offset, Math.min(offset + pageSize, cap) - 1);

    if (filter.object && filter.object !== "All Objects") {
      query = query.eq("object_name", filter.object);
    }
    if (filter.safeOnly) query = query.eq("is_safe_to_delete", true);
    if (filter.zeroDepsOnly) query = query.eq("dependency_count", 0);
    if (filter.customOnly) query = query.eq("is_custom", true);
    if (!filter.includeNoData) query = query.neq("bucket", "No Data");

    const { data, error } = await query;
    if (error) throw new Error(`field_census read failed: ${error.message}`);

    const batch = (data ?? []) as CensusRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return sortByActionability(rows);
}

/**
 * Custom → Managed Package → Standard, then object, then field name.
 *
 * Ordered by what the reader can actually act on. Native custom fields are the
 * only ones they can delete outright; managed-package fields need the vendor's
 * cooperation; standard fields can never be deleted at all, so they belong last
 * however unhealthy they look.
 *
 * Sorted here rather than in SQL because every page is materialised above
 * before returning — a client-side sort over the complete set is exact, and
 * avoids another view migration.
 */
const CATEGORY_RANK: Record<string, number> = {
  Custom: 0,
  "Managed Package": 1,
  Standard: 2,
};

function sortByActionability(rows: CensusRow[]): CensusRow[] {
  return rows.sort(
    (a, b) =>
      (CATEGORY_RANK[a.namespace_category] ?? 3) -
        (CATEGORY_RANK[b.namespace_category] ?? 3) ||
      a.object_name.localeCompare(b.object_name) ||
      a.field_api_name.localeCompare(b.field_api_name),
  );
}

export async function loadFieldRow(
  scanId: string,
  object: string,
  field: string,
): Promise<CensusRow | null> {
  const { data, error } = await serviceClient()
    .from("field_census")
    .select("*")
    .eq("scan_id", scanId)
    .ilike("object_name", object)
    .ilike("field_api_name", field)
    .maybeSingle();

  if (error) throw new Error(`field lookup failed: ${error.message}`);
  return (data as CensusRow) ?? null;
}

export async function loadFieldReferences(
  scanId: string,
  object: string,
  field: string,
): Promise<ReferenceRow[]> {
  const { data, error } = await serviceClient()
    .from("field_references_deduped")
    .select("*")
    .eq("scan_id", scanId)
    .ilike("object_name", object)
    .ilike("field_api_name", field)
    .order("reference_type")
    .order("reference_label");

  if (error) throw new Error(`reference lookup failed: ${error.message}`);
  return (data ?? []) as ReferenceRow[];
}

export async function loadObjectNames(scanId: string): Promise<string[]> {
  const rows = await loadByObject(scanId);
  return rows.map((r) => r.object_name);
}
