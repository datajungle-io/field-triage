/**
 * Census semantics regression test.
 *
 * Applies the migrations to an in-process Postgres (PGlite) and asserts the
 * behaviour that actually matters — the delete-ready predicate, the health
 * buckets, and the NULL-vs-0 dependency distinction that progressive reveal
 * depends on. These are the rules a Salesforce admin will act on, so a
 * regression here deletes someone's live field.
 *
 * Run with: npm run test:schema
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const db = new PGlite();

for (const file of ["0001_init.sql", "0002_report_functions.sql", "0003_hardening.sql", "0004_cli_sessions.sql", "0005_no_data_reason.sql"]) {
  const sql = readFileSync(`${MIGRATIONS}/${file}`, "utf8");
  try {
    await db.exec(sql);
    console.log(`✓ ${file} applied`);
  } catch (err) {
    console.error(`✗ ${file} FAILED:\n  ${err.message}`);
    process.exit(1);
  }
}

// --- Exercise the census logic with a fixture -----------------------------
// The point isn't that the SQL parses, it's that the delete-ready predicate and
// the NULL-vs-0 dependency distinction behave as the production dbt model does.

const scan = (
  await db.query(
    `insert into scans (token, org_id, instance_url) values ('t'||repeat('x',31), '00Dxx', 'https://x.my.salesforce.com') returning id`,
  )
).rows[0].id;

await db.exec(`
  insert into scan_phases (scan_id, phase, position, status) values
    ('${scan}', 'identity', 0, 'complete'),
    ('${scan}', 'field_definitions', 1, 'complete'),
    ('${scan}', 'population', 2, 'complete'),
    ('${scan}', 'dependencies_mcd', 3, 'pending'),
    ('${scan}', 'flexipages', 5, 'pending'),
    ('${scan}', 'reports', 6, 'pending'),
    ('${scan}', 'report_types', 7, 'pending');
`);

await db.exec(`
  insert into scan_fields
    (scan_id, object_name, field_api_name, is_custom, namespace_prefix,
     last_modified_date, populated_count, total_records, population_pct)
  values
    -- dead, old, native custom  -> delete-ready
    ('${scan}', 'Lead', 'Dead__c',      true,  null, now() - interval '200 days', 2,    1000, 0.002),
    -- dead but modified recently -> NOT delete-ready
    ('${scan}', 'Lead', 'Recent__c',    true,  null, now() - interval '10 days',  1,    1000, 0.001),
    -- dead but managed package  -> NOT delete-ready
    ('${scan}', 'Lead', 'Pkg__c',       true,  'ACME', now() - interval '400 days', 0,  1000, 0.000),
    -- object measured, field not aggregatable (compound address / long text)
    ('${scan}', 'Lead', 'Unmeasured__c',true,  null, now() - interval '400 days', null, 1000, null),
    -- never returned by describe (field-level security / internal field):
    -- total_records NULL means the population phase never wrote this row
    ('${scan}', 'Lead', 'Hidden__c',    true,  null, now() - interval '400 days', null, null, null),
    -- object exists but holds no records at all
    ('${scan}', 'Lead', 'EmptyObj__c',  true,  null, now() - interval '400 days', 0,    0,    null),
    -- standard field, dead      -> NOT delete-ready, excluded from health
    ('${scan}', 'Lead', 'Fax',          false, null, now() - interval '400 days', 0,    1000, 0.000),
    -- healthy
    ('${scan}', 'Lead', 'Alive__c',     true,  null, now() - interval '400 days', 950,  1000, 0.95);
`);

const before = (await db.query(`select * from field_census where scan_id = $1 order by field_api_name`, [scan])).rows;

console.log("\n--- reference phases still pending ---");
for (const r of before) {
  console.log(
    `  ${r.field_api_name.padEnd(16)} bucket=${String(r.bucket).padEnd(8)} ` +
      `cat=${String(r.namespace_category).padEnd(16)} deps=${r.dependency_count === null ? "NULL" : r.dependency_count} ` +
      `safe=${r.is_safe_to_delete}`,
  );
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ASSERTION FAILED: ${msg}`);
    process.exitCode = 1;
  } else console.log(`✓ ${msg}`);
};

console.log();
const by = Object.fromEntries(before.map((r) => [r.field_api_name, r]));
assert(by.Dead__c.is_safe_to_delete === true, "dead + old + native custom is delete-ready");
assert(by.Recent__c.is_safe_to_delete === false, "recently modified is not delete-ready");
assert(by.Pkg__c.is_safe_to_delete === false, "managed package field is not delete-ready");
assert(by.Unmeasured__c.bucket === "No Data", "unmeasurable field buckets as No Data");
assert(by.Unmeasured__c.is_safe_to_delete === false, "No Data is never delete-ready");

// The three No Data causes must stay distinguishable. not_visible in particular
// is a statement about the scan's reach, not about the field.
assert(
  by.Unmeasured__c.no_data_reason === "not_aggregatable",
  "measured object + unmeasurable field -> not_aggregatable",
);
assert(by.Hidden__c.no_data_reason === "not_visible", "absent from describe -> not_visible");
assert(by.EmptyObj__c.no_data_reason === "no_records", "empty object -> no_records");
assert(by.Alive__c.no_data_reason === null, "a measured field has no no_data_reason");
assert(
  by.Hidden__c.is_safe_to_delete === false && by.EmptyObj__c.is_safe_to_delete === false,
  "neither unmeasured case is ever delete-ready",
);
assert(by.Fax.is_safe_to_delete === false, "standard field is not delete-ready");
assert(by.Alive__c.bucket === "Healthy", "95% populated buckets as Healthy");
assert(by.Pkg__c.namespace_category === "Managed Package", "namespace_prefix implies Managed Package");
assert(by.Fax.namespace_category === "Standard", "non-custom implies Standard");
assert(
  before.every((r) => r.dependency_count === null),
  "dependency_count is NULL while reference phases are pending (not 0)",
);

const kpiPending = (await db.query(`select * from scan_summary($1)`, [scan])).rows[0];
assert(Number(kpiPending.ready_no_deps) === 0, "ready_no_deps is 0 while dependencies are unknown");
assert(Number(kpiPending.delete_ready) === 1, "delete_ready is available before dependencies land");

// --- Now settle the reference phases and add one reference ---------------
await db.exec(`
  update scan_phases set status = 'complete'
  where scan_id = '${scan}' and phase in ('dependencies_mcd','flexipages','reports','report_types');

  insert into scan_field_refs (scan_id, object_name, field_api_name, reference_type, reference_id, reference_name, source)
  values
    ('${scan}', 'Lead', 'Dead__c', 'Report', '00O1', 'Old_Report', 'report_scan'),
    -- same component seen by two scanners: must dedupe to one
    ('${scan}', 'Lead', 'Alive__c', 'FlexipageFieldInstance', '0M01', 'Lead_Record_Page', 'dependency_api'),
    ('${scan}', 'Lead', 'Alive__c', 'FlexipageFieldInstance', '0M01', 'Lead_Record_Page', 'flexipage_scan'),
    -- unattributable token: kept for audit, excluded from counts
    ('${scan}', null,   'Dead__c', 'Report', '00O2', 'Ambiguous', 'report_scan');
`);

const after = Object.fromEntries(
  (await db.query(`select * from field_census where scan_id = $1`, [scan])).rows.map((r) => [
    r.field_api_name,
    r,
  ]),
);

console.log("\n--- reference phases complete ---");
assert(Number(after.Dead__c.dependency_count) === 1, "Dead__c has 1 dependency (NULL-object row excluded)");
assert(Number(after.Alive__c.dependency_count) === 1, "duplicate across two sources dedupes to 1");
assert(Number(after.Recent__c.dependency_count) === 0, "verified-no-references reads as 0, not NULL");
assert(after.Fax.dependency_count === null, "standard fields never get a dependency count");

const kpi = (await db.query(`select * from scan_summary($1)`, [scan])).rows[0];
assert(Number(kpi.ready_no_deps) === 0, "Dead__c drops out of ready_no_deps once its report is found");
assert(Number(kpi.delete_ready) === 1, "delete_ready is unchanged by dependencies");

const obj = (await db.query(`select * from scan_by_object($1)`, [scan])).rows[0];
console.log("\nBy Object:", JSON.stringify(obj));
assert(Number(obj.total_fields) === 8, "By Object counts every field");
assert(Number(obj.standard_fields) === 1, "By Object splits standard fields out");
assert(
  Number(obj.dead_fields) === 3,
  "health counts exclude the dead STANDARD field (3 dead customs, not 4)",
);
// Unmeasured__c, Hidden__c and EmptyObj__c — three different reasons, one bucket.
assert(Number(obj.no_data_fields) === 3, "No Data is its own health segment");

const refSummary = (await db.query(`select * from field_reference_summary($1,'lead','dead__c')`, [scan])).rows;
assert(refSummary.length === 1 && Number(refSummary[0].ref_count) === 1, "reference summary is case-insensitive");

console.log(process.exitCode ? "\nFAILED" : "\nAll schema assertions passed");
