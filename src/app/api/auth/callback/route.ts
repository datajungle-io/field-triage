import { NextResponse, type NextRequest } from "next/server";
import { encryptToken, newScanToken } from "@/lib/crypto";
import { appOrigin, exchangeCode, loginHostFor } from "@/lib/salesforce/oauth";
import { SalesforceClient } from "@/lib/salesforce/client";
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
    // Salesforce's error_description is the only thing that says WHY. Swallowing
    // it and substituting a guess ("your admin may restrict connected apps")
    // makes every failure look like the same failure, and sends people to check
    // a setting that may have nothing to do with it.
    const description = params.get("error_description") ?? "";
    console.error(`OAuth callback error: ${oauthError} — ${description}`);
    if (oauthError === "access_denied") return redirectWithError(request, "denied");
    return redirectWithError(request, "oauth", `${oauthError}: ${description}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  const cookie = request.cookies.get("ft_oauth")?.value;
  if (!code || !state || !cookie) return redirectWithError(request, "invalid");

  let stored: { state: string; verifier: string; isSandbox: boolean; fresh?: boolean };
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

  // The org id lives in the identity URL: .../id/<orgId>/<userId>
  const orgId = token.id.split("/").at(-2) ?? "unknown";

  // Returning visitor: if this org already has a live report, show that instead
  // of silently starting a second scan. Otherwise someone who loses their link
  // has no way back to it, and every return visit creates a duplicate lead.
  // `fresh` opts out, for a deliberate re-scan.
  if (!stored.fresh) {
    const { data: existing } = await db
      .from("scans")
      .select("token")
      .eq("org_id", orgId)
      .eq("status", "complete")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // We asked for access we're not going to use. Hand it straight back
      // rather than letting it sit live until the org's session timeout.
      await new SalesforceClient({
        instanceUrl: token.instance_url,
        accessToken: token.access_token,
      })
        .revoke(loginHostFor(stored.isSandbox))
        .catch(() => {});

      const url = new URL(`/r/${existing.token}`, appOrigin());
      url.searchParams.set("returning", "1");
      const response = NextResponse.redirect(url);
      response.cookies.delete("ft_oauth");
      return response;
    }
  }

  const scanToken = newScanToken();

  const { data: scan, error } = await db
    .from("scans")
    .insert({
      token: scanToken,
      // Real values land in the identity phase; org_id is NOT NULL so it needs a
      // placeholder until then. The identity URL always carries the org id, so
      // this is only ever a fallback for a malformed response.
      org_id: orgId,
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

  const response = NextResponse.redirect(new URL(`/scan/${scan.token}`, appOrigin()));
  response.cookies.delete("ft_oauth");
  return response;
}

/**
 * Always redirects to APP_URL, never request.nextUrl.origin.
 *
 * Behind Netlify + Cloudflare the request origin resolves to the internal
 * deploy-preview host, which would strand the user on a different domain from
 * the one their session cookie is scoped to — breaking the next OAuth attempt
 * with a confusing "sign-in expired" error.
 */
function redirectWithError(request: NextRequest, reason: string, detail?: string) {
  const url = new URL("/", appOrigin());
  url.searchParams.set("error", reason);
  // Salesforce's own words, shown verbatim. Truncated only to keep the URL sane.
  if (detail) url.searchParams.set("detail", detail.slice(0, 300));
  const response = NextResponse.redirect(url);
  response.cookies.delete("ft_oauth");
  return response;
}
