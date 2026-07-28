import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";
import { loadFieldReferences, loadFieldRow, type ReferenceRow } from "@/lib/report/data";

export const dynamic = "force-dynamic";

/**
 * "Where is this used?" — the drill behind a dependency count.
 *
 * Laid out to match the production Data Jungle page
 * (evidence/pages/metadata/field-triage/[object_name]/[field_api_name].md): one
 * flat table sorted by reference type, with count pills above it. Grouping the
 * rows into per-type sections seemed tidier but made a long list harder to scan
 * and diverged from Salesforce Setup's own "Where is this used?" view, which is
 * what an admin is holding this next to.
 */

/** Friendly names for the reference types Salesforce shows in Setup. */
const TYPE_LABELS: Record<string, string> = {
  FlexipageFieldInstance: "Lightning Record Page",
  Layout: "Page Layout",
  Report: "Report",
  ReportType: "Report Type",
  ApexClass: "Apex Class",
  ApexTrigger: "Apex Trigger",
  Flow: "Flow",
  ValidationRule: "Validation Rule",
  // A CustomField-type dependency means another field's formula references this
  // one, which the raw type name doesn't convey.
  CustomField: "Formula Field",
  EmailTemplate: "Email Template",
  AuraDefinitionBundle: "Aura Component",
  LightningComponentBundle: "Lightning Web Component",
  WebLink: "Button or Link",
};

export default async function FieldDrillPage({
  params,
}: {
  params: { token: string; object: string; field: string };
}) {
  const scan = await scanByToken(params.token);
  if (!scan) notFound();

  const object = decodeURIComponent(params.object);
  const field = decodeURIComponent(params.field);

  const [row, references, progress] = await Promise.all([
    loadFieldRow(scan.id, object, field),
    loadFieldReferences(scan.id, object, field),
    loadProgress(scan.id),
  ]);

  if (!row) notFound();

  // Setup links are built against the connected org's own domain, not a
  // hardcoded one — every scan is a different org.
  const setup = scan.instance_url.replace(/\/+$/, "");
  const fieldSetupUrl = row.field_id
    ? `${setup}/lightning/setup/ObjectManager/${row.object_name}/FieldsAndRelationships/${row.field_id}/view`
    : null;

  const sorted = [...references].sort(
    (a, b) =>
      a.reference_type.localeCompare(b.reference_type) ||
      (a.reference_label ?? "").localeCompare(b.reference_label ?? ""),
  );

  const summary = new Map<string, number>();
  for (const ref of sorted) {
    summary.set(ref.reference_type, (summary.get(ref.reference_type) ?? 0) + 1);
  }

  const reportGap = progress.phases.find((p) => p.phase === "reports" && p.failed > 0);

  return (
    <Shell token={scan.token} active="detail">
      <div className="breadcrumb">
        <Link href={`/r/${scan.token}`}>Home</Link> › Metadata ›{" "}
        <Link href={`/r/${scan.token}`}>Field Triage</Link> ›{" "}
        <Link href={`/r/${scan.token}/detail`}>Triage Detail</Link> › Where Is This Used
      </div>

      <Link
        className="back-link"
        href={`/r/${scan.token}/detail?object=${encodeURIComponent(object)}`}
      >
        ← Triage Detail
      </Link>

      <h2 className="field-title">{row.field_label ?? row.field_api_name}</h2>

      <p className="wiu-subtitle">
        <span className="obj-pill">{row.object_name}</span>
        <span className="field-name">{row.field_api_name}</span>
        {row.sf_type && <span className="type-badge">{row.sf_type}</span>}
        {row.namespace_prefix && <span className="ns-pill">{row.namespace_prefix}</span>}
        {fieldSetupUrl && (
          <a className="setup-link" href={fieldSetupUrl} target="_blank" rel="noreferrer">
            Open in Setup →
          </a>
        )}
      </p>

      {/* The context the reader needs, without a block of tiles between them and
          the list they came here for. */}
      <p className="section-note">
        {row.population_pct === null
          ? "Population not measurable"
          : `${row.population_pct}% populated`}
        {row.populated_count !== null && row.total_records
          ? ` · ${row.populated_count.toLocaleString("en-US")} of ${row.total_records.toLocaleString("en-US")} records`
          : ""}
        {row.last_modified_date ? ` · last modified ${row.last_modified_date.slice(0, 10)}` : ""}
        {" · "}
        <strong
          style={{
            color: row.is_safe_to_delete && references.length === 0 ? "#B5D333" : undefined,
          }}
        >
          {row.is_safe_to_delete && references.length === 0
            ? "Ready · 0 deps"
            : row.is_safe_to_delete
              ? "Clear dependencies first"
              : "Keep"}
        </strong>
      </p>

      <p className="section-note">
        Here are the references to this field, sorted alphabetically by reference type — the
        same view as Salesforce Setup&apos;s &quot;Where is this used?&quot; button. To make
        the field safe to delete, remove each one; never delete the field first.
      </p>

      {summary.size > 0 && (
        <div className="type-pills">
          {[...summary.entries()].map(([type, count]) => (
            <span className="type-pill" key={type}>
              {TYPE_LABELS[type] ?? type} <strong>×&nbsp;{count}</strong>
            </span>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">
          No tracked references — this field doesn&apos;t appear on any layout, Lightning
          page, report, or report type we can scan. Check the coverage note before treating
          it as unused.
        </div>
      ) : (
        <div className="census-table">
          <table>
            <thead>
              <tr>
                <th>Reference Type</th>
                <th>Reference Label</th>
                <th>API Name</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ref, i) => {
                const url = refUrl(setup, ref);
                return (
                  <tr key={`${ref.reference_id ?? ref.reference_name}-${i}`}>
                    <td>
                      <span className={`ref-type ref-${ref.reference_type}`}>
                        {ref.reference_type}
                      </span>
                    </td>
                    <td>
                      {url ? (
                        <a className="ref-link" href={url} target="_blank" rel="noreferrer">
                          {ref.reference_label ?? ref.reference_name ?? "(unnamed)"}
                        </a>
                      ) : (
                        (ref.reference_label ?? ref.reference_name ?? "(unnamed)")
                      )}
                    </td>
                    <td className="field-name">{ref.reference_name ?? "—"}</td>
                    <td className="detail-cell">{locationLabel(ref)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reportGap && (
        <div className="coverage-note">
          ⚠ {reportGap.failed.toLocaleString("en-US")} of{" "}
          {reportGap.total.toLocaleString("en-US")} reports couldn&apos;t be scanned (folders
          this user can&apos;t access), so report references may be undercounted. A zero here
          means <em>no tracked references</em>, not proof the field is unused.
        </div>
      )}
    </Shell>
  );
}

/**
 * Deep links matching what Setup's "Where is this used?" links per type.
 * Object-scoped URLs use the field's own object, which is right for layouts and
 * Lightning pages; a cross-object formula reference may 404 in Setup.
 */
function refUrl(setup: string, row: ReferenceRow): string | null {
  const id = row.reference_id;
  if (!id) return null;
  const obj = row.object_name;

  switch (row.reference_type) {
    case "FlexipageFieldInstance":
      return `${setup}/lightning/setup/ObjectManager/${obj}/LightningPages/${id}/view`;
    case "Layout":
      return `${setup}/lightning/setup/ObjectManager/${obj}/PageLayouts/${id}/view`;
    case "Flow":
      return `${setup}/builder_platform_interaction/flowBuilder.app?flowId=${id}`;
    case "ReportType":
      return `${setup}/lightning/setup/CustomReportTypeLightning/${id}/view`;
    case "Report":
      return `${setup}/lightning/r/Report/${id}/view`;
    case "ApexClass":
      return `${setup}/lightning/setup/ApexClasses/page?address=%2F${id}`;
    case "ApexTrigger":
      return `${setup}/lightning/setup/ApexTriggers/page?address=%2F${id}`;
    case "ValidationRule":
      return `${setup}/lightning/setup/ObjectManager/${obj}/ValidationRules/${id}/view`;
    case "CustomField":
      return `${setup}/lightning/setup/ObjectManager/${obj}/FieldsAndRelationships/${id}/view`;
    case "EmailTemplate":
      return `${setup}/lightning/setup/CommunicationTemplatesEmail/page?address=%2F${id}`;
    default:
      return null;
  }
}

/** Where in Salesforce this reference lives — the place you go to remove it. */
function locationLabel(row: ReferenceRow): string {
  const obj = row.object_name;
  switch (row.reference_type) {
    case "Layout":
      return `${obj} → Page Layouts`;
    case "FlexipageFieldInstance":
      return `${obj} → Lightning Record Pages`;
    case "ValidationRule":
      return `${obj} → Validation Rules`;
    case "CustomField":
      return `${obj} → Fields & Relationships`;
    case "WebLink":
      return `${obj} → Buttons, Links & Actions`;
    case "Report":
      return row.reference_detail ? `Reports → ${row.reference_detail}` : "Reports";
    case "ReportType":
      return "Setup → Report Types";
    case "Flow":
      return "Setup → Flows";
    case "ApexClass":
      return "Setup → Apex Classes";
    case "ApexTrigger":
      return "Setup → Apex Triggers";
    case "EmailTemplate":
      return "Setup → Email Templates";
    default:
      return row.reference_detail ?? "—";
  }
}
