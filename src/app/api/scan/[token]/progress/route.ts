import { NextResponse } from "next/server";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only progress, polled by the status strip.
 *
 * Deliberately separate from /api/scan/tick: a tick holds its connection for up
 * to ~35s while it works, so a UI that learns about progress only from tick
 * responses freezes for that whole window. This is cheap enough to poll every
 * couple of seconds, which is what makes the scan look alive.
 */
export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
) {
  const scan = await scanByToken(params.token);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    status: scan.status,
    progress: await loadProgress(scan.id),
  });
}
