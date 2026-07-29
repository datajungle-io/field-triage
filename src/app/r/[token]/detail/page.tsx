import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ObjectDot } from "@/components/HealthBar";
import { CoverageBanner } from "@/components/CoverageBanner";
import { ScanDriver } from "@/components/ScanDriver";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";
import { loadByObject, loadCensus, type CensusRow } from "@/lib/report/data";
import { REFERENCE_PHASES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-US");

const BUCKET_CLASS: Record<string, string> = {
  Dead: "bucket-dead",
  Low: "bucket-low",
  Partial: "bucket-partial",
  Healthy: "bucket-healthy",
  "No Data": "bucket-no-data",
};

/**
 * "No Data" covers three unrelated situations and the difference matters — one
 * of them means the connecting user can't see the field at all, which is a
 * statement about the scan rather than about the field.
 */
const NO_DATA_EXPLANATION: Record<string, string> = {
  not_visible:
    "This field exists in your metadata but Salesforce didn't return it when describing the object — usually field-level security hiding it from the connecting user, or an internal field. It couldn't be measured.",
  not_aggregatable:
    "Salesforce won't run COUNT() on this field type — compound address fields and long text areas can't be measured this way.",
  no_records:
    "This object has no records, so there's nothing to measure. That's not evidence the field is unused.",
};

interface SearchParams {
  object?: string;
  safe?: string;
  zeroDeps?: string;
  /** Opt-ins, both off by default — see the filter defaults below. */
  standard?: string;
  noData?: string;
}

export default async function DetailPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: SearchParams;
}) {
  const scan = await scanByToken(params.token);
  if (!scan) notFound();

  const object = searchParams.object ?? "All Objects";
  const safeOnly = searchParams.safe === "1";
  const zeroDepsOnly = searchParams.zeroDeps === "1";

  // Two defaults that decide what this page is for. It's a list of deletion
  // candidates, not a schema dump: standard fields can never be deleted, and a
  // field with no population measurement can't be judged. Both are opt-in
  // rather than gone — the counts below say exactly what's hidden, and the CSV
  // still contains everything.
  const showStandard = searchParams.standard === "1";
  const showNoData = searchParams.noData === "1";

  const [rows, allRows, objects, progress] = await Promise.all([
    loadCensus(scan.id, {
      object,
      safeOnly,
      zeroDepsOnly,
      customOnly: !showStandard,
      includeNoData: showNoData,
    }),
    // Unfiltered, for an honest "n hidden" count rather than a silent omission.
    loadCensus(scan.id, { object, safeOnly, zeroDepsOnly, includeNoData: true }),
    loadByObject(scan.id),
    loadProgress(scan.id),
  ]);

  const hiddenStandard = showStandard ? 0 : allRows.filter((r) => !r.is_custom).length;
  const hiddenNoData = showNoData
    ? 0
    : allRows.filter((r) => r.bucket === "No Data" && (showStandard || r.is_custom)).length;

  const depsSettled = progress.phases
    .filter((p) => REFERENCE_PHASES.includes(p.phase))
    .every((p) => p.status === "complete" || p.status === "failed" || p.status === "skipped");

  const query = (next: Partial<SearchParams>) => {
    const merged = {
      object,
      safe: safeOnly ? "1" : "",
      zeroDeps: zeroDepsOnly ? "1" : "",
      standard: showStandard ? "1" : "",
      noData: showNoData ? "1" : "",
      ...next,
    };
    const sp = new URLSearchParams();
    if (merged.object && merged.object !== "All Objects") sp.set("object", merged.object);
    if (merged.safe === "1") sp.set("safe", "1");
    if (merged.zeroDeps === "1") sp.set("zeroDeps", "1");
    if (merged.standard === "1") sp.set("standard", "1");
    if (merged.noData === "1") sp.set("noData", "1");
    const qs = sp.toString();
    return `/r/${scan.token}/detail${qs ? `?${qs}` : ""}`;
  };

  // Setup deep links are built against the connected org's own domain — every
  // scan is a different org, so there is nothing to hardcode.
  const setup = scan.instance_url.replace(/\/+$/, "");

  return (
    <Shell
      token={scan.token}
      active="detail"
      orgName={scan.org_name}
      scannedAt={scan.created_at}
      expiresAt={scan.expires_at}
    >
      <ScanDriver token={scan.token} initialProgress={progress} />

      <div className="breadcrumb">
        Metadata › <Link href={`/r/${scan.token}`}>Field Triage</Link> › Triage Detail
      </div>

      <h1 className="page-title">Triage Detail</h1>
      <p className="page-intro">
        Every field the scan measured. Start with <strong>Ready · 0 deps</strong> — those have
        no tracked references anywhere and can go without untangling anything first.
      </p>

      <Link className="back-link" href={`/r/${scan.token}`}>
        ← Back to Field Triage
      </Link>

      <CoverageBanner phases={progress.phases} token={scan.token} />

      {/* Filters are plain links so the whole view is shareable and survives a
          reload — the production page keeps this state in sessionStorage, which
          a one-off report has no need for. */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <FilterChip href={query({ object: "All Objects" })} active={object === "All Objects"}>
          All objects
        </FilterChip>
        {objects.map((o) => (
          <FilterChip
            key={o.object_name}
            href={query({ object: o.object_name })}
            active={object === o.object_name}
          >
            {o.object_name}
          </FilterChip>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <FilterChip href={query({ safe: safeOnly ? "" : "1" })} active={safeOnly}>
          Candidates only
        </FilterChip>
        <FilterChip href={query({ zeroDeps: zeroDepsOnly ? "" : "1" })} active={zeroDepsOnly}>
          Zero dependencies only
        </FilterChip>
        <FilterChip href={query({ standard: showStandard ? "" : "1" })} active={showStandard}>
          {showStandard ? "Hide standard fields" : `Show standard fields (${fmt(hiddenStandard)})`}
        </FilterChip>
        <FilterChip href={query({ noData: showNoData ? "" : "1" })} active={showNoData}>
          {showNoData ? "Hide unmeasurable" : `Show unmeasurable (${fmt(hiddenNoData)})`}
        </FilterChip>
        <a
          className="hero-cta"
          style={{ marginTop: 0, padding: "0.35rem 0.8rem", fontSize: "0.78rem" }}
          href={`/api/r/${scan.token}/census.csv`}
        >
          Download CSV
        </a>
      </div>

      <p className="section-note">
        Showing <strong>{fmt(rows.length)}</strong>{" "}
        {showStandard ? "" : "custom "}field{rows.length === 1 ? "" : "s"}
        {object !== "All Objects" ? ` on ${object}` : ""}
        {safeOnly ? " · deletion candidates" : ""}
        {zeroDepsOnly ? " · zero dependencies" : ""}.
        {(hiddenStandard > 0 || hiddenNoData > 0) && (
          <span style={{ color: "hsl(var(--base-content) / 0.55)" }}>
            {" "}
            Hidden:{" "}
            {[
              hiddenStandard > 0
                ? `${fmt(hiddenStandard)} standard field${hiddenStandard === 1 ? "" : "s"} (can't be deleted)`
                : null,
              hiddenNoData > 0
                ? `${fmt(hiddenNoData)} with no population measurement`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            . The CSV export includes everything.
          </span>
        )}
      </p>

      <div className="census-table">
        <table>
          <thead>
            <tr>
              <th>Object</th>
              <th>Field</th>
              <th>Label</th>
              <th>Type</th>
              <th className="th-num">% Populated</th>
              <th className="th-mid">Health</th>
              {/* No "On Layout" column: a field on a layout already appears in
                  Dependencies as a Layout reference from the Dependency API, and
                  the drill page names the actual layouts — strictly more useful
                  than a checkmark. It was carried over from the dbt model, where
                  it was informational. */}
              <th className="th-num">Dependencies</th>
              <th>Last Modified</th>
              <th className="th-mid">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FieldRow
                key={`${row.object_name}.${row.field_api_name}`}
                row={row}
                token={scan.token}
                setup={setup}
                depsSettled={depsSettled}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="section-note" style={{ marginTop: "1.5rem" }}>
          No fields match this filter.
        </p>
      )}
    </Shell>
  );
}

function FieldRow({
  row,
  token,
  setup,
  depsSettled,
}: {
  row: CensusRow;
  token: string;
  setup: string;
  depsSettled: boolean;
}) {
  // Standard fields carry their API name as the id, custom fields their durable
  // id — Object Manager accepts both in this position. Null only when the
  // Tooling lookup and the DurableId fallback both came up empty, in which case
  // a link would 404, so the label stays plain text.
  const setupUrl = row.field_id
    ? `${setup}/lightning/setup/ObjectManager/${row.object_name}/FieldsAndRelationships/${row.field_id}/view`
    : null;

  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        <ObjectDot object={row.object_name} />
        {row.object_name}
      </td>
      <td>
        <span className="field-name">{row.field_api_name}</span>
        {row.namespace_prefix && (
          <>
            {" "}
            <span className="ns-pill">{row.namespace_prefix}</span>
          </>
        )}
      </td>
      <td style={{ fontSize: "0.78rem" }}>
        {setupUrl ? (
          <a
            className="ref-link"
            href={setupUrl}
            target="_blank"
            rel="noreferrer"
            title={`Open ${row.field_api_name} in Salesforce Setup`}
          >
            {row.field_label ?? row.field_api_name}
          </a>
        ) : (
          (row.field_label ?? "—")
        )}
      </td>
      <td>
        <span className="type-badge">{row.sf_type ?? "—"}</span>
      </td>
      <td className="num-cell">
        {row.population_pct === null ? (
          <span className="val-unknown" title="Not measurable — no records, or a compound field">
            —
          </span>
        ) : (
          `${row.population_pct}%`
        )}
      </td>
      <td className="health-cell">
        {row.bucket === "No Data" && row.no_data_reason ? (
          <span className="info-tip" tabIndex={0}>
            <span className={`bucket-pill ${BUCKET_CLASS[row.bucket]}`}>
              {row.no_data_reason === "not_visible" ? "Not visible" : "No Data"}
            </span>
            <span className="info-tip-text">
              {NO_DATA_EXPLANATION[row.no_data_reason]}
            </span>
          </span>
        ) : (
          <span className={`bucket-pill ${BUCKET_CLASS[row.bucket] ?? ""}`}>{row.bucket}</span>
        )}
      </td>
      <td className="num-cell">
        {!depsSettled && row.dependency_count === null ? (
          <span className="val-unknown">…</span>
        ) : row.dependency_count === null ? (
          <span className="val-unknown" title="Dependencies are only tracked for custom fields">
            —
          </span>
        ) : (
          <Link
            className={`dep-link ${row.dependency_count === 0 ? "dep-zero" : ""}`}
            href={`/r/${token}/${encodeURIComponent(row.object_name)}/${encodeURIComponent(row.field_api_name)}`}
          >
            {row.dependency_count}
          </Link>
        )}
      </td>
      <td className="date-cell">
        {row.last_modified_date ? row.last_modified_date.slice(0, 10) : "—"}
      </td>
      <td className="health-cell">
        {row.is_safe_to_delete && row.dependency_count === 0 ? (
          <span className="ready-pill">Ready · 0 deps</span>
        ) : row.is_safe_to_delete ? (
          <span className="val-ready" style={{ fontSize: "0.72rem" }}>
            Review deps
          </span>
        ) : (
          <span className="val-zero" style={{ fontSize: "0.72rem" }}>
            Keep
          </span>
        )}
      </td>
    </tr>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        padding: "0.3rem 0.7rem",
        borderRadius: 6,
        fontSize: "0.78rem",
        fontWeight: active ? 600 : 400,
        textDecoration: "none",
        border: `1px solid ${active ? "#B5D333" : "hsl(var(--base-300))"}`,
        color: active ? "#B5D333" : "hsl(var(--base-content) / 0.7)",
        boxShadow: active ? "0 0 0 1px #B5D333" : undefined,
      }}
    >
      {children}
    </Link>
  );
}
