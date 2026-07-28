"use client";

import { useRouter } from "next/navigation";
import { useScanTicker } from "@/lib/useScanTicker";
import type { ScanProgress } from "@/lib/scan/progress";

/**
 * Keeps an in-flight scan moving while the user reads the report, and re-renders
 * the server tree after each tick.
 *
 * This is the whole progressive-reveal mechanism. The census is a SQL view, so
 * re-reading it after new reference rows land yields updated dependency counts
 * with no client-side state to reconcile — the page simply gets more correct.
 */
export function ScanDriver({
  token,
  initialProgress,
}: {
  token: string;
  initialProgress: ScanProgress;
}) {
  const router = useRouter();
  useScanTicker(token, initialProgress, { onTick: () => router.refresh() });
  return null;
}
