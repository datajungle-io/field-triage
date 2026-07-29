"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScanTicker } from "@/lib/useScanTicker";
import type { ScanProgress } from "@/lib/scan/progress";

/**
 * The live scan screen.
 *
 * Jumps to the report the moment the census is renderable — after population,
 * with dependency phases still running. Waiting for the full scan would hold a
 * useful report back for minutes to avoid showing a number that is about to get
 * better, which is the wrong trade.
 */
export function ScanProgressView({
  token,
  initialProgress,
}: {
  token: string;
  initialProgress: ScanProgress;
}) {
  const router = useRouter();
  const { progress, error } = useScanTicker(token, initialProgress);

  const settled = (s: string) => s === "complete" || s === "failed" || s === "skipped";
  const firstUnsettled = progress.phases.findIndex((p) => !settled(p.status));
  const currentIndex = firstUnsettled === -1 ? progress.phases.length : firstUnsettled;

  useEffect(() => {
    if (progress.reportReady) router.replace(`/r/${token}`);
  }, [progress.reportReady, router, token]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <div className="hero-eyebrow">Scanning your org</div>
      <h1 className="hero-title">Reading your field metadata…</h1>
      <p className="hero-sub">
        This takes two to six minutes depending on how many reports you have. You can leave
        this page open — or close it, and we&apos;ll email you the link when it&apos;s done.
      </p>

      {error && (
        <div className="coverage-banner" style={{ borderLeftColor: "#F5B731" }}>
          <span aria-hidden="true">⚠</span>
          <div>{error}</div>
        </div>
      )}

      {/*
        The first unsettled phase is "the current step" whether or not its row
        says running. Between ticks nothing is marked running — the previous one
        finished and the next hasn't claimed itself yet — so keying the spinner
        off the database status alone leaves the page looking stalled at exactly
        the moment it's handing off.
      */}
      <ul style={{ listStyle: "none", padding: 0, margin: "2rem 0 0" }}>
        {progress.phases.map((phase, i) => (
          <li
            key={phase.phase}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.6rem 0",
              borderBottom: "1px solid hsl(var(--base-300) / 0.5)",
              fontSize: "0.9rem",
              opacity: i === currentIndex || phase.status !== "pending" ? 1 : 0.4,
            }}
          >
            <StatusGlyph status={i === currentIndex ? "running" : phase.status} />
            <span style={{ flex: 1, fontWeight: i === currentIndex ? 600 : 400 }}>
              {phase.label}
            </span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: "0.8rem",
                color: "hsl(var(--base-content) / 0.6)",
              }}
            >
              {detail(phase)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function detail(phase: ScanProgress["phases"][number]): string {
  if (phase.status === "failed") return "unavailable";
  if (phase.status === "skipped") return "skipped";
  if (phase.total === 0) return phase.status === "complete" ? "done" : "";
  if (phase.status === "complete") {
    return phase.failed > 0
      ? `${phase.scanned.toLocaleString("en-US")} of ${phase.total.toLocaleString("en-US")}`
      : phase.total.toLocaleString("en-US");
  }
  return `${phase.scanned.toLocaleString("en-US")} / ${phase.total.toLocaleString("en-US")}`;
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "complete") return <span style={{ color: "#B5D333" }}>✓</span>;
  // A failed reference source is amber, not red: the report still lands, one
  // source short, and says so.
  if (status === "failed" || status === "skipped")
    return <span style={{ color: "#F5B731" }}>!</span>;
  if (status === "running")
    return (
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid rgba(137,207,240,0.3)",
          borderTopColor: "#89CFF0",
          display: "inline-block",
          animation: "spin 0.8s linear infinite",
        }}
      />
    );
  return <span style={{ color: "hsl(var(--base-content) / 0.3)" }}>○</span>;
}
