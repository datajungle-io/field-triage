import { NextResponse, type NextRequest } from "next/server";
import { runTick } from "@/lib/scan/runner";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Pro / Fluid compute. A tick budgets 35s of Salesforce work and needs
 * headroom on top for the final writes; on Hobby (60s ceiling) lower
 * TICK_BUDGET_MS to about 20s.
 */
export const maxDuration = 300;

/**
 * Advance a scan by one tick.
 *
 * Driven by the browser while the scan page is open, which is what makes the
 * progress readout live. If the tab closes, the cron picks the scan up from its
 * cursor — the work is identical either way, only the pace changes.
 */
export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const scan = await scanByToken(body.token ?? "");
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (scan.status === "complete" || scan.status === "failed") {
    return NextResponse.json({ complete: true, progress: await loadProgress(scan.id) });
  }

  const outcome = await runTick(scan.id);
  return NextResponse.json({
    complete: outcome.complete,
    phase: outcome.phase,
    message: outcome.message,
    progress: await loadProgress(scan.id),
  });
}
