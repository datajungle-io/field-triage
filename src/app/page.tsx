import { ConnectPanel } from "@/components/ConnectPanel";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  denied: "You cancelled the Salesforce authorization. Nothing was accessed.",
  // No guessing at the cause — Salesforce's own message is shown underneath.
  oauth: "Salesforce refused the connection.",
  invalid: "That sign-in attempt expired or didn't match. Please try again.",
  exchange: "Salesforce accepted the sign-in but the token exchange failed. Please try again.",
  server: "Something broke on our side starting the scan. Please try again.",
};

export default function HomePage({
  searchParams,
}: {
  searchParams: { error?: string; detail?: string };
}) {
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.server) : null;

  return (
    <div>
      <div className="app-topbar">
        <span>datajungle.io</span>
      </div>

      <main
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "3.5rem 1.5rem 5rem",
        }}
      >
        <div className="hero-eyebrow">Free Salesforce audit</div>
        <h1 className="hero-title" style={{ fontSize: "2.6rem" }}>
          Find the custom fields you can delete today.
        </h1>
        <p className="hero-sub" style={{ fontSize: "1.05rem", marginTop: "0.75rem" }}>
          Connect your Salesforce org and we&apos;ll scan every custom field on{" "}
          <strong>Lead, Account, Contact and Opportunity</strong> — how populated each one
          actually is, how long since anyone touched it, and everywhere in Salesforce
          it&apos;s still referenced. You get the same Field Triage report we build for
          clients, in about three minutes.
        </p>

        {error && (
          <div className="coverage-banner" style={{ borderLeftColor: "#F07070" }}>
            <span aria-hidden="true">⚠</span>
            <div>
              {error}
              {searchParams.detail && (
                <div
                  style={{
                    marginTop: "0.4rem",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                    color: "hsl(var(--base-content) / 0.6)",
                    wordBreak: "break-word",
                  }}
                >
                  {searchParams.detail}
                </div>
              )}
            </div>
          </div>
        )}

        <ConnectPanel />

        <section style={{ marginTop: "3rem" }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            What the scan actually reads
          </h2>
          <p className="section-note">
            Salesforce has no metadata-only permission — the <code>api</code> scope is the
            narrowest grant that can read field definitions, so the consent screen will say
            we can access your data. Here is exactly what we do with it.
          </p>

          <div className="census-table">
            <table>
              <thead>
                <tr>
                  <th>We read</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Field definitions and labels</td>
                  <td>The inventory: what exists, what&apos;s custom, what&apos;s managed</td>
                </tr>
                <tr>
                  <td>
                    Aggregate counts only — <span className="field-name">COUNT(Field)</span>
                  </td>
                  <td>
                    How many records have a value. We never read the values themselves
                  </td>
                </tr>
                <tr>
                  <td>Layouts, Apex, Flows, Validation Rules</td>
                  <td>What would break if you deleted the field</td>
                </tr>
                <tr>
                  <td>Report and report type column definitions</td>
                  <td>
                    Which reports use the field. We read report structure, never report
                    results
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul
            style={{
              marginTop: "1.5rem",
              paddingLeft: "1.1rem",
              fontSize: "0.9rem",
              lineHeight: 1.7,
              color: "hsl(var(--base-content) / 0.8)",
            }}
          >
            <li>
              <strong>No record data is stored.</strong> Only counts and metadata reach our
              database. Not one field value, ever.
            </li>
            <li>
              <strong>We don&apos;t ask for offline access.</strong> No refresh token, so we
              can&apos;t come back later.
            </li>
            <li>
              <strong>Your token is revoked when the scan finishes.</strong> Not expired —
              actively revoked at Salesforce.
            </li>
            <li>
              <strong>Read-only.</strong> The scan issues no writes of any kind.
            </li>
            <li>
              <strong>Your report expires in 30 days</strong>, then the scan data is deleted.
            </li>
          </ul>

          <p
            style={{
              marginTop: "1.5rem",
              fontSize: "0.85rem",
              color: "hsl(var(--base-content) / 0.6)",
            }}
          >
            Connecting tells us your name, email and org — that&apos;s how this is free. We
            use it to send your report link and, occasionally, to ask if you&apos;d like help
            acting on it.
          </p>
        </section>
      </main>
    </div>
  );
}
