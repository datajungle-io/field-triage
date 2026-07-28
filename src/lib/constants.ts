/**
 * Scan scope.
 *
 * Every phase iterates OBJECTS, so a field's dependency count is only ever
 * reported for an object the reference scanner actually covered. Widening or
 * narrowing the scan is this one constant.
 *
 * The lead magnet deliberately runs NARROWER than the production pipeline
 * (salesforce/jobs/ingest_field_references.py, and ref_tracked_objects in dbt
 * marts/field_census/fct_field_census.sql), which tracks all 11 below. The four
 * core objects are where a free report earns its keep:
 *
 *   - Most orgs have zero custom fields on Quote/Contract/Order/Asset/Campaign,
 *     so those rows were pure noise — the thing every reader had to skip past.
 *   - Task and Event carry the scan's messiest special-casing: their custom
 *     fields live on the shared `Activity` entity and their totals need
 *     queryAll to include archived rows. Real complexity, few findings.
 *   - On the reference org this still captures 25 of 29 custom fields.
 *
 * Note it does NOT make the scan much faster: the report sweep dominates, and
 * it is org-wide because a report on any object can reach a tracked field
 * through a lookup path. Narrowing saves the population phase, not the sweep.
 *
 * To restore full production parity, set OBJECTS = ALL_OBJECTS. The Activity
 * aliasing and queryAll handling below stay in place either way — they cost
 * nothing while unused and are needed the moment Task/Event come back.
 */
export const CORE_OBJECTS = ["Lead", "Account", "Contact", "Opportunity"] as const;

/** Full production scope, kept for parity runs and easy widening. */
export const ALL_OBJECTS = [
  "Lead",
  "Account",
  "Contact",
  "Opportunity",
  "Quote",
  "Contract",
  "Order",
  "Asset",
  "Task",
  "Event",
  "Campaign",
] as const;

export const OBJECTS: readonly string[] = CORE_OBJECTS;

export type TrackedObject = (typeof ALL_OBJECTS)[number];

/**
 * Task/Event have no records of their own — archived activities are only visible
 * through queryAll. Without this their totals reflect a frozen subset and every
 * population percentage on those objects is wrong.
 */
export const QUERYALL_OBJECTS = new Set<string>(["Task", "Event"]);

/**
 * Custom fields on Task and Event live on the shared `Activity` entity, so
 * Tooling CustomField returns TableEnumOrId = 'Activity' for both. Every lookup
 * keyed on object name has to try the alias too or Task/Event custom fields come
 * back with no Id, and with no Id they can't be matched to their dependencies.
 */
export const ENTITY_ALIASES: Record<string, string> = {
  Task: "Activity",
  Event: "Activity",
};

/** COUNT(field) aliases per SOQL query. Salesforce rejects much beyond this. */
export const COUNT_BATCH_SIZE = 25;

export const API_VERSION = "v62.0";

/** Health buckets — thresholds from fct_field_census.sql. */
export const BUCKETS = ["Dead", "Low", "Partial", "Healthy", "No Data"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const PHASES = [
  "identity",
  "field_definitions",
  "population",
  "dependencies_mcd",
  "layouts",
  "flexipages",
  "reports",
  "report_types",
  "finalize",
] as const;

export type Phase = (typeof PHASES)[number];

/** Phases whose completion unlocks dependency counts (see the field_census view). */
export const REFERENCE_PHASES: Phase[] = [
  "dependencies_mcd",
  "flexipages",
  "reports",
  "report_types",
];

/** Human labels for the live scan screen. */
export const PHASE_LABELS: Record<Phase, string> = {
  identity: "Identifying your org",
  field_definitions: "Reading field definitions",
  population: "Measuring field population",
  dependencies_mcd: "Tracing dependencies",
  layouts: "Checking page layouts",
  flexipages: "Scanning Lightning pages",
  reports: "Scanning reports",
  report_types: "Scanning report types",
  finalize: "Finishing up",
};

/**
 * The report renders as soon as this phase completes — population is what makes
 * "Safe to Delete" meaningful, and everything after it only refines dependency
 * counts downward.
 */
export const FIRST_PAINT_PHASE: Phase = "population";

/** Object dot colours, lifted from evidence/pages/metadata/field-triage.md. */
export const OBJECT_COLORS: Record<string, string> = {
  Account: "#7F8DE1",
  Contact: "#A094ED",
  Opportunity: "#FCB95B",
  Lead: "#00C2D8",
  Task: "#4BC076",
  Event: "#F07070",
  Quote: "#E57373",
  Asset: "#B5D333",
  AssetAction: "#8B5A3C",
  Contract: "#7B4FA0",
  Order: "#89CFF0",
  Campaign: "#F5B731",
};

export const OBJECT_COLOR_FALLBACK = "#94a3b8";
