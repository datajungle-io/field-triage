import { serviceClient } from "@/lib/supabase";

/**
 * Lead alert on scan completion.
 *
 * Deliberately dependency-free: a POST to Resend and/or a Slack-style webhook,
 * both optional. If neither is configured this is a no-op, because a missing
 * notification must never be the thing that fails a completed scan.
 */
export async function notifyNewScan(scanId: string): Promise<void> {
  const db = serviceClient();

  const { data: lead } = await db
    .from("leads")
    .select("name, email, org_name, org_type, is_sandbox, fields_scanned, delete_ready, ready_no_deps")
    .eq("scan_id", scanId)
    .single();

  const { data: scan } = await db.from("scans").select("token").eq("id", scanId).single();
  if (!lead || !scan) return;

  const reportUrl = `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/r/${scan.token}`;
  const headline =
    `${lead.org_name ?? "Unknown org"}${lead.is_sandbox ? " (sandbox)" : ""} · ` +
    `${fmt(lead.fields_scanned)} fields · ${fmt(lead.delete_ready)} delete-ready · ` +
    `${fmt(lead.ready_no_deps)} with zero dependencies`;

  const lines = [
    `New Field Triage scan — ${headline}`,
    "",
    `Name:   ${lead.name ?? "—"}`,
    `Email:  ${lead.email ?? "—"}`,
    `Org:    ${lead.org_name ?? "—"} (${lead.org_type ?? "unknown edition"})`,
    `Report: ${reportUrl}`,
  ].join("\n");

  await Promise.allSettled([sendEmail(headline, lines), sendWebhook(lines)]);
}

/**
 * Send the report link to the person who ran the scan.
 *
 * Without this the token in the URL is the only handle on the report — close
 * the tab and it's unrecoverable, because nothing else knows it. The verified
 * address from the OAuth identity endpoint is exactly what makes this possible
 * with no form.
 *
 * Skipped for CLI-session scans, which are ours and not a lead.
 */
export async function sendReportToUser(scanId: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL ?? process.env.LEAD_ALERT_FROM;
  if (!apiKey || !from) return;

  const db = serviceClient();
  const { data: scan } = await db
    .from("scans")
    .select("token, org_name, is_cli_session, expires_at")
    .eq("id", scanId)
    .single();
  if (!scan || scan.is_cli_session) return;

  const { data: lead } = await db
    .from("leads")
    .select("name, email, fields_scanned, delete_ready, ready_no_deps")
    .eq("scan_id", scanId)
    .single();
  if (!lead?.email) return;

  const url = `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/r/${scan.token}`;
  const expires = new Date(scan.expires_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const firstName = (lead.name ?? "").split(" ")[0];

  const text = [
    firstName ? `${firstName},` : "Hi,",
    "",
    `Your Field Triage report for ${scan.org_name ?? "your org"} is ready:`,
    url,
    "",
    `We scanned ${fmt(lead.fields_scanned)} fields across Lead, Account, Contact and Opportunity.`,
    `${fmt(lead.delete_ready)} are delete-ready — under 1% populated and untouched for 90+ days.`,
    `${fmt(lead.ready_no_deps)} of those have zero references anywhere in Salesforce, so they can go as-is.`,
    "",
    "Start with the zero-dependency ones — nothing has to be untangled first.",
    "",
    `This link works until ${expires}. Nothing was written to your org, and the`,
    "access you granted was revoked as soon as the scan finished.",
    "",
    "— Data Jungle",
    "https://datajungle.io",
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: lead.email,
      subject: `Your Field Triage report — ${fmt(lead.delete_ready)} fields you can delete`,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function sendEmail(subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_ALERT_EMAIL;
  const from = process.env.LEAD_ALERT_FROM;
  if (!apiKey || !to || !from) return;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Field Triage · ${subject}`,
      text: body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

async function sendWebhook(text: string): Promise<void> {
  const url = process.env.LEAD_ALERT_WEBHOOK;
  if (!url) return;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}
