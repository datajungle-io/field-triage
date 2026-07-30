import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * The page to link when someone asks "why should I trust this?".
 *
 * Written to be checkable rather than reassuring. Every claim here is either
 * verifiable by the reader without taking our word for it (the consent screen,
 * the network tab) or stated precisely enough to be falsifiable. Vague comfort
 * language — "we take your security seriously", "bank-grade encryption" — is
 * absent on purpose: it is what every breached company said beforehand, and a
 * sceptical Salesforce admin reads it as evasion.
 *
 * The awkward parts are included. We do create a CRM record. We can open your
 * report. Saying so plainly is worth more than being caught omitting it, and
 * anyone who reads the source will find both.
 */

const STORED: Array<[string, string]> = [
  [
    "Your name, email and org",
    "From Salesforce's identity endpoint when you authorise. This is the lead capture — it is why the scan is free, and why there is no form.",
  ],
  [
    "Field metadata",
    "API name, label, type, namespace, and the date the field definition was last modified. The same information Setup shows you.",
  ],
  [
    "Aggregate counts",
    "For each field, how many records have a value — a single number like 412 out of 8,174. Never which records, never what the value is.",
  ],
  [
    "Component names",
    "The names of reports, layouts, flows, Apex classes and validation rules that reference a field, so the report can tell you what to clear first.",
  ],
];

const NOT_STORED: Array<[string, string]> = [
  [
    "No field values, ever",
    "Not one. The scan issues COUNT() aggregates, so no row-level data is returned to us in the first place.",
  ],
  [
    "No report results",
    "We read the column definitions of a report to see which fields it uses. We never run it.",
  ],
  [
    "No refresh token",
    "We don't request offline access, so we cannot return to your org later. You can confirm this on Salesforce's own consent screen before you grant anything.",
  ],
  [
    "Nothing is written to your org",
    "The scan issues no inserts, updates or deletes of any kind.",
  ],
];

const REPO = "https://github.com/datajungle-io/field-triage-oss";

export default function SecurityPage() {
  // Baked in at build time from Netlify's COMMIT_REF. See next.config.mjs.
  const commit = process.env.NEXT_PUBLIC_COMMIT_REF ?? "";
  const shortCommit = commit ? commit.slice(0, 7) : null;

  return (
    <div className="marketing">
      <div className="mk-nav-wrap mk-pad">
        <nav className="mk-nav mk-container">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dj-logo-dark.svg" alt="Data Jungle" height={22} />
          </Link>
          <Link href="/" className="mk-cta mk-cta-sm">
            Run a scan
          </Link>
        </nav>
      </div>

      <main className="mk-pad" style={{ paddingBottom: "100px" }}>
        <div className="mk-container" style={{ maxWidth: 820 }}>
          <section style={{ paddingTop: "64px", paddingBottom: "40px" }}>
            <span className="mk-eyebrow">
              <span className="mk-eyebrow-dot" />
              Security &amp; data handling
            </span>

            <h1 className="mk-h1" style={{ fontSize: 40, marginTop: "1.5rem" }}>
              What Field Triage does with your data.
            </h1>

            <p className="mk-lede" style={{ marginTop: "1.25rem", maxWidth: "100%" }}>
              You are being asked to connect a production Salesforce org to a tool you
              found on the internet. Scepticism is the correct response. This page is
              written so you can check the claims rather than trust them.
            </p>
          </section>

          {/* The scope question, first, because it's the objection everyone has. */}
          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              Why it asks for API access
            </h2>
            <p className="mk-body">
              Salesforce has no metadata-only OAuth scope. To read field definitions and
              run aggregate counts, <code>api</code> is the narrowest grant that exists —
              so the consent screen will say the app can access your data. That is
              Salesforce&apos;s wording for the scope, not a description of what we do
              with it.
            </p>
            <p className="mk-body" style={{ marginTop: "0.9rem" }}>
              What we do with it is below, and the point of this page is that you
              don&apos;t have to believe us.
            </p>
          </section>

          {/* Named before they see it. An unexpected orange warning ends the
              flow; an expected one is just a form. */}
          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              The warning Salesforce will show you
            </h2>
            <p className="mk-body">
              The consent screen opens with a large orange <strong style={strong}>Security
              Warning</strong>. Salesforce shows it for every external app, and it is worth
              reading rather than clicking past, because it warns about something specific:
            </p>
            <blockquote
              style={{
                margin: "1rem 0",
                padding: "0.9rem 1.2rem",
                borderLeft: "3px solid #F5B731",
                background: "rgba(245,183,49,0.06)",
                color: "#b6bbc2",
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              &ldquo;If someone contacted you via phone or email and instructed you to use
              this app, <strong style={strong}>do not proceed</strong>.&rdquo;
            </blockquote>
            <p className="mk-body">
              That is an anti-phishing notice about <em>how you got here</em>, not a judgment
              about this app. If someone called you and talked you into connecting
              something, you should absolutely stop — that advice is correct, and it applies
              to us as much as to anyone. If you found this yourself and chose to click, the
              condition it describes doesn&apos;t apply.
            </p>
            <p className="mk-body" style={{ marginTop: "0.9rem" }}>
              Underneath it, the screen lists what is actually being requested:{" "}
              <strong style={strong}>Access the identity URL service</strong> and{" "}
              <strong style={strong}>Manage user data via APIs</strong>. Two lines. What is
              not there matters more — see below.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              What we store
            </h2>
            <div className="mk-card" style={{ padding: "1.5rem 1.75rem" }}>
              <ul style={listStyle}>
                {STORED.map(([what, why]) => (
                  <li key={what} style={itemStyle}>
                    <span style={{ color: "#9dd31a", flex: "none" }}>›</span>
                    <span style={{ color: "#9ea3ab" }}>
                      <strong style={{ color: "#e8eaed", fontWeight: 600 }}>{what}.</strong>{" "}
                      {why}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              What we never store
            </h2>
            <div className="mk-card" style={{ padding: "1.5rem 1.75rem" }}>
              <ul style={listStyle}>
                {NOT_STORED.map(([what, why]) => (
                  <li key={what} style={itemStyle}>
                    <span style={{ color: "#9dd31a", flex: "none" }}>✓</span>
                    <span style={{ color: "#9ea3ab" }}>
                      <strong style={{ color: "#e8eaed", fontWeight: 600 }}>{what}.</strong>{" "}
                      {why}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              Your access token
            </h2>
            <p className="mk-body">
              Encrypted at rest while the scan runs, then <strong style={strong}>actively
              revoked at Salesforce</strong> the moment it finishes — not left to expire —
              and the ciphertext is deleted from our database in the same step. If
              revocation fails for any reason, the token is still deleted on our side and
              dies with your org&apos;s session timeout.
            </p>
            <p className="mk-body" style={{ marginTop: "0.9rem" }}>
              Because we never requested a refresh token, there is nothing left that could
              be used to reach your org again. This is the part you can verify yourself:
              check your Connected Apps in Setup after a scan.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              The commercial part, stated plainly
            </h2>
            <p className="mk-body">
              This is a lead magnet. When you run a scan we create a record in{" "}
              <strong style={strong}>our own</strong> Salesforce org containing your name,
              email, company and a link to your report — and we may email you about the
              data quality audit we sell. That is the trade: you get the report, we get an
              introduction.
            </p>
            <p className="mk-body" style={{ marginTop: "0.9rem" }}>
              It also means <strong style={strong}>we can open your report</strong>. Worth
              being explicit about, though it grants us nothing new: we ran the scan, so
              the results are already in our database either way.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              Retention
            </h2>
            <p className="mk-body">
              Your report link works for <strong style={strong}>30 days</strong>. After
              that the scan data is deleted. The lead record — name, email, company —
              persists, the same as if you had filled in a contact form. Email us and
              we&apos;ll delete it.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              How to check any of this
            </h2>
            <div className="mk-card" style={{ padding: "1.5rem 1.75rem" }}>
              <ul style={listStyle}>
                <li style={itemStyle}>
                  <span style={{ color: "#9dd31a", flex: "none" }}>1</span>
                  <span style={{ color: "#9ea3ab" }}>
                    <strong style={strong}>Count the lines on the consent screen.</strong>{" "}
                    It is Salesforce&apos;s page, not ours, and it lists exactly two:
                    &ldquo;Access the identity URL service&rdquo; and &ldquo;Manage user data
                    via APIs&rdquo;. There is no third line reading &ldquo;Perform requests
                    at any time&rdquo; — that is the offline access we never asked for, and
                    its absence is why we cannot come back later.
                  </span>
                </li>
                <li style={itemStyle}>
                  <span style={{ color: "#9dd31a", flex: "none" }}>2</span>
                  <span style={{ color: "#9ea3ab" }}>
                    <strong style={strong}>Open your browser&apos;s network tab.</strong>{" "}
                    This site makes no third-party requests. No analytics, no trackers, no
                    session recording — the fonts are self-hosted for the same reason.
                  </span>
                </li>
                <li style={itemStyle}>
                  <span style={{ color: "#9dd31a", flex: "none" }}>3</span>
                  <span style={{ color: "#9ea3ab" }}>
                    <strong style={strong}>Check your login history.</strong> Setup → Login
                    History shows exactly when we connected, and Connected Apps shows the
                    access is gone once the scan finishes.
                  </span>
                </li>
                <li style={itemStyle}>
                  <span style={{ color: "#9dd31a", flex: "none" }}>4</span>
                  <span style={{ color: "#9ea3ab" }}>
                    <strong style={strong}>Read the source.</strong> The whole thing is
                    public:{" "}
                    <a
                      href="https://github.com/datajungle-io/field-triage-oss"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#9dd31a" }}
                    >
                      github.com/datajungle-io/field-triage-oss
                    </a>
                    . The database schema is in <code>supabase/migrations/</code> — every
                    column we persist, so &ldquo;we store counts, not values&rdquo; is
                    something you can check rather than accept. Token revocation is in{" "}
                    <code>src/lib/scan/phases/finalize.ts</code>, and the OAuth scopes are in{" "}
                    <code>salesforce/</code>.
                  </span>
                </li>
                <li style={itemStyle}>
                  <span style={{ color: "#9dd31a", flex: "none" }}>5</span>
                  <span style={{ color: "#9ea3ab" }}>
                    <strong style={strong}>Scan a sandbox first.</strong> Entirely
                    reasonable, and it works the same way.
                  </span>
                </li>
              </ul>
            </div>
          </section>

          {/* The fair objection to "read the source" is that published code and
              deployed code need not be the same thing. This is the answer that
              doesn't require trusting us — and its limits are stated, because
              overclaiming here would undo the point of the page. */}
          <section style={sectionStyle}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              &ldquo;How do I know the deployed site runs that code?&rdquo;
            </h2>
            <p className="mk-body">
              The right question, and the honest answer is that publishing source proves
              nothing on its own. So this build states which commit it came from:
            </p>

            <div
              style={{
                margin: "1rem 0",
                padding: "0.9rem 1.2rem",
                borderRadius: 10,
                border: "1px solid #252b34",
                background: "#151a21",
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                color: "#e8eaed",
                wordBreak: "break-all",
              }}
            >
              {shortCommit ? (
                <a
                  href={`${REPO}/commit/${commit}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#9dd31a", textDecoration: "none" }}
                >
                  {commit}
                </a>
              ) : (
                <span style={{ color: "#9ea3ab" }}>
                  (running locally — no build commit)
                </span>
              )}
            </div>

            <p className="mk-body">
              That hash is baked into the JavaScript this page served you, so you can read
              it out of the bundle rather than take it from this paragraph. Look it up in{" "}
              <a href={REPO} target="_blank" rel="noreferrer" style={{ color: "#9dd31a" }}>
                the public repo
              </a>
              . If it isn&apos;t there, every claim on this page is worthless and you should
              say so loudly.
            </p>
            <p className="mk-body" style={{ marginTop: "0.9rem" }}>
              What this does <em>not</em> prove: that the build pipeline wasn&apos;t
              tampered with between that commit and this deploy. No project can prove that
              to you from the outside — a fully public repo deploying through CI you
              can&apos;t inspect has exactly the same gap. What it does is make the claim
              falsifiable and pin it to a specific, checkable artefact, which is a much
              better position than asking you to believe a marketing page.
            </p>
          </section>

          <section style={{ ...sectionStyle, borderBottom: "none" }}>
            <h2 className="mk-h2" style={{ fontSize: 24 }}>
              Who is behind this
            </h2>
            <p className="mk-body">
              Data Jungle is Brendan McDonald&apos;s Salesforce consultancy. Field Triage is
              a cut-down version of the field census we build for clients. If something
              here is wrong or unclear, mail{" "}
              <a href="mailto:brendan@datajungle.io" style={{ color: "#9dd31a" }}>
                brendan@datajungle.io
              </a>{" "}
              — a real address, read by a real person.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  paddingBottom: "36px",
  marginBottom: "36px",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "0.9rem",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  fontSize: 15,
  lineHeight: 1.6,
};

const strong: React.CSSProperties = { color: "#e8eaed", fontWeight: 600 };
