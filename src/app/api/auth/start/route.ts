import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, createPkce } from "@/lib/salesforce/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Begins the OAuth handshake.
 *
 * The CSRF state and the PKCE verifier ride in a short-lived httpOnly cookie
 * rather than in any server-side store: they are single-use, they must survive a
 * redirect to Salesforce and back, and nothing else in the flow needs them.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const isSandbox = params.get("sandbox") === "1";

  // ?prompt=login forces Salesforce to ask for credentials instead of reusing
  // the browser's current session. Without it a second visit silently
  // re-authorizes whichever org is already signed in — which looks like the app
  // ignoring your choice of org. Only the values Salesforce defines are passed
  // through; anything else is dropped rather than forwarded blindly.
  const requested = params.get("prompt");
  const prompt =
    requested === "login" || requested === "consent" || requested === "login consent"
      ? requested
      : undefined;

  const state = randomBytes(24).toString("base64url");
  const pkce = createPkce();

  const response = NextResponse.redirect(
    authorizeUrl({ state, challenge: pkce.challenge, isSandbox, prompt }),
  );

  response.cookies.set("ft_oauth", JSON.stringify({ state, verifier: pkce.verifier, isSandbox }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
