import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesforceClient } from "@/lib/salesforce/client";
import type { Phase } from "@/lib/constants";

/**
 * A phase does a bounded slice of work and reports where it got to.
 *
 * The tick runner gives each phase a wall-clock deadline. A phase that can't
 * finish inside it returns `done: false` with a cursor; the next tick resumes
 * from there. This is what keeps a multi-minute scan inside serverless
 * invocation limits without any phase needing to know it's running serverless.
 */
export interface PhaseContext {
  scanId: string;
  sf: SalesforceClient;
  db: SupabaseClient;
  /** Resume point written by this phase's previous slice. */
  cursor: PhaseCursor;
  /** Date.now() past which the phase should yield. */
  deadline: number;
  log: (message: string) => void;
}

export type PhaseCursor = Record<string, unknown>;

export interface PhaseResult {
  /** False means "call me again with this cursor". */
  done: boolean;
  cursor?: PhaseCursor;
  /** Denominator for the progress bar, once the phase knows it. */
  total?: number;
  /** Absolute counts of units processed and units that failed. */
  scanned?: number;
  failed?: number;
  /** Recorded on the phase row and surfaced in the coverage banner. */
  note?: string;
}

export type PhaseHandler = (ctx: PhaseContext) => Promise<PhaseResult>;

export interface PhaseDefinition {
  phase: Phase;
  position: number;
  handler: PhaseHandler;
  /**
   * When true, a thrown error marks the phase failed and the scan continues.
   * Reference sources are all optional in this sense — an org where the Metadata
   * API is locked down still gets a useful report, with the gap disclosed.
   * Phases that produce the census itself are not optional.
   */
  optional: boolean;
}

/** Salesforce time budget per tick, leaving headroom for writes and chaining. */
export const TICK_BUDGET_MS = 35_000;

export function timeLeft(ctx: PhaseContext): number {
  return ctx.deadline - Date.now();
}

export function outOfTime(ctx: PhaseContext, reserveMs = 3_000): boolean {
  return timeLeft(ctx) < reserveMs;
}
