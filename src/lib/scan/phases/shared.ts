import type { PhaseContext } from "@/lib/scan/types";

export interface CustomFieldIndexRow {
  objectName: string;
  fieldApiName: string;
}

/**
 * Every custom field on a tracked object, for the object resolver.
 *
 * The resolver's fallback rule — a field name owned by exactly one tracked
 * object is attributed to it regardless of the path in the metadata — depends on
 * this being the complete set. A partial list would make ambiguous names look
 * unique and misattribute references.
 */
export async function loadCustomFieldIndex(
  ctx: PhaseContext,
): Promise<CustomFieldIndexRow[]> {
  const rows: CustomFieldIndexRow[] = [];
  const pageSize = 1000;

  // PostgREST caps a response at 1,000 rows by default, and a wide org clears
  // that easily — page explicitly rather than silently truncating the index.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await ctx.db
      .from("scan_fields")
      .select("object_name, field_api_name")
      .eq("scan_id", ctx.scanId)
      .eq("is_custom", true)
      .order("object_name")
      .order("field_api_name")
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed to load custom field index: ${error.message}`);
    const batch = data ?? [];
    rows.push(
      ...batch.map((r) => ({
        objectName: r.object_name as string,
        fieldApiName: r.field_api_name as string,
      })),
    );
    if (batch.length < pageSize) break;
  }

  return rows;
}
