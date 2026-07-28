import { OBJECTS } from "@/lib/constants";

/**
 * Resolve a (prefix, field) token from report or report-type metadata back to the
 * tracked object(s) that own the field. Port of make_object_resolver in
 * salesforce/jobs/ingest_field_references.py.
 *
 * Necessary because report metadata refers to fields by report-builder path
 * ("Account.Foo__c", "Activity.Bar__c", "OCR_Opportunity.Baz__c"), not by object
 * API name, and custom report types use relationship labels that resemble nothing
 * in the schema.
 */

/**
 * Report/report-type prefixes that aren't object API names but map to tracked
 * objects. Task/Event custom fields live on the shared Activity entity and
 * surface as "Activity.Foo__c"; OCR_Opportunity is the OpportunityContactRole
 * report prefix for Opportunity fields.
 */
const PREFIX_ALIASES: Record<string, string[]> = {
  activity: ["Task", "Event"],
  ocr_opportunity: ["Opportunity"],
};

export interface TrackedField {
  objectName: string;
  fieldApiName: string;
}

export type ObjectResolver = (prefix: string | null, field: string) => string[];

export function makeObjectResolver(customFields: readonly TrackedField[]): ObjectResolver {
  const objectsLower = new Map<string, string>(OBJECTS.map((o) => [o.toLowerCase(), o]));

  const fieldOwners = new Map<string, Set<string>>();
  for (const f of customFields) {
    let owners = fieldOwners.get(f.fieldApiName);
    if (!owners) fieldOwners.set(f.fieldApiName, (owners = new Set()));
    owners.add(f.objectName);
  }

  return (prefix, field) => {
    // Walk right-to-left: the segment nearest the field name is the one that
    // actually owns it. "Opportunity.Account.Foo__c" is an Account field reached
    // through Opportunity, so Account must win.
    const segments = (prefix ?? "").split(".").reverse();
    for (const segment of segments) {
      const seg = segment.toLowerCase();

      const exact = objectsLower.get(seg);
      if (exact) return [exact];

      const alias = PREFIX_ALIASES[seg];
      if (alias) {
        const owners = fieldOwners.get(field) ?? new Set<string>();
        const hits = alias.filter((o) => owners.has(o));
        if (hits.length) return hits;
      }
    }

    // Fallback: if the field name belongs to exactly one tracked object there is
    // no ambiguity to resolve, whatever the path said.
    const owners = fieldOwners.get(field);
    if (owners && owners.size === 1) return [...owners];

    // Ambiguous or untracked. Returning [] stores the row with a NULL object so
    // it stays auditable, but it is excluded from every count — better to
    // undercount a reference we can't attribute than to attribute it wrongly and
    // block a deletion for the wrong field.
    return [];
  };
}
