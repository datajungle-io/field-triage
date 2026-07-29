import { NextResponse, type NextRequest } from "next/server";
import { pushLeadToCrm } from "@/lib/crm";
import { scanByToken } from "@/lib/scan/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only: push an existing scan to the CRM on demand.
 *
 * The CRM write happens inside finalize, at the end of a multi-minute scan, and
 * it is deliberately best-effort — so a misconfigured JWT shows up as one line
 * in a log nobody is reading. This runs the same push in strict mode and returns
 * Salesforce's own error, which is the only thing that actually diagnoses a
 * failed assertion.
 *
 *   ALLOW_CLI_SCAN=1 npm run dev
 *   open 'http://localhost:3100/api/dev/crm-push?token=<report token>'
 *
 * Note this writes a real Lead to the real CRM. It upserts on org ID, so
 * running it twice updates rather than duplicates.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_CLI_SCAN !== "1") {
    return NextResponse.json(
      { error: "Not available. Set ALLOW_CLI_SCAN=1 in development to enable." },
      { status: 404 },
    );
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Pass ?token=<report token>" }, { status: 400 });

  const scan = await scanByToken(token);
  if (!scan) return NextResponse.json({ error: "No scan for that token" }, { status: 404 });

  try {
    // strict: surface the reason rather than skipping quietly — including for
    // CLI-session scans, which the normal path declines to push.
    const result = await pushLeadToCrm(scan.id, { strict: true });
    return NextResponse.json({ org: scan.org_name, ...result });
  } catch (err) {
    return NextResponse.json(
      { pushed: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
