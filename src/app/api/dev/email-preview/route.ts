import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { scanByToken } from "@/lib/scan/access";
import { reportEmailHtml, reportEmailText } from "@/lib/email/reportTemplate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only: render the report email in the browser without sending it.
 *
 * Iterating on an email by sending it is slow, burns quota, and trains your own
 * inbox to treat the sender as noise. This renders the exact template the mailer
 * would post to Resend, from real scan data.
 *
 *   ALLOW_CLI_SCAN=1 npm run dev
 *   open 'http://localhost:3100/api/dev/email-preview?token=<report token>'
 *   open 'http://localhost:3100/api/dev/email-preview?token=<token>&text=1'
 *
 * ?empty=1 forces the zero-candidates variant, which is otherwise hard to
 * reach — you need an org that genuinely has nothing to delete.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_CLI_SCAN !== "1") {
    return NextResponse.json(
      { error: "Not available. Set ALLOW_CLI_SCAN=1 in development to enable." },
      { status: 404 },
    );
  }

  const params = request.nextUrl.searchParams;
  const token = params.get("token");
  if (!token) {
    return NextResponse.json({ error: "Pass ?token=<report token>" }, { status: 400 });
  }

  const scan = await scanByToken(token);
  if (!scan) return NextResponse.json({ error: "No scan for that token" }, { status: 404 });

  const { data: lead } = await serviceClient()
    .from("leads")
    .select("name, fields_scanned, delete_ready, ready_no_deps")
    .eq("scan_id", scan.id)
    .single();

  const empty = params.get("empty") === "1";
  const data = {
    firstName: (lead?.name ?? "").split(" ")[0] || null,
    orgName: scan.org_name ?? "your org",
    reportUrl: `https://triage.datajungle.io/r/${scan.token}`,
    fieldsScanned: lead?.fields_scanned ?? 0,
    deleteReady: empty ? 0 : (lead?.delete_ready ?? 0),
    readyNoDeps: empty ? 0 : (lead?.ready_no_deps ?? 0),
    expires: new Date(scan.expires_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    bookACallUrl: "https://calendly.com/brendan-mcdonald/30min",
  };

  if (params.get("text") === "1") {
    return new NextResponse(reportEmailText(data), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(reportEmailHtml(data), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
