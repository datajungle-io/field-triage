import { OBJECTS } from "@/lib/constants";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";

/**
 * Phase 5 — page layout membership.
 * Port of salesforce/jobs/ingest_field_layouts.py.
 *
 * Uses the standard REST describe/layouts/ endpoint rather than Tooling. Informational
 * only: a field being on a layout is already a Layout dependency via phase 4, but
 * on_layout is a useful "someone put this on a page on purpose" signal in the
 * detail view, independent of the dependency count.
 */

interface LayoutComponent {
  type?: string;
  value?: string;
}

export async function runLayouts(ctx: PhaseContext): Promise<PhaseResult> {
  const startIndex = Number(ctx.cursor.objectIndex ?? 0);
  let index = startIndex;
  let failed = Number(ctx.cursor.failed ?? 0);

  for (; index < OBJECTS.length; index++) {
    if (index > startIndex && outOfTime(ctx)) break;

    const object = OBJECTS[index];
    try {
      const described = await ctx.sf.describeLayouts(object);
      const fieldNames = new Set<string>();

      for (const layout of described.layouts ?? []) {
        // Both section lists are walked: a field can be edit-only, and it is
        // still deliberately placed.
        const sections = [
          ...(layout.detailLayoutSections ?? []),
          ...(layout.editLayoutSections ?? []),
        ];
        for (const section of sections) {
          for (const row of section.layoutRows ?? []) {
            for (const item of row.layoutItems ?? []) {
              for (const component of (item.layoutComponents ?? []) as LayoutComponent[]) {
                // Layout items also hold blank spacers and canvas components;
                // only type === "Field" carries a real API name.
                if (component.type === "Field" && component.value) {
                  fieldNames.add(component.value);
                }
              }
            }
          }
        }
      }

      if (fieldNames.size) {
        const { error } = await ctx.db
          .from("scan_fields")
          .update({ on_layout: true })
          .eq("scan_id", ctx.scanId)
          .eq("object_name", object)
          .in("field_api_name", [...fieldNames]);
        if (error) throw new Error(`on_layout update failed: ${error.message}`);
      }

      ctx.log(`${object}: ${fieldNames.size} fields on layouts`);
    } catch (err) {
      failed++;
      ctx.log(`${object}: layout scan skipped — ${String(err).slice(0, 160)}`);
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
