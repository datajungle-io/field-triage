import { createSign } from "node:crypto";
import { serviceClient } from "@/lib/supabase";
import { API_VERSION } from "@/lib/constants";

/**
 * Push a completed scan to the Data Jungle CRM as a Salesforce Lead.
 *
 * This is a *different* org from the one being scanned. The scan holds a
 * short-lived user token for the prospect's org, which is revoked the moment
 * the scan finishes; writing a Lead needs a standing credential in our own org.
 * Those two must never be confused, hence a separate module and a separate set
 * of environment variables.
 *
 * Server-to-server, so the JWT bearer flow rather than a refresh token: nothing
 * to expire, nothing to re-authorise, and no silent failure six months from now
 * when a token that nobody is watching gets revoked.
 *
 * Entirely optional. With the variables unset this is a no-op, exactly like the
 * mailer — a CRM that isn't wired up must never be the thing that fails a
 * finished scan.
 */

const LOGIN_URL = (process.env.SF_CRM_LOGIN_URL ?? "https://login.salesforce.com").replace(
  /\/+$/,
  "",
);
const PUBLIC_ORIGIN = (process.env.PUBLIC_APP_URL ?? "https://triage.datajungle.io").replace(
  /\/+$/,
  "",
);

/** The External Id field the upsert keys on. See salesforce/crm-pbo/. */
const ORG_ID_FIELD = "Field_Triage_Org_Id__c";

interface CrmConfig {
  clientId: string;
  username: string;
  privateKey: string;
}

function config(): CrmConfig | null {
  const clientId = process.env.SF_CRM_CLIENT_ID;
  const username = process.env.SF_CRM_USERNAME;
  // Netlify's UI collapses newlines in pasted values, so the key is accepted
  // with literal \n sequences and normalised here. A PEM with the wrong line
  // breaks fails signing with an unhelpful error.
  const privateKey = process.env.SF_CRM_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientId || !username || !privateKey) return null;
  return { clientId, username, privateKey };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint and exchange a JWT bearer assertion for an access token.
 *
 * Hand-rolled rather than pulling in a JWT library: the assertion is three
 * base64url segments and an RS256 signature, all of which node:crypto already
 * does. One less dependency in the path that holds a private key.
 */
async function accessToken(cfg: CrmConfig): Promise<{ token: string; instanceUrl: string }> {
  const claims = {
    iss: cfg.clientId,
    sub: cfg.username,
    // Always the login URL the Connected App was created against — not the
    // instance URL. Salesforce rejects the assertion outright otherwise.
    aud: LOGIN_URL,
    exp: Math.floor(Date.now() / 1000) + 180,
  };

  const signingInput =
    `${base64url(JSON.stringify({ alg: "RS256" }))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(cfg.privateKey);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.text();
  if (!res.ok) {
    // Salesforce's own message is the whole diagnosis here: an unapproved user,
    // a certificate mismatch, a clock skew. Never replace it with a guess.
    throw new Error(`JWT auth failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(body) as { access_token: string; instance_url: string };
  return { token: parsed.access_token, instanceUrl: parsed.instance_url.replace(/\/+$/, "") };
}

/**
 * Salesforce requires LastName on Lead, and the OAuth identity endpoint gives
 * us one display name. Split on the last space so "Mary Jane Watson" keeps
 * "Watson" as the surname; a single-token name becomes the surname outright,
 * because a Lead called "(unknown) Brendan" reads worse than one called
 * "Brendan".
 */
function splitName(full: string | null): { first: string | null; last: string } {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { first: null, last: "Unknown" };
  const at = trimmed.lastIndexOf(" ");
  if (at < 0) return { first: null, last: trimmed };
  return { first: trimmed.slice(0, at), last: trimmed.slice(at + 1) };
}

export interface PushResult {
  pushed: boolean;
  reason?: string;
  leadId?: string;
  created?: boolean;
}

export async function pushLeadToCrm(scanId: string, opts: { strict?: boolean } = {}): Promise<PushResult> {
  const { strict = false } = opts;
  const cfg = config();
  if (!cfg) {
    if (strict) {
      throw new Error("SF_CRM_CLIENT_ID, SF_CRM_USERNAME and SF_CRM_PRIVATE_KEY must all be set");
    }
    return { pushed: false, reason: "not configured" };
  }

  const db = serviceClient();
  const { data: scan } = await db
    .from("scans")
    .select("token, org_name, org_type, org_id, is_sandbox, is_cli_session, created_at")
    .eq("id", scanId)
    .single();

  if (!scan) {
    if (strict) throw new Error("Scan not found");
    return { pushed: false, reason: "scan not found" };
  }

  // Our own test scans are not leads. Same rule as the report email — without
  // this, every CLI run against a client org would create a Lead for them.
  if (scan.is_cli_session && !strict) {
    return { pushed: false, reason: "CLI session" };
  }

  const { data: lead } = await db
    .from("leads")
    .select("name, email, org_id, org_name, org_type")
    .eq("scan_id", scanId)
    .single();

  const orgId = lead?.org_id ?? scan.org_id;
  const email = lead?.email;

  // The org ID is the upsert key. Without it a push would create a duplicate
  // Lead on every re-scan, which is the exact thing the External Id prevents —
  // better to skip and say so.
  if (!orgId) return skip("no org ID on the scan", strict);
  if (!email) return skip("no email captured", strict);

  const { first, last } = splitName(lead?.name ?? null);
  const orgName = lead?.org_name ?? scan.org_name;
  const scannedOn = new Date(scan.created_at).toISOString().slice(0, 10);
  const orgType = lead?.org_type ?? scan.org_type;

  const record: Record<string, string> = {
    LastName: last,
    // Company is required on Lead. The org name is the truest answer we have;
    // falling back to the email domain beats a literal "Unknown" in a list view.
    Company: orgName ?? email.split("@")[1] ?? "Unknown",
    Email: email,
    Description: [
      `Field Triage report: ${PUBLIC_ORIGIN}/r/${scan.token}`,
      `Scanned ${scannedOn}${orgType ? ` · ${orgType}` : ""}${scan.is_sandbox ? " · sandbox" : ""}`,
    ].join("\n"),
  };
  if (first) record.FirstName = first;

  // LeadSource is a restricted picklist in many orgs, where an unknown value is
  // a hard failure. Opt-in only, so a misconfigured value can't cost a lead.
  if (process.env.CRM_LEAD_SOURCE) record.LeadSource = process.env.CRM_LEAD_SOURCE;

  const { token, instanceUrl } = await accessToken(cfg);

  const res = await fetch(
    `${instanceUrl}/services/data/${API_VERSION}/sobjects/Lead/${ORG_ID_FIELD}/${encodeURIComponent(orgId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(15_000),
    },
  );

  // 200 = updated an existing Lead, 201 = created one, 204 = updated with no
  // body returned.
  if (!res.ok) {
    const body = await res.text();
    const message = `CRM upsert failed (${res.status}): ${body.slice(0, 300)}`;
    if (strict) throw new Error(message);
    console.error(message);
    return { pushed: false, reason: message };
  }

  const created = res.status === 201;
  let leadId: string | undefined;
  if (res.status !== 204) {
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    leadId = body?.id;
  }

  return { pushed: true, leadId, created };
}

function skip(reason: string, strict: boolean): PushResult {
  if (strict) throw new Error(reason);
  return { pushed: false, reason };
}
