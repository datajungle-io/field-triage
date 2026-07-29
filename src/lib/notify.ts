import { serviceClient } from "@/lib/supabase";
import { reportEmailHtml, reportEmailText, type ReportEmailData } from "@/lib/email/reportTemplate";

const BOOK_A_CALL = "https://calendly.com/brendan-mcdonald/30min";

/**
 * Origin used in outbound email — always the public site.
 *
 * APP_URL is the *running instance's* origin, which is localhost in
 * development. Mail leaves the machine, so a link built from it is dead on
 * arrival. Override with PUBLIC_APP_URL if the domain ever changes.
 */
const PUBLIC_ORIGIN = (process.env.PUBLIC_APP_URL ?? "https://triage.datajungle.io").replace(
  /\/+$/,
  "",
);

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

  const reportUrl = `${PUBLIC_ORIGIN}/r/${scan.token}`;
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
export interface SendReportOptions {
  /**
   * Override the recipient. Resend's shared onboarding sender can only deliver
   * to the account owner, so testing the template against a real scan needs a
   * way to redirect it.
   */
  to?: string;
  /**
   * Throw instead of returning quietly. Normal sends stay silent — a missing
   * mailer must never fail a finished scan — but a deliberate test needs to be
   * told why nothing arrived.
   */
  strict?: boolean;
}

export async function sendReportToUser(
  scanId: string,
  opts: SendReportOptions = {},
): Promise<void> {
  const { to: overrideTo, strict = false } = opts;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL ?? process.env.LEAD_ALERT_FROM;
  if (!apiKey || !from) {
    // Silent no-op in normal operation — an unconfigured mailer must never fail
    // a finished scan. But when someone is explicitly testing, silence is the
    // wrong answer: say why nothing was sent.
    if (strict) {
      throw new Error("RESEND_API_KEY and REPORT_FROM_EMAIL must both be set");
    }
    return;
  }

  const db = serviceClient();
  const { data: scan } = await db
    .from("scans")
    .select("token, org_name, is_cli_session, expires_at")
    .eq("id", scanId)
    .single();
  // CLI-session scans are ours, not a lead — skipped unless a test asks for it.
  if (!scan) {
    if (strict) throw new Error("Scan not found");
    return;
  }
  if (scan.is_cli_session && !strict) return;

  const { data: lead } = await db
    .from("leads")
    .select("name, email, fields_scanned, delete_ready, ready_no_deps")
    .eq("scan_id", scanId)
    .single();

  const recipient = overrideTo ?? lead?.email;
  if (!lead || !recipient) {
    if (strict) throw new Error("No lead row, or no address to send to");
    return;
  }

  const url = `${PUBLIC_ORIGIN}/r/${scan.token}`;
  const expires = new Date(scan.expires_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const firstName = (lead.name ?? "").split(" ")[0] || null;

  const data: ReportEmailData = {
    firstName,
    orgName: scan.org_name ?? "your org",
    reportUrl: url,
    fieldsScanned: lead.fields_scanned,
    deleteReady: lead.delete_ready,
    readyNoDeps: lead.ready_no_deps,
    expires,
    bookACallUrl: BOOK_A_CALL,
  };

  // A subject promising deletions when the scan found none would be a lie the
  // recipient catches on the first line.
  const subject =
    lead.delete_ready && lead.delete_ready > 0
      ? `Your Field Triage report — ${fmt(lead.delete_ready)} fields worth a look`
      : `Your Field Triage report for ${scan.org_name ?? "your org"}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: recipient,
      subject,
      // Both parts sent: some clients prefer text, and a multipart message with
      // no text alternative scores worse with spam filters.
      html: reportEmailHtml(data),
      text: reportEmailText(data),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    // Resend's rejection reason is the whole diagnosis — a bad key, an
    // unverified domain, a recipient the shared sender can't reach.
    if (strict) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
    console.error(`Report email failed: ${res.status} ${body.slice(0, 200)}`);
  }
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
