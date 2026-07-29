"use client";

import { useEffect, useState } from "react";
import type { PhaseProgress } from "@/lib/scan/progress";
import type { MeasurementCoverage } from "@/lib/report/data";
import { referenceCoverage } from "@/lib/report/coverage";

/**
 * Discloses which reference sources didn't fully scan.
 *
 * Equivalent of the ⚠ banner on the production drill page, which reads from
 * field_reference_scan_stats. It exists because "0 dependencies" from a partial
 * scan and "0 dependencies" from a complete one look identical, and only one of
 * them means the field is safe to delete.
 *
 * Dismissing collapses it to a single line rather than removing it. The caveat
 * still applies to every number on the page — and to the CSV someone will act
 * on — so it stays reachable. What it stops doing is dominating a report where
 * the gap is one report out of 142.
 */

const SOURCE_LABELS: Record<string, string> = {
  dependencies_mcd: "Layouts, Apex, Flows and Validation Rules",
  flexipages: "Lightning record pages",
  reports: "Reports",
  report_types: "Custom report types",
};

const HINTS: Record<string, string> = {
  report_types:
    "Custom report types are read through the Metadata API, which needs the “Modify Metadata Through Metadata API Functions” or “Modify All Data” permission.",
  reports: "Reports in folders the connecting user can't open return a permission error.",
};


export function CoverageBanner({
  phases,
  token,
  measurement,
}: {
  phases: PhaseProgress[];
  token: string;
  /**
   * Fields the scan couldn't read. Optional so the drill pages, which are
   * about references rather than population, can omit it.
   */
  measurement?: MeasurementCoverage;
}) {
  const gaps = phases.filter(
    (p) =>
      p.phase in SOURCE_LABELS &&
      (p.status === "failed" || p.status === "skipped" || p.failed > 0),
  );

  // Same materiality rule the KPI tiles use, so the banner can't start
  // collapsed while a tile is shouting about the very same gap.
  const ref = referenceCoverage(phases);
  const totalComponents = gaps.reduce((sum, g) => sum + g.total, 0);
  const totalFailed = gaps.reduce((sum, g) => sum + g.failed, 0);

  // Fields we couldn't see at all. Reported alongside unreadable references
  // because both end in the same place — a number that looks like an answer but
  // is really an absence.
  const hidden = measurement?.notVisible ?? 0;
  const hiddenShare = measurement?.hiddenShare ?? 0;

  // Hidden fields are never "minor". A reference gap weakens one column; a
  // field the scan never saw is missing from every number on the page,
  // including the headline candidate count.
  const minor = !ref.material && hidden === 0;

  const storageKey = `ft:coverage-dismissed:${token}`;
  // Starts expanded for a material gap, collapsed for a trivial one; the stored
  // preference then wins. Read after mount so server and client markup agree.
  const [collapsed, setCollapsed] = useState(minor);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "1") setCollapsed(true);
    } catch {
      // Private browsing or storage disabled — the default stands.
    }
  }, [storageKey]);

  if (gaps.length === 0 && hidden === 0) return null;

  if (collapsed) {
    return (
      <p
        className="legend"
        style={{ margin: "0.75rem 0", display: "block", lineHeight: 1.6 }}
      >
        <span style={{ color: "#F5B731" }}>⚠</span>{" "}
        {hidden > 0
          ? `${hidden.toLocaleString("en-US")} custom field${hidden === 1 ? "" : "s"} couldn't be read.`
          : totalFailed > 0 && totalComponents > 0
            ? `Partial dependency coverage — ${(totalComponents - totalFailed).toLocaleString("en-US")} of ${totalComponents.toLocaleString("en-US")} components read.`
            : "Some dependency sources were unavailable."}{" "}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            color: "#89CFF0",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          What this means
        </button>
      </p>
    );
  }

  return (
    <div className="coverage-banner" style={{ position: "relative" }}>
      <span aria-hidden="true">⚠</span>
      <div style={{ flex: 1, paddingRight: "1.5rem" }}>
        {/* Hidden fields lead when present. A reference gap qualifies one
            column; fields the scan never saw are missing from every number
            here, so the reader needs that first. */}
        {hidden > 0 ? (
          <>
            <strong>
              {hidden.toLocaleString("en-US")} custom field
              {hidden === 1 ? "" : "s"} couldn&apos;t be read
              {measurement && measurement.customFields > 0
                ? ` — ${Math.round(hiddenShare * 100)}% of the custom fields on these objects.`
                : "."}
            </strong>
            Salesforce didn&apos;t return {hidden === 1 ? "it" : "them"} when describing the
            object, which usually means field-level security is hiding{" "}
            {hidden === 1 ? "it" : "them"} from the account you connected with.{" "}
            {hidden === 1 ? "It has" : "They have"} no population figure, so{" "}
            {hidden === 1 ? "it" : "they"} cannot appear as{" "}
            {hidden === 1 ? "a deletion candidate" : "deletion candidates"} —{" "}
            <strong>the counts below are a floor, not a total.</strong> Re-run with a
            System Administrator to see the whole picture.
          </>
        ) : (
          <>
            <strong>Dependency counts below may be incomplete.</strong>
            Some references couldn&apos;t be read, so a field showing zero dependencies
            might still be in use. Treat those as unverified rather than safe.
          </>
        )}
        <ul>
          {hidden > 0 && gaps.length > 0 && (
            <li>
              <strong>Dependencies</strong> — some references couldn&apos;t be read either, so
              a field showing zero dependencies might still be in use:
            </li>
          )}
          {gaps.map((gap) => (
            <li key={gap.phase}>
              <strong>{SOURCE_LABELS[gap.phase]}</strong>
              {/* Only quote a ratio when it can actually be true. A phase whose
                  total is missing or smaller than its failure count would
                  otherwise print "1 of 0 could not be read". */}
              {gap.status === "failed" || gap.status === "skipped"
                ? " — not scanned."
                : gap.total >= gap.failed && gap.total > 0
                  ? ` — ${gap.failed.toLocaleString("en-US")} of ${gap.total.toLocaleString("en-US")} could not be read.`
                  : " — some could not be read."}{" "}
              {HINTS[gap.phase] ?? ""}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        aria-label="Dismiss coverage warning"
        title="Collapse — this caveat still applies to the numbers below"
        onClick={() => {
          setCollapsed(true);
          try {
            window.localStorage.setItem(storageKey, "1");
          } catch {
            // Non-fatal: it just won't persist across reloads.
          }
        }}
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.6rem",
          background: "none",
          border: "none",
          padding: "0.2rem 0.35rem",
          lineHeight: 1,
          fontSize: "1rem",
          cursor: "pointer",
          color: "hsl(var(--base-content) / 0.45)",
        }}
      >
        ×
      </button>
    </div>
  );
}
