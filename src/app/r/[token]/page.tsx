import { notFound } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { HealthBar, HealthLegend, ObjectDot } from "@/components/HealthBar";
import { CoverageBanner } from "@/components/CoverageBanner";
import { ScanDriver } from "@/components/ScanDriver";
import { ScanStatusStrip } from "@/components/ScanStatusStrip";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";
import { loadByObject, loadSummary } from "@/lib/report/data";
import { OBJECTS, REFERENCE_PHASES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-US");

export default async function FieldTriagePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { returning?: string };
}) {
  const scan = await scanByToken(params.token);
  if (!scan) notFound();

  const [summary, byObject, progress] = await Promise.all([
    loadSummary(scan.id),
    loadByObject(scan.id),
    loadProgress(scan.id),
  ]);

  // Dependency-derived numbers keep refining until every reference source has
  // settled. Until then they are shown as pending rather than as final — a
  // count that is about to fall is not the same as a count that has landed.
  const depsSettled = progress.phases
    .filter((p) => REFERENCE_PHASES.includes(p.phase))
    .every((p) => p.status === "complete" || p.status === "failed" || p.status === "skipped");

  // The report is about custom fields, so an object with none has no row worth
  // reading — standard fields can't be deleted whatever their health. Listing
  // them anyway pads the table with grey bars and makes a focused report look
  // like a generic one. They stay in the census and the CSV; they just don't
  // compete for attention here.
  const triageable = byObject.filter((row) => row.custom_fields > 0);
  const noCustomFields = byObject.filter((row) => row.custom_fields === 0);

  // Objects absent from the census were never readable — typically the feature
  // isn't enabled (Quote without Quotes, Order without Orders). Saying so beats
  // a silently shorter list, which reads as though the scan missed them.
  const scanned = new Set(byObject.map((row) => row.object_name));
  const notEnabled = OBJECTS.filter((name) => !scanned.has(name));

  return (
    <Shell token={scan.token} active="field-triage">
      <ScanDriver token={scan.token} initialProgress={progress} />

      <div className="breadcrumb">
        <Link href={`/r/${scan.token}`}>Home</Link> › Metadata › Field Triage
      </div>

      <h1 className="page-title">Field Triage</h1>
      <p className="page-intro">
        Org-wide field health at a glance. Pick the object with the most delete-ready fields
        and start there — or open the full{" "}
        <Link href={`/r/${scan.token}/detail`}>triage detail</Link>.
      </p>

      {searchParams.returning === "1" && (
        <div className="coverage-banner" style={{ borderLeftColor: "#B5D333" }}>
          <span aria-hidden="true">↩</span>
          <div>
            <strong>You&apos;ve scanned this org before.</strong>
            This is your report from{" "}
            {new Date(scan.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}
            , so we didn&apos;t run a second scan or ask your org for anything new.{" "}
            <a href="/api/auth/start?fresh=1" style={{ color: "#B5D333", fontWeight: 600 }}>
              Run a fresh scan
            </a>{" "}
            if things have changed since.
          </div>
        </div>
      )}

      <ScanStatusStrip token={scan.token} initialProgress={progress} />

      <CoverageBanner phases={progress.phases} token={scan.token} />

      <div className="kpi-tiles">
        <div className="kpi-tile">
          <div className="tile-value">{fmt(summary.objects_scanned)}</div>
          <div className="tile-label">Objects Scanned</div>
        </div>

        <Link className="kpi-tile kpi-link" href={`/r/${scan.token}/detail`}>
          <div className="tile-value">{fmt(summary.fields_scanned)}</div>
          <div className="tile-label">Fields Scanned</div>
        </Link>

        <Link className="kpi-tile kpi-link tile-red" href={`/r/${scan.token}/detail?safe=1`}>
          <div className="tile-value">{fmt(summary.delete_ready)}</div>
          <div className="tile-label">Safe to Delete</div>
          <div className="tile-sub">&lt;1% populated · unchanged 90+ days</div>
        </Link>

        <Link
          className={`kpi-tile kpi-link tile-lime ${depsSettled ? "" : "tile-pending"}`}
          href={`/r/${scan.token}/detail?safe=1&zeroDeps=1`}
        >
          <div className="tile-value">{fmt(summary.ready_no_deps)}</div>
          <div className="tile-label">Safe to Delete — No Dependencies</div>
          {depsSettled ? (
            <div className="tile-sub">zero references anywhere · start here</div>
          ) : (
            <div className="pending-chip">
              <span className="pending-dot" /> still scanning
            </div>
          )}
        </Link>

        {/*
          Fields Deleted needs a previous snapshot to diff against, and a one-off
          scan has none. Rather than hide the tile or fake it, it states what it
          would take to make the number move — which is the product.
        */}
        <div className="kpi-tile tile-green">
          <div className="tile-value">0</div>
          <div className="tile-label">Fields Deleted</div>
          <div className="tile-sub">tracked from your first scan onward</div>
        </div>
      </div>

      <h2 className="section-title">By Object</h2>
      <p className="section-note">
        Listed alphabetically by object. <strong>Ready · 0 deps</strong> fields have no tracked
        references anywhere in Salesforce and can be removed without untangling anything
        first. Health bars cover <strong>custom fields only</strong> (native + managed) — dead
        standard fields can&apos;t be deleted, so they&apos;re excluded from every aggregate
        here.
      </p>

      <div className="census-table">
        <table>
          <thead>
            <tr>
              <th>Object</th>
              <th className="th-num">Fields</th>
              <th className="th-mid">Custom / Std / Managed</th>
              <th className="th-mid">Health (Custom)</th>
              <th className="th-num">
                Delete Ready&nbsp;
                <span className="info-tip" tabIndex={0}>
                  ⓘ
                  <span className="info-tip-text">
                    Native custom fields that are &lt;1% populated (for checkboxes: %
                    checked) and unchanged for 90+ days. Dependencies are deliberately not
                    part of this check — Ready · 0 Deps is the subset with zero references,
                    ready to delete as-is; the rest need their references reviewed first.
                  </span>
                </span>
              </th>
              <th className="th-num">Ready · 0 Deps</th>
              <th className="th-num">Dependencies</th>
              <th className="th-num">Deleted ✓</th>
            </tr>
          </thead>
          <tbody>
            {triageable.map((row) => (
              <tr key={row.object_name}>
                <td>
                  <Link
                    className="obj-link"
                    href={`/r/${scan.token}/detail?object=${encodeURIComponent(row.object_name)}`}
                  >
                    <ObjectDot object={row.object_name} />
                    {row.object_name} →
                  </Link>
                </td>
                <td className="num-cell">{fmt(row.total_fields)}</td>
                <td className="split-cell">
                  {fmt(row.custom_fields)} / {fmt(row.standard_fields)} /{" "}
                  {fmt(row.managed_fields)}
                </td>
                <td className="health-cell">
                  <HealthBar
                    dead={row.dead_fields}
                    low={row.low_fields}
                    partial={row.partial_fields}
                    healthy={row.healthy_fields}
                    noData={row.no_data_fields}
                  />
                </td>
                <td className="num-cell">
                  {row.delete_ready > 0 ? (
                    <Link
                      className="metric-link val-ready"
                      href={`/r/${scan.token}/detail?object=${encodeURIComponent(row.object_name)}&safe=1`}
                    >
                      {fmt(row.delete_ready)}
                    </Link>
                  ) : (
                    <span className="val-zero">{fmt(row.delete_ready)}</span>
                  )}
                </td>
                <td className="num-cell">
                  {!depsSettled ? (
                    <span className="val-unknown" title="Still scanning references">
                      …
                    </span>
                  ) : row.ready_no_deps > 0 ? (
                    <Link
                      className="metric-link val-noDeps"
                      href={`/r/${scan.token}/detail?object=${encodeURIComponent(row.object_name)}&safe=1&zeroDeps=1`}
                    >
                      {fmt(row.ready_no_deps)}
                    </Link>
                  ) : (
                    <span className="val-zero">{fmt(row.ready_no_deps)}</span>
                  )}
                </td>
                <td className="num-cell">
                  {depsSettled ? (
                    fmt(row.total_dependencies)
                  ) : (
                    <span className="val-unknown">…</span>
                  )}
                </td>
                <td className="num-cell">
                  <span className="val-zero">0</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <HealthLegend />

      {(noCustomFields.length > 0 || notEnabled.length > 0) && (
        <p
          className="legend"
          style={{ marginTop: "0.75rem", display: "block", lineHeight: 1.6 }}
        >
          {noCustomFields.length > 0 && (
            <>
              Also scanned, nothing to triage —{" "}
              <strong>{noCustomFields.map((r) => r.object_name).join(", ")}</strong> have no
              custom fields, so there is nothing on them you could delete.{" "}
            </>
          )}
          {notEnabled.length > 0 && (
            <>
              <strong>{notEnabled.join(", ")}</strong>{" "}
              {notEnabled.length === 1 ? "isn't" : "aren't"} enabled in this org, so{" "}
              {notEnabled.length === 1 ? "it was" : "they were"} skipped.
            </>
          )}
        </p>
      )}

      <div className="hero" style={{ marginTop: "2.5rem" }}>
        <div className="hero-eyebrow">This is one page of Data Jungle</div>
        <h2 className="hero-title">Want the other pages — and the deletions tracked?</h2>
        <p className="hero-sub">
          Profile Triage, Report Triage, dependency remediation, and a nightly re-scan so
          Fields Deleted actually counts up. Data Jungle builds your revenue data platform —
          done for you, and yours to keep.
        </p>
        <a
          className="hero-cta"
          href="https://calendly.com/brendan-mcdonald/30min"
          target="_blank"
          rel="noreferrer"
        >
          Book a call →
        </a>
      </div>
    </Shell>
  );
}
