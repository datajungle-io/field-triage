import { NextResponse, type NextRequest } from "next/server";
import { sendReportToUser } from "@/lib/notify";
import { scanByToken } from "@/lib/scan/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only: send the report email for an existing scan, on demand.
 *
 * Without this, the only way to see the email is to run a whole scan — minutes
 * per attempt, and no way to iterate on the copy. Errors are returned verbatim
 * rather than swallowed, because every likely failure here (bad key, unverified
 * domain, recipient the shared sender can't reach) is diagnosable only from
 * Resend's own message.
 *
 *   ALLOW_CLI_SCAN=1 npm run dev
 *   open 'http://localhost:3000/api/dev/test-email?token=<report token>&to=you@example.com'
 */
export async function GET(request: NextRequest) {
  // Same two guards as /api/dev/scan: this sends real email using real
  // credentials and must be unreachable in production.
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_CLI_SCAN !== "1") {
    return NextResponse.json(
      { error: "Not available. Set ALLOW_CLI_SCAN=1 in development to enable." },
      { status: 404 },
    );
  }

  const params = request.nextUrl.searchParams;
  const token = params.get("token");
  const to = params.get("to") ?? undefined;

  if (!token) {
    return NextResponse.json(
      { error: "Pass ?token=<report token>, and optionally &to=<email> to redirect it." },
      { status: 400 },
    );
  }

  const scan = await scanByToken(token);
  if (!scan) return NextResponse.json({ error: "No scan for that token" }, { status: 404 });

  if (scan.is_cli_session && !to) {
    return NextResponse.json(
      {
        error:
          "This scan came from the CLI path, which is skipped for email. Pass &to= to send anyway.",
      },
      { status: 400 },
    );
  }

  try {
    await sendReportToUser(scan.id, { to, strict: true });
    return NextResponse.json({
      sent: true,
      org: scan.org_name,
      to: to ?? "(the lead's own address)",
    });
  } catch (err) {
    return NextResponse.json(
      { sent: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
