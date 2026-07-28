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
