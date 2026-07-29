import type { PhaseProgress } from "@/lib/scan/progress";
import { REFERENCE_PHASES } from "@/lib/constants";

/**
 * Whether a scan's gaps are big enough to qualify what the report claims.
 *
 * Shared by the coverage banner and the KPI tiles so they can't disagree. When
 * the threshold lived only in the banner, the tiles used "any failure at all",
 * which meant a single unreadable report out of two thousand put a warning on
 * every headline number. A caveat that fires on every scan is one nobody reads,
 * and it would have buried the cases that genuinely matter — an org where a
 * third of the fields are invisible.
 */

/**
 * Above this share of components read, a gap is a footnote rather than a
 * warning. Losing a whole source is never a footnote, however few components it
 * would have had.
 */
export const HIGH_COVERAGE = 0.95;

export interface ReferenceCoverage {
  /** Every reference sweep has stopped — complete, failed or skipped. */
  settled: boolean;
  /** Nothing failed anywhere. Rare on a real org. */
  perfect: boolean;
  /** A source failed outright or the gap is wide enough to change a decision. */
  material: boolean;
  componentsTotal: number;
  componentsFailed: number;
  /** 0–1. Zero when nothing was attempted. */
  ratio: number;
}

export function referenceCoverage(phases: PhaseProgress[]): ReferenceCoverage {
  const refs = phases.filter((p) => REFERENCE_PHASES.includes(p.phase));

  const settled = refs.every(
    (p) => p.status === "complete" || p.status === "failed" || p.status === "skipped",
  );
  const sourceLost = refs.some((p) => p.status === "failed" || p.status === "skipped");

  const componentsTotal = refs.reduce((sum, p) => sum + p.total, 0);
  const componentsFailed = refs.reduce((sum, p) => sum + p.failed, 0);
  const ratio = componentsTotal > 0 ? 1 - componentsFailed / componentsTotal : 0;

  return {
    settled,
    perfect: !sourceLost && componentsFailed === 0,
    // A lost source is always material: we have no idea what it would have
    // found, so a ratio computed from the sources that did run says nothing
    // about it.
    material: sourceLost || (componentsTotal > 0 && ratio < HIGH_COVERAGE),
    componentsTotal,
    componentsFailed,
    ratio,
  };
}
