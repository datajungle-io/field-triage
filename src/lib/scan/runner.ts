import type { SupabaseClient } from "@supabase/supabase-js";
import { PHASES, type Phase } from "@/lib/constants";
import { decryptToken } from "@/lib/crypto";
import { SalesforceClient, SalesforceError } from "@/lib/salesforce/client";
import { serviceClient } from "@/lib/supabase";
import { TICK_BUDGET_MS, type PhaseContext, type PhaseDefinition } from "@/lib/scan/types";

import { runIdentity } from "@/lib/scan/phases/identity";
import { runFieldDefinitions } from "@/lib/scan/phases/fieldDefinitions";
import { runPopulation } from "@/lib/scan/phases/population";
import { runDependencies } from "@/lib/scan/phases/dependencies";
import { runLayouts } from "@/lib/scan/phases/layouts";
import { runFlexipages } from "@/lib/scan/phases/flexipages";
import { runReports } from "@/lib/scan/phases/reports";
import { runReportTypes } from "@/lib/scan/phases/reportTypes";
import { runFinalize } from "@/lib/scan/phases/finalize";

/**
 * The scan is a resumable job, not a request.
 *
 * Each tick claims the next unfinished phase, works at it until its time budget
 * runs out, persists a cursor, and returns. The caller chains another tick. This
 * is what lets a five-minute scan of a large org run inside serverless
 * invocation limits without any phase knowing it is running serverless — and it
 * means a closed browser tab doesn't stop anything.
 */

/**
 * `optional: false` means the census itself depends on this phase, so failing it
 * fails the scan. Every reference source is optional: an org that locks down the
 * Metadata API still gets a real report, with the gap stated on its face rather
 * than folded silently into the numbers.
 */
const PHASE_DEFINITIONS: PhaseDefinition[] = [
  { phase: "identity", position: 0, handler: runIdentity, optional: false },
  { phase: "field_definitions", position: 1, handler: runFieldDefinitions, optional: false },
  { phase: "population", position: 2, handler: runPopulation, optional: false },
  { phase: "dependencies_mcd", position: 3, handler: runDependencies, optional: true },
  { phase: "layouts", position: 4, handler: runLayouts, optional: true },
  { phase: "flexipages", position: 5, handler: runFlexipages, optional: true },
  { phase: "reports", position: 6, handler: runReports, optional: true },
  { phase: "report_types", position: 7, handler: runReportTypes, optional: true },
  { phase: "finalize", position: 8, handler: runFinalize, optional: false },
];

const BY_PHASE = new Map(PHASE_DEFINITIONS.map((d) => [d.phase, d]));

export interface TickOutcome {
  /** True when the whole scan is finished (or has failed). */
  complete: boolean;
  phase?: Phase;
  message?: string;
}

export async function createPhaseRows(db: SupabaseClient, scanId: string): Promise<void> {
  const rows = PHASE_DEFINITIONS.map((d) => ({
    scan_id: scanId,
    phase: d.phase,
    position: d.position,
    status: "pending" as const,
  }));
  const { error } = await db
    .from("scan_phases")
    .upsert(rows, { onConflict: "scan_id,phase", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to create phase rows: ${error.message}`);
}

export async function runTick(scanId: string): Promise<TickOutcome> {
  const db = serviceClient();

  const { data: scan, error: scanError } = await db
    .from("scans")
    .select("id, status, instance_url, is_sandbox, sf_access_token_encrypted")
    .eq("id", scanId)
    .single();

  if (scanError || !scan) return { complete: true, message: "Scan not found" };
  if (scan.status === "complete" || scan.status === "failed" || scan.status === "expired") {
    return { complete: true, message: `Scan already ${scan.status}` };
  }

  const { data: phases, error: phaseError } = await db
    .from("scan_phases")
    .select("phase, status, cursor, scanned, failed")
    .eq("scan_id", scanId)
    .order("position");
  if (phaseError) throw new Error(`Failed to load phases: ${phaseError.message}`);

  const next = (phases ?? []).find(
    (p) => p.status === "pending" || p.status === "running",
  );

  if (!next) {
    // Every phase settled but finalize didn't flip the status — treat as done
    // rather than looping.
    if (scan.status !== "complete") {
      await db.from("scans").update({ status: "complete" }).eq("id", scanId);
    }
    return { complete: true };
  }

  if (!scan.sf_access_token_encrypted) {
    await failScan(db, scanId, "Salesforce token is no longer available");
    return { complete: true, message: "Token unavailable" };
  }

  const definition = BY_PHASE.get(next.phase as Phase);
  if (!definition) {
    await db
      .from("scan_phases")
      .update({ status: "skipped", error: "Unknown phase" })
      .eq("scan_id", scanId)
      .eq("phase", next.phase);
    return { complete: false, phase: next.phase as Phase };
  }

  const sf = new SalesforceClient({
    instanceUrl: scan.instance_url,
    accessToken: decryptToken(scan.sf_access_token_encrypted),
  });

  const ctx: PhaseContext = {
    scanId,
    sf,
    db,
    cursor: (next.cursor ?? {}) as Record<string, unknown>,
    deadline: Date.now() + TICK_BUDGET_MS,
    log: (message) => console.log(`[scan ${scanId}] ${next.phase}: ${message}`),
  };

  await db
    .from("scans")
    .update({ status: "running", heartbeat_at: new Date().toISOString() })
    .eq("id", scanId);

  await db
    .from("scan_phases")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("scan_id", scanId)
    .eq("phase", next.phase)
    .is("started_at", null);

  try {
    const result = await definition.handler(ctx);

    await db
      .from("scan_phases")
      .update({
        status: result.done ? "complete" : "running",
        cursor: result.cursor ?? {},
        total: result.total ?? 0,
        scanned: Math.max(0, result.scanned ?? 0),
        failed: Math.max(0, result.failed ?? 0),
        error: result.note ?? null,
        completed_at: result.done ? new Date().toISOString() : null,
      })
      .eq("scan_id", scanId)
      .eq("phase", next.phase);

    const finished = result.done && definition.phase === "finalize";
    return { complete: finished, phase: next.phase as Phase };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 500);

    // A dead token can't be recovered from by retrying — every subsequent phase
    // would fail identically, so stop rather than burn ticks.
    if (err instanceof SalesforceError && err.isAuthFailure) {
      await failScan(db, scanId, "Salesforce session expired or was revoked");
      return { complete: true, message: "Session expired" };
    }

    await db
      .from("scan_phases")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("scan_id", scanId)
      .eq("phase", next.phase);

    if (!definition.optional) {
      await failScan(db, scanId, message);
      return { complete: true, message };
    }

    // Optional phase: the report loses one reference source and says so.
    console.warn(`[scan ${scanId}] ${next.phase} failed (optional): ${message}`);
    return { complete: false, phase: next.phase as Phase, message };
  }
}

async function failScan(db: SupabaseClient, scanId: string, error: string): Promise<void> {
  await db
    .from("scans")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
      sf_access_token_encrypted: null,
    })
    .eq("id", scanId);
}

export { PHASE_DEFINITIONS, PHASES };
