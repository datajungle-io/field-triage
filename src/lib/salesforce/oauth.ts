import { createHash, randomBytes } from "node:crypto";

/**
 * Salesforce OAuth 2.0 web server flow with PKCE.
 *
 * Scope policy, which is the whole trust story of this product:
 *
 *   api   — required. Salesforce has no metadata-read-only scope, so this is the
 *           narrowest grant that can read FieldDefinition and run COUNT queries.
 *           It does carry full data access under the connecting user's own
 *           permissions, which is why the connect screen says so plainly instead
 *           of burying it, and why the token is revoked the moment the scan ends.
 *   id    — the identity endpoint. This is the lead capture; no form needed.
 *
 * refresh_token is deliberately NOT requested. A refresh token would let this
 * app return to the org indefinitely, and a one-off report has no business
 * holding that. The access token dies with the org's session timeout even if
 * revocation fails.
 */

const SCOPES = ["api", "id"] as const;

export const PRODUCTION_LOGIN = "https://login.salesforce.com";
export const SANDBOX_LOGIN = "https://test.salesforce.com";

export function loginHostFor(isSandbox: boolean): string {
  return isSandbox ? SANDBOX_LOGIN : PRODUCTION_LOGIN;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkce(): PkcePair {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(opts: {
  state: string;
  challenge: string;
  isSandbox: boolean;
  /**
   * Salesforce reuses an existing browser session silently, so a second visit
   * re-authorizes the same org without ever showing a login screen. `login`
   * forces the credentials prompt (needed to scan a different org, and for
   * anyone signed in as the wrong user); `consent` re-shows the permission
   * screen for an org that has already granted access.
   */
  prompt?: "login" | "consent" | "login consent";
}): string {
  const url = new URL(`${loginHostFor(opts.isSandbox)}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.prompt) url.searchParams.set("prompt", opts.prompt);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at?: string;
  scope?: string;
}

export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  isSandbox: boolean;
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: clientId(),
    redirect_uri: redirectUri(),
    code_verifier: opts.verifier,
  });

  // The secret is optional. Salesforce won't release a Connected App's consumer
  // secret over any API — it takes a UI click plus an emailed verification code —
  // so a fully scripted setup can only produce the key. With "Require Secret for
  // Web Server Flow" turned off, PKCE alone secures the exchange, which is the
  // standard public-client pattern. Set SF_CLIENT_SECRET to run as a confidential
  // client instead; that's stronger and worth doing before launch.
  const secret = process.env.SF_CLIENT_SECRET;
  if (secret) params.set("client_secret", secret);

  const res = await fetch(`${loginHostFor(opts.isSandbox)}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const token = JSON.parse(body) as TokenResponse;
  if (!token.access_token || !token.instance_url) {
    throw new Error("Token response missing access_token or instance_url");
  }
  return token;
}

function clientId(): string {
  const value = process.env.SF_CLIENT_ID;
  if (!value) throw new Error("SF_CLIENT_ID is not set");
  return value;
}

export function redirectUri(): string {
  const base = process.env.APP_URL;
  if (!base) throw new Error("APP_URL is not set");
  return `${base.replace(/\/+$/, "")}/api/auth/callback`;
}
