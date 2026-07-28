import { NextResponse, type NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encryptToken, newScanToken } from "@/lib/crypto";
import { createPhaseRows } from "@/lib/scan/runner";
import { serviceClient } from "@/lib/supabase";

const exec = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Development-only: start a scan using the `sf` CLI's existing session instead
 * of the OAuth flow.
 *
 * Mirrors SF_USE_CLI in the production Python jobs (salesforce/jobs/sfcli.py).
 * The point is to be able to exercise every phase against a real org without
 * first registering a Connected App — the CLI's access token is an ordinary
 * session id, so it drives the identical REST / Tooling / Analytics / SOAP code
 * paths that a real user's token does.
 *
 * The resulting scan is flagged is_cli_session so finalize won't revoke the
 * token and log you out of `sf`.
 *
 *   ALLOW_CLI_SCAN=1 npm run dev
 *   open http://localhost:3000/api/dev/scan?org=<alias>
 */
export async function GET(request: NextRequest) {
  // Two independent guards. This endpoint mints a scan from an ambient
  // credential with no user interaction, so it must be impossible to reach in
  // a deployed environment even if the env var is set by accident.
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_CLI_SCAN !== "1") {
    return NextResponse.json(
      { error: "Not available. Set ALLOW_CLI_SCAN=1 in development to enable." },
      { status: 404 },
    );
  }

  const org = request.nextUrl.searchParams.get("org");
  if (!org || !/^[\w.@-]+$/.test(org)) {
    return NextResponse.json(
      { error: "Pass ?org=<alias or username>, e.g. ?org=<alias>" },
      { status: 400 },
    );
  }

  let info: { accessToken?: string; instanceUrl?: string; id?: string; username?: string };
  try {
    // execFile, not a shell — the org alias is still validated above, but this
    // removes shell interpolation from the picture entirely.
    const { stdout } = await exec("sf", [
      "org",
      "display",
      "--target-org",
      org,
      "--json",
    ]);
    // The CLI prints update warnings before the JSON body.
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON in `sf org display` output");
    info = JSON.parse(stdout.slice(start)).result;
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not read the CLI session for "${org}".`,
        detail: String(err).slice(0, 400),
        hint: "Check `sf org list`, and re-authenticate with `sf org login web` if the org shows as expired.",
      },
      { status: 400 },
    );
  }

  if (!info.accessToken || !info.instanceUrl) {
    return NextResponse.json(
      { error: `The CLI has no active session for "${org}". Run \`sf org login web\`.` },
      { status: 400 },
    );
  }

  const db = serviceClient();
  const scanToken = newScanToken();

  const { data: scan, error } = await db
    .from("scans")
    .insert({
      token: scanToken,
      org_id: info.id ?? "unknown",
      instance_url: info.instanceUrl,
      is_sandbox: false,
      is_cli_session: true,
      status: "pending",
      sf_access_token_encrypted: encryptToken(info.accessToken),
    })
    .select("id, token")
    .single();

  if (error || !scan) {
    return NextResponse.json(
      { error: `Failed to create scan: ${error?.message}` },
      { status: 500 },
    );
  }

  await createPhaseRows(db, scan.id);
  return NextResponse.redirect(new URL(`/scan/${scan.token}`, request.nextUrl.origin));
}
