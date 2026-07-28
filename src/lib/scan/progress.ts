import { FIRST_PAINT_PHASE, PHASES, PHASE_LABELS, type Phase } from "@/lib/constants";
import { serviceClient } from "@/lib/supabase";

export interface PhaseProgress {
  phase: Phase;
  label: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  total: number;
  scanned: number;
  failed: number;
  note: string | null;
}

export interface ScanProgress {
  phases: PhaseProgress[];
  /** True once the census is worth rendering — everything after only refines it. */
  reportReady: boolean;
  complete: boolean;
}

export async function loadProgress(scanId: string): Promise<ScanProgress> {
  const { data, error } = await serviceClient()
    .from("scan_phases")
    .select("phase, status, total, scanned, failed, error")
    .eq("scan_id", scanId)
    .order("position");

  if (error) throw new Error(`Failed to load progress: ${error.message}`);

  const rows = data ?? [];
  const phases: PhaseProgress[] = rows.map((r) => ({
    phase: r.phase as Phase,
    label: PHASE_LABELS[r.phase as Phase] ?? r.phase,
    status: r.status as PhaseProgress["status"],
    total: r.total ?? 0,
    scanned: r.scanned ?? 0,
    failed: r.failed ?? 0,
    // scan_phases.error doubles as a note channel: a completed phase uses it to
    // report partial coverage ("31 reports could not be read"), which is not a
    // failure but must still be visible.
    note: r.error ?? null,
  }));

  const settled = (p: PhaseProgress) =>
    p.status === "complete" || p.status === "failed" || p.status === "skipped";

  const firstPaintIndex = PHASES.indexOf(FIRST_PAINT_PHASE);
  const reportReady = phases
    .filter((p) => PHASES.indexOf(p.phase) <= firstPaintIndex)
    .every(settled);

  return {
    phases,
    reportReady,
    complete: phases.length > 0 && phases.every(settled),
  };
}
