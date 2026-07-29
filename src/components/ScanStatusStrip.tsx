"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REFERENCE_PHASES, type Phase } from "@/lib/constants";
import type { ScanProgress } from "@/lib/scan/progress";

/**
 * Live readout of the remaining scan work, shown on the report itself.
 *
 * Replaces a static "still scanning" banner that gave no indication of which
 * step was running, how far along it was, or what was left. Once the progress
 * screen hands off at first paint, this is the only thing telling the user the
 * scan is still alive — so it has to keep moving, and it has to say what it is
 * waiting on.
 *
 * It polls rather than reading tick responses: a tick holds its connection for
 * up to ~35s, so a UI driven by tick completions sits frozen for that whole
 * window on a page that is otherwise finished rendering.
 */

const POLL_MS = 2000;

const SHORT_LABELS: Partial<Record<Phase, string>> = {
  dependencies_mcd: "Layouts, Apex, Flows",
  layouts: "Page layouts",
  flexipages: "Lightning pages",
  reports: "Reports",
  report_types: "Report types",
};

export function ScanStatusStrip({
  token,
  initialProgress,
}: {
  token: string;
  initialProgress: ScanProgress;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);

  const settled = (status: string) =>
    status === "complete" || status === "failed" || status === "skipped";

  const refPhases = progress.phases.filter((p) => REFERENCE_PHASES.includes(p.phase));
  const done = refPhases.length > 0 && refPhases.every((p) => settled(p.status));

  useEffect(() => {
    if (done) return;
    let cancelled = false;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/${token}/progress`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { progress: ScanProgress };
        setProgress(data.progress);

        // Once every reference source has settled the dependency columns are
        // final — re-render the server tree so the real numbers replace the
        // pending dashes.
        const refs = data.progress.phases.filter((p) => REFERENCE_PHASES.includes(p.phase));
        if (refs.length > 0 && refs.every((p) => settled(p.status))) router.refresh();
      } catch {
        // Transient failure; the next poll picks it up. The scan is server-side
        // and unaffected either way.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, done, router]);

  if (done) return null;

  const remaining = refPhases.filter((p) => !settled(p.status)).length;
  const firstUnsettled = refPhases.findIndex((p) => !settled(p.status));
  const currentIndex = firstUnsettled === -1 ? refPhases.length : firstUnsettled;
  const running = refPhases[currentIndex];

  return (
    <div className="coverage-banner" style={{ borderLeftColor: "#89CFF0" }}>
      <span className="pending-dot" style={{ marginTop: "0.35rem" }} aria-hidden="true" />
      <div style={{ flex: 1 }}>
        <strong>
          Still tracing dependencies — {remaining} step{remaining === 1 ? "" : "s"} to go
        </strong>
        Field counts and health are final. <em>Ready · 0 Deps</em> and{" "}
        <em>Dependencies</em> will fill in as references are found
        {running?.total ? (
          <>
            {" "}
            — currently {SHORT_LABELS[running.phase]?.toLowerCase() ?? running.label},{" "}
            {running.scanned.toLocaleString("en-US")} of{" "}
            {running.total.toLocaleString("en-US")}
          </>
        ) : null}
        .
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem 1rem",
            marginTop: "0.6rem",
            fontSize: "0.75rem",
          }}
        >
          {refPhases.map((phase, i) => (
            <span
              key={phase.phase}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                opacity: i === currentIndex || phase.status !== "pending" ? 1 : 0.45,
              }}
            >
              {/* First unsettled phase is the current step, even between ticks
                  when nothing is marked running. */}
              <Glyph status={i === currentIndex ? "running" : phase.status} />
              {SHORT_LABELS[phase.phase] ?? phase.label}
              {phase.total > 0 && (
                <span
                  style={{
                    color: "hsl(var(--base-content) / 0.5)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {settled(phase.status)
                    ? phase.total.toLocaleString("en-US")
                    : `${phase.scanned.toLocaleString("en-US")}/${phase.total.toLocaleString("en-US")}`}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Glyph({ status }: { status: string }) {
  if (status === "complete") return <span style={{ color: "#B5D333" }}>✓</span>;
  // Amber, not red: a source that couldn't be read costs coverage, not the report.
  if (status === "failed" || status === "skipped")
    return <span style={{ color: "#F5B731" }}>!</span>;
  if (status === "running")
    return (
      <span
        style={{
          width: 11,
          height: 11,
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
