import { NextResponse, type NextRequest } from "next/server";
import { runTick } from "@/lib/scan/runner";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel-only hint; Netlify ignores it and applies its own plan ceiling, which
// is why CRON_BUDGET_MS below is what actually bounds the work.
export const maxDuration = 300;

/**
 * Safety net for abandoned scans.
 *
 * The browser normally drives ticks, so this only matters when someone closes
 * the tab mid-scan — the work then continues here and their report is waiting
 * (and emailed) when they come back. Also expires scan payloads past retention.
 *
 * A scan is "stalled" if its heartbeat has gone quiet for longer than a tick
 * could plausibly take.
 */
const STALL_THRESHOLD_MS = 90_000;

/**
 * How long this endpoint keeps ticking before returning.
 *
 * Must sit inside the host's function ceiling like everything else — Netlify
 * allows 10s free / 26s Pro, Vercel Pro 300s. Running short just means an
 * abandoned scan advances a little each minute instead of finishing in one
 * sweep; it still finishes.
 */
const CRON_BUDGET_MS = Number(process.env.CRON_BUDGET_MS ?? 20_000);

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = serviceClient();
  const deadline = Date.now() + CRON_BUDGET_MS;

  const { data: purged } = await db.rpc("purge_expired_scans");

  const { data: stalled, error } = await db
    .from("scans")
    .select("id")
    .in("status", ["pending", "running"])
    .lt("heartbeat_at", new Date(Date.now() - STALL_THRESHOLD_MS).toISOString())
    .order("heartbeat_at")
    .limit(5);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resumed: string[] = [];
  for (const scan of stalled ?? []) {
    // Keep ticking one scan while there's budget: a single tick per minute would
    // stretch an abandoned scan over half an hour.
    while (Date.now() < deadline) {
      const outcome = await runTick(scan.id);
      if (outcome.complete) break;
    }
    resumed.push(scan.id);
    if (Date.now() >= deadline) break;
  }

  return NextResponse.json({ resumed: resumed.length, purged: purged ?? 0 });
}
