import { NextResponse, type NextRequest } from "next/server";
import { encryptToken, newScanToken } from "@/lib/crypto";
import { exchangeCode } from "@/lib/salesforce/oauth";
import { createPhaseRows } from "@/lib/scan/runner";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth callback: verify state, exchange the code, open a scan, hand the browser
 * its report token.
 *
 * No scanning happens here — this handler stays fast and the work is driven by
 * ticks, so a slow org can't turn the redirect into a timeout.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    // User clicked Deny, or the org blocks the connected app.
    return redirectWithError(request, oauthError === "access_denied" ? "denied" : "oauth");
  }

  const code = params.get("code");
  const state = params.get("state");
  const cookie = request.cookies.get("ft_oauth")?.value;
  if (!code || !state || !cookie) return redirectWithError(request, "invalid");

  let stored: { state: string; verifier: string; isSandbox: boolean };
  try {
    stored = JSON.parse(cookie);
  } catch {
    return redirectWithError(request, "invalid");
  }

  // Constant-time comparison isn't warranted here — an attacker who can read the
  // httpOnly cookie has already won — but the check itself is what stops a
  // cross-site request from planting someone else's org in this browser.
  if (stored.state !== state) return redirectWithError(request, "invalid");

  let token;
  try {
    token = await exchangeCode({
      code,
      verifier: stored.verifier,
      isSandbox: stored.isSandbox,
    });
  } catch (err) {
    console.error("Token exchange failed:", err);
    return redirectWithError(request, "exchange");
  }

  const db = serviceClient();
  const scanToken = newScanToken();

  const { data: scan, error } = await db
    .from("scans")
    .insert({
      token: scanToken,
      // Real values land in the identity phase; org_id is NOT NULL so it needs a
      // placeholder until then. The identity URL always carries the org id, so
      // this is only ever a fallback for a malformed response.
      org_id: token.id.split("/").at(-2) ?? "unknown",
      instance_url: token.instance_url,
      is_sandbox: stored.isSandbox,
      status: "pending",
      sf_access_token_encrypted: encryptToken(token.access_token),
    })
    .select("id, token")
    .single();

  if (error || !scan) {
    console.error("Failed to create scan:", error);
    return redirectWithError(request, "server");
  }

  await createPhaseRows(db, scan.id);

  const response = NextResponse.redirect(new URL(`/scan/${scan.token}`, request.nextUrl.origin));
  response.cookies.delete("ft_oauth");
  return response;
}

function redirectWithError(request: NextRequest, reason: string) {
  const url = new URL("/", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  const response = NextResponse.redirect(url);
  response.cookies.delete("ft_oauth");
  return response;
}
