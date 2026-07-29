"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanProgress } from "@/lib/scan/progress";

/**
 * Drives a scan from the browser, one tick at a time.
 *
 * The browser is the fast path, not the only path: each POST advances the scan
 * by roughly 35 seconds of Salesforce work and returns fresh progress, which is
 * what makes the readout live. Close the tab and the cron resumes the same job
 * from the same cursor — slower, but nothing is lost and the report still lands
 * in the inbox.
 *
 * Mounted on the report page too, so a scan that reached first paint keeps
 * refining its dependency counts while the user reads it.
 */
export function useScanTicker(
  token: string,
  initial: ScanProgress,
  options: { enabled?: boolean; onTick?: () => void } = {},
) {
  const enabled = options.enabled ?? true;
  const [progress, setProgress] = useState<ScanProgress>(initial);
  const [error, setError] = useState<string | null>(null);
  const onTickRef = useRef(options.onTick);
  onTickRef.current = options.onTick;

  // Poll progress independently of ticking. A tick holds its connection for up
  // to ~20s, so a UI that only learns about progress from tick responses sits
  // frozen for that entire window — counters don't move and the whole page
  // looks stalled even though the scan is working.
  useEffect(() => {
    if (!enabled || initial.complete) return;
    let cancelled = false;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/${token}/progress`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { progress: ScanProgress };
        setProgress(data.progress);
      } catch {
        // Transient; the next poll picks it up. The scan is server-side.
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, enabled, initial.complete]);

  useEffect(() => {
    if (!enabled || initial.complete) return;

    let cancelled = false;
    let failures = 0;

    async function loop() {
      while (!cancelled) {
        try {
          const res = await fetch("/api/scan/tick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });

          if (!res.ok) throw new Error(`Tick failed: ${res.status}`);

          const data = (await res.json()) as { complete: boolean; progress: ScanProgress };
          if (cancelled) return;

          failures = 0;
          setProgress(data.progress);
          setError(null);
          onTickRef.current?.();

          if (data.complete) return;
        } catch (err) {
          if (cancelled) return;
          failures++;
          // Stop hammering after repeated failures. The cron picks the scan up
          // from its cursor, so the work continues regardless of this tab.
          if (failures >= 3) {
            setError(
              "Lost contact with the scan. It's still running in the background — this page will keep checking.",
            );
            await sleep(15_000);
            failures = 0;
          } else {
            await sleep(2_000 * failures);
          }
        }
      }
    }

    void loop();
    return () => {
      cancelled = true;
    };
  }, [token, enabled, initial.complete]);

  return { progress, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
