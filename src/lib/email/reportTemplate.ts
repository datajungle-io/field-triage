/**
 * HTML template for the report-ready email.
 *
 * Email is not the web. Everything here is deliberate and none of it is how the
 * app itself is built:
 *
 *   - Tables, not flexbox or grid. Outlook renders through Word, which supports
 *     neither.
 *   - Inline styles only. Gmail strips <style> blocks in several contexts, and
 *     nothing may depend on a stylesheet surviving.
 *   - Every colour stated explicitly on every element. A dark palette with
 *     unstated text colour becomes black-on-black the moment a client applies
 *     its own dark-mode inversion.
 *   - No web fonts. Mozilla Text will not load in a mail client; the stack falls
 *     back to the system UI face, which is what recipients actually see.
 *
 * The dark background matches the product, but it is applied to a contained card
 * on a neutral page background rather than the whole body — a full-bleed dark
 * email that a client re-inverts looks broken, whereas a card degrades to a
 * legible box.
 */

export interface ReportEmailData {
  firstName: string | null;
  orgName: string;
  reportUrl: string;
  fieldsScanned: number | null;
  deleteReady: number | null;
  readyNoDeps: number | null;
  expires: string;
  bookACallUrl: string;
}

const BG = "#0e1116";
const CARD = "#151a21";
const LINE = "#252b34";
const TEXT = "#e8eaed";
const MUTED = "#9ea3ab";
const LIME = "#9dd31a";
const RED = "#fd5944";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function fmt(value: number | null): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}

/** Minimal escaping — org names arrive from Salesforce and land in markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statCell(value: string, label: string, colour: string, sub: string): string {
  return `
    <td width="33%" style="padding:0 6px;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="background-color:${CARD};border:1px solid ${LINE};border-radius:10px;">
        <tr><td style="padding:18px 16px;text-align:center;font-family:${FONT};">
          <div style="font-size:30px;line-height:1.1;font-weight:700;color:${colour};">${value}</div>
          <div style="font-size:12px;line-height:1.4;color:${TEXT};font-weight:600;padding-top:6px;">${label}</div>
          <div style="font-size:11px;line-height:1.4;color:${MUTED};padding-top:3px;">${sub}</div>
        </td></tr>
      </table>
    </td>`;
}

export function reportEmailHtml(d: ReportEmailData): string {
  const greeting = d.firstName ? `${esc(d.firstName)},` : "Hi,";
  const org = esc(d.orgName);

  // The lead line changes with the finding. "Nothing to delete" is a real and
  // legitimate result — an org in good shape — and dressing it up as a
  // disappointment would be dishonest about their own data.
  const lead =
    d.deleteReady && d.deleteReady > 0
      ? `We scanned <strong style="color:${TEXT};">${fmt(d.fieldsScanned)} fields</strong> across Lead, Account,
         Contact and Opportunity. <strong style="color:${TEXT};">${fmt(d.deleteReady)}</strong> look like
         deletion candidates — under 1% populated and untouched for 90&nbsp;days or more.`
      : `We scanned <strong style="color:${TEXT};">${fmt(d.fieldsScanned)} fields</strong> across Lead, Account,
         Contact and Opportunity and found nothing obviously abandoned. That is a good result — your
         custom fields are being used.`;

  const nextStep =
    d.readyNoDeps && d.readyNoDeps > 0
      ? `<strong style="color:${TEXT};">Start with the ${fmt(d.readyNoDeps)} that have zero references.</strong>
         Nothing points at them — no Apex, no flow, no layout, no report — so there is nothing to untangle first.`
      : `Every candidate still has something pointing at it — a report, a layout, a flow. The report names
         each reference, so you can see exactly what has to be cleared before a field can go.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Your Field Triage report</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};">
  <!-- Preheader: the grey line beside the subject in most inboxes. Left blank,
       clients pull the first body text instead, which here is the logo alt. -->
  <div style="display:none;font-size:1px;color:${BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${fmt(d.deleteReady)} deletion candidates found in ${org}. Your report is ready.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background-color:${BG};margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:32px 12px 48px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"
               style="width:560px;max-width:100%;">

          <tr>
            <td style="padding:0 6px 26px;">
              <a href="https://datajungle.io" style="text-decoration:none;">
                <img src="https://triage.datajungle.io/dj-logo-email.png"
                     alt="Data Jungle" width="220" height="46"
                     style="display:block;border:0;outline:none;width:220px;height:auto;">
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 6px 6px;font-family:${FONT};">
              <div style="font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:${LIME};font-weight:700;padding-bottom:10px;">
                Field Triage
              </div>
              <h1 style="margin:0 0 14px;font-size:25px;line-height:1.25;font-weight:700;color:${TEXT};">
                Your report for ${org} is ready.
              </h1>
              <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:${MUTED};">
                ${greeting}
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
                ${lead}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${statCell(fmt(d.fieldsScanned), "Fields scanned", TEXT, "4 core objects")}
                  ${statCell(fmt(d.deleteReady), "Candidates", RED, "&lt;1% populated")}
                  ${statCell(fmt(d.readyNoDeps), "No dependencies", LIME, "start here")}
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 6px 26px;font-family:${FONT};">
              <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">
                ${nextStep}
              </p>
            </td>
          </tr>

          <!-- Bulletproof-ish button: a padded table cell rather than a styled
               <a>, so Outlook renders the background rather than a bare link. -->
          <tr>
            <td style="padding:0 6px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${LIME};border-radius:8px;">
                    <a href="${d.reportUrl}"
                       style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;
                              font-weight:700;color:#0e1116;text-decoration:none;">
                      Open your report &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#6f757e;word-break:break-all;">
                Or paste this into your browser:<br>
                <a href="${d.reportUrl}" style="color:${MUTED};text-decoration:underline;">${d.reportUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                     style="background-color:${CARD};border:1px solid ${LINE};border-radius:10px;">
                <tr>
                  <td style="padding:20px 22px;font-family:${FONT};">
                    <div style="font-size:15px;font-weight:700;color:${TEXT};padding-bottom:6px;">
                      Want the rest of the picture?
                    </div>
                    <div style="font-size:14px;line-height:1.6;color:${MUTED};padding-bottom:14px;">
                      Field Triage looks at four objects and one question. A data quality audit covers
                      your whole org — duplicates, validation, reporting you can actually trust.
                    </div>
                    <a href="${d.bookACallUrl}"
                       style="font-size:14px;font-weight:700;color:${LIME};text-decoration:none;">
                      Book a free data quality audit &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 6px 0;font-family:${FONT};">
              <div style="border-top:1px solid ${LINE};padding-top:18px;font-size:12px;line-height:1.65;color:#6f757e;">
                This link works until <strong style="color:${MUTED};">${esc(d.expires)}</strong>, then the scan
                data is deleted. Nothing was written to your org, and the access you granted was revoked as
                soon as the scan finished.
                <br><br>
                <a href="https://datajungle.io" style="color:${MUTED};text-decoration:none;">Data Jungle</a>
                &nbsp;·&nbsp; Salesforce reporting, done for you
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Plain-text alternative. Not a fallback nicety — a multipart message without
 * one scores worse in spam filters, and some clients show it by preference.
 */
export function reportEmailText(d: ReportEmailData): string {
  return [
    d.firstName ? `${d.firstName},` : "Hi,",
    "",
    `Your Field Triage report for ${d.orgName} is ready:`,
    d.reportUrl,
    "",
    `We scanned ${fmt(d.fieldsScanned)} fields across Lead, Account, Contact and Opportunity.`,
    d.deleteReady === 1
      ? "1 is a deletion candidate — under 1% populated and untouched for 90+ days."
      : `${fmt(d.deleteReady)} are deletion candidates — under 1% populated and untouched for 90+ days.`,
    d.readyNoDeps && d.readyNoDeps > 0
      ? `${fmt(d.readyNoDeps)} of those have zero references anywhere in Salesforce. Start there — ` +
        "nothing has to be untangled first."
      : "Each one still has something referencing it. The report names every reference.",
    "",
    "Want the rest of the picture? Field Triage looks at four objects and one question.",
    "A data quality audit covers your whole org:",
    d.bookACallUrl,
    "",
    `This link works until ${d.expires}, then the scan data is deleted. Nothing was`,
    "written to your org, and the access you granted was revoked as soon as the",
    "scan finished.",
    "",
    "— Data Jungle",
    "https://datajungle.io",
  ].join("\n");
}
