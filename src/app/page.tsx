import { ConnectPanel } from "@/components/ConnectPanel";

export const dynamic = "force-dynamic";

/**
 * Landing page, styled to match datajungle.io rather than the report.
 *
 * Deliberate discontinuity: this page is marketing (Inter, pill nav, 1184px
 * container, rounded cards) and everything past the connect button is product
 * (Mozilla Text, fixed sidebar, dense tables). Someone arriving from the
 * marketing site should recognise the brand immediately — that's what earns the
 * click on a button asking for Salesforce access — and then feel they've walked
 * into a real tool.
 */

const ERRORS: Record<string, string> = {
  denied: "You cancelled the Salesforce authorization. Nothing was accessed.",
  // No guessing at the cause — Salesforce's own message is shown underneath.
  oauth: "Salesforce refused the connection.",
  invalid: "That sign-in attempt expired or didn't match. Please try again.",
  exchange: "Salesforce accepted the sign-in but the token exchange failed. Please try again.",
  server: "Something broke on our side starting the scan. Please try again.",
};

const READS: Array<[string, string]> = [
  ["Field definitions and labels", "The inventory: what exists, what's custom, what's managed"],
  [
    "Aggregate counts only — COUNT(Field)",
    "How many records have a value. We never read the values themselves",
  ],
  ["Layouts, Apex, Flows, Validation Rules", "What would break if you deleted the field"],
  [
    "Report and report type column definitions",
    "Which reports use the field. We read report structure, never report results",
  ],
];

const PROMISES: Array<[string, string]> = [
  ["No record data is stored.", "Only counts and metadata reach our database. Not one field value, ever."],
  ["We don't ask for offline access.", "No refresh token, so we can't come back later."],
  ["Your token is revoked when the scan finishes.", "Not expired — actively revoked at Salesforce."],
  ["Read-only.", "The scan issues no writes of any kind."],
  ["Your report expires in 30 days.", "Then the scan data is deleted."],
];

export default function HomePage({
  searchParams,
}: {
  searchParams: { error?: string; detail?: string };
}) {
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.server) : null;

  return (
    <div className="marketing">
      <div className="mk-nav-wrap mk-pad">
        <nav className="mk-nav mk-container">
          <a href="https://datajungle.io" target="_blank" rel="noreferrer" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dj-logo-dark.svg" alt="Data Jungle" height={22} />
          </a>
          <a
            href="https://calendly.com/brendan-mcdonald/30min"
            target="_blank"
            rel="noreferrer"
            className="mk-cta mk-cta-sm"
          >
            Book a call
          </a>
        </nav>
      </div>

      <main className="mk-pad" style={{ paddingBottom: "100px" }}>
        <div className="mk-container">
          {/* Hero. Two columns like datajungle.io's — the right side carries a
              preview of the actual deliverable, which does more selling than any
              amount of copy about it. Marked as an example so it can't be
              mistaken for the reader's own numbers. */}
          <section className="mk-hero" style={{ paddingTop: "72px", paddingBottom: "56px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", flex: 1, minWidth: 0 }}>
              <span className="mk-eyebrow">
                <span className="mk-eyebrow-dot" />
                Free Salesforce audit
              </span>

              <h1 className="mk-h1">Find the custom fields you can delete today.</h1>

              <p className="mk-lede">
                Connect your Salesforce org and we&apos;ll scan every custom field on{" "}
                <strong style={{ color: "#e8eaed", fontWeight: 600 }}>
                  Lead, Account, Contact and Opportunity
                </strong>{" "}
                — how populated each one actually is, how long since anyone touched it, and
                everywhere in Salesforce it&apos;s still referenced. The same Field Triage
                report we build for clients, in about three minutes.
              </p>

              {error && (
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(253,89,68,0.35)",
                    background: "rgba(253,89,68,0.07)",
                    padding: "0.9rem 1.1rem",
                    fontSize: 15,
                    color: "#e8eaed",
                    maxWidth: 620,
                  }}
                >
                  {error}
                  {searchParams.detail && (
                    <div
                      style={{
                        marginTop: "0.45rem",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                        color: "#9ea3ab",
                        wordBreak: "break-word",
                      }}
                    >
                      {searchParams.detail}
                    </div>
                  )}
                </div>
              )}

              <ConnectPanel />
            </div>

            <div className="mk-preview" aria-hidden="true">
              <div className="mk-preview-chrome">
                <span className="mk-preview-dot" />
                <span className="mk-preview-dot" />
                <span className="mk-preview-dot" />
                <span className="mk-preview-title">Field Triage · example</span>
              </div>
              <div className="mk-preview-body">
                <div className="mk-preview-tiles">
                  {[
                    ["822", "Fields scanned", ""],
                    ["149", "Safe to delete", "tile-red"],
                    ["34", "Ready · 0 deps", "tile-lime"],
                  ].map(([n, label, cls]) => (
                    <div key={label} className={`mk-preview-tile ${cls}`}>
                      <div className="mk-preview-num">{n}</div>
                      <div className="mk-preview-label">{label}</div>
                    </div>
                  ))}
                </div>
                {[
                  ["Account", 72, [58, 14, 12, 16]],
                  ["Contact", 10, [22, 10, 30, 38]],
                  ["Lead", 14, [40, 12, 20, 28]],
                  ["Opportunity", 53, [52, 16, 14, 18]],
                ].map(([name, ready, bars]) => (
                  <div key={name as string} className="mk-preview-row">
                    <span className="mk-preview-obj">{name as string}</span>
                    <span className="mk-preview-bar">
                      {(bars as number[]).map((w, i) => (
                        <i key={i} className={`seg s${i}`} style={{ flexGrow: w }} />
                      ))}
                    </span>
                    <span className="mk-preview-ready">{ready as number}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Trust */}
          <section
            style={{
              borderTop: "1px solid rgba(255,255,255,0.07)",
              paddingTop: "56px",
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr)",
              gap: "2rem",
            }}
          >
            <div>
              <h2 className="mk-h2">What the scan actually reads</h2>
              <p className="mk-body" style={{ maxWidth: 720 }}>
                Salesforce has no metadata-only permission — the <code>api</code> scope is the
                narrowest grant that can read field definitions, so the consent screen will
                say we can access your data. Here is exactly what we do with it.
              </p>
            </div>

            <div className="mk-card">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>We read</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {READS.map(([what, why]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td>{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "1.75rem 0 0",
                  display: "grid",
                  gap: "0.7rem",
                }}
              >
                {PROMISES.map(([bold, rest]) => (
                  <li
                    key={bold}
                    style={{ display: "flex", gap: "0.65rem", fontSize: 15, lineHeight: 1.55 }}
                  >
                    <span style={{ color: "#9dd31a", flex: "none" }}>✓</span>
                    <span style={{ color: "#9ea3ab" }}>
                      <strong style={{ color: "#e8eaed", fontWeight: 600 }}>{bold}</strong> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mk-body" style={{ fontSize: 14, color: "#6f757e", maxWidth: 720 }}>
              Connecting tells us your name, email and org — that&apos;s how this is free. We
              use it to send your report link and, occasionally, to ask if you&apos;d like
              help acting on it.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
