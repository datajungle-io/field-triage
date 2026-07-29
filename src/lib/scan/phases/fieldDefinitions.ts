import { ENTITY_ALIASES, OBJECTS } from "@/lib/constants";
import { outOfTime, type PhaseContext, type PhaseResult } from "@/lib/scan/types";

/**
 * Phase 2 — field inventory.
 * Port of salesforce/jobs/ingest_field_definition.py.
 *
 * Two Tooling queries per scan plus one per object:
 *   FieldDefinition — the field list. Must be filtered by EntityDefinition; it
 *                     cannot be full-table scanned, which is also why Airbyte
 *                     blacklists it and why this runs outside the warehouse.
 *   CustomField     — the 18-char Id per custom field. Needed twice over: for
 *                     Object Manager deep links, and as the join key to
 *                     MetadataComponentDependency.RefMetadataComponentId. Without
 *                     it a field simply has no dependencies as far as phase 4 is
 *                     concerned.
 */

/** Label-text heuristic, ported from dbt stg_sf_field_metadata.sql. */
const DEPRECATED_LABEL_RE =
  /\b(deprecated|do not use|legacy|old|unused|obsolete|replaced)\b/;

interface CustomFieldRow {
  Id: string;
  DeveloperName: string;
  TableEnumOrId: string;
}

interface FieldDefinitionRow {
  QualifiedApiName: string;
  MasterLabel: string | null;
  DataType: string | null;
  NamespacePrefix: string | null;
  LastModifiedDate: string | null;
  /**
   * "<Object>.<fieldId>" for custom fields, "<Object>.<ApiName>" for standard.
   * The custom-field form embeds the 15-char CustomField Id, which is the
   * fallback when Tooling CustomField isn't readable — see loadCustomFieldIds.
   */
  DurableId: string | null;
}

/** A 15- or 18-char Salesforce field Id, as it appears inside DurableId. */
const FIELD_ID_RE = /^00N[A-Za-z0-9]{12,15}$/;

export async function runFieldDefinitions(ctx: PhaseContext): Promise<PhaseResult> {
  const startIndex = Number(ctx.cursor.objectIndex ?? 0);

  // Rebuilt per slice rather than carried in the cursor: it can run to thousands
  // of entries, and this phase almost always finishes in one tick anyway.
  const idMap = await loadCustomFieldIds(ctx);

  let index = startIndex;
  let failed = Number(ctx.cursor.failed ?? 0);

  for (; index < OBJECTS.length; index++) {
    if (index > startIndex && outOfTime(ctx)) break;

    const object = OBJECTS[index];
    try {
      const rows = await ctx.sf.query<FieldDefinitionRow>(
        "SELECT QualifiedApiName, MasterLabel, DataType, NamespacePrefix, LastModifiedDate, DurableId " +
          `FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${object}'`,
        { tooling: true },
      );

      const records = rows.map((r) => {
        const fieldApiName = r.QualifiedApiName;
        const isCustom = fieldApiName.endsWith("__c");

        return {
          scan_id: ctx.scanId,
          object_name: object,
          field_api_name: fieldApiName,
          // Standard fields have no CustomField record, but Object Manager URLs
          // accept the API name in the same position, so the deep link still works.
          //
          // For custom fields, prefer the 18-char Id from Tooling CustomField;
          // fall back to the 15-char Id embedded in FieldDefinition.DurableId.
          // The fallback is what keeps dependency attribution working in orgs
          // where the connecting user can't read CustomField — common, since it
          // needs Customize Application. MetadataComponentDependency matching
          // already tries both widths.
          field_id: isCustom
            ? (idMap.get(`${object}:${fieldApiName}`) ??
              idMap.get(`${ENTITY_ALIASES[object] ?? object}:${fieldApiName}`) ??
              fieldIdFromDurableId(r.DurableId) ??
              null)
            : fieldApiName,
          field_label: r.MasterLabel,
          sf_type: r.DataType,
          namespace_prefix: r.NamespacePrefix,
          is_custom: isCustom,
          last_modified_date: r.LastModifiedDate,
          is_deprecated_label: DEPRECATED_LABEL_RE.test((r.MasterLabel ?? "").toLowerCase()),
        };
      });

      if (records.length) {
        const { error } = await ctx.db
          .from("scan_fields")
          .upsert(records, { onConflict: "scan_id,object_name,field_api_name" });
        if (error) throw new Error(`scan_fields upsert failed: ${error.message}`);
      }

      ctx.log(`${object}: ${records.length} fields`);
    } catch (err) {
      // An object missing from the org (Quote without Quotes enabled, say) is
      // normal and must not sink the scan.
      failed++;
      ctx.log(`${object}: skipped — ${String(err).slice(0, 160)}`);
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

/**
 * Extract the field Id from FieldDefinition.DurableId.
 *
 * Custom fields: "Account.00NRd000004LkyP" -> "00NRd000004LkyP"
 * Standard:      "Account.Sic"             -> null (not an Id)
 */
function fieldIdFromDurableId(durableId: string | null): string | null {
  const tail = durableId?.split(".").pop();
  return tail && FIELD_ID_RE.test(tail) ? tail : null;
}

/**
 * (object:FIELD__c) -> 18-char CustomField Id.
 *
 * Task and Event custom fields come back as TableEnumOrId = 'Activity', so they
 * are indexed under that key and looked up through ENTITY_ALIASES above.
 */
async function loadCustomFieldIds(ctx: PhaseContext): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await ctx.sf.query<CustomFieldRow>(
      "SELECT Id, DeveloperName, TableEnumOrId FROM CustomField",
      { tooling: true },
    );
    for (const r of rows) {
      if (!r.TableEnumOrId || !r.DeveloperName) continue;
      map.set(`${r.TableEnumOrId}:${r.DeveloperName}__c`, r.Id);
    }
    ctx.log(`CustomField Id map: ${map.size} entries`);
  } catch (err) {
    // Degrade rather than abort: without Ids the census is still complete and
    // correct, but phase 4 can't attribute dependencies, so counts stay NULL
    // ("not scanned") rather than dropping to a misleading 0.
    ctx.log(`CustomField Id map unavailable — ${String(err).slice(0, 160)}`);
  }
  return map;
}
