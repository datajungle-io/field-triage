"use client";

import { useState } from "react";

/**
 * The connect action. Also the lead capture — Salesforce's identity endpoint
 * returns a verified name, email and org, so there is no form to fill in.
 *
 * The sandbox toggle matters more than it looks: it routes to test.salesforce.com
 * and gives a cautious admin a way to try this against a sandbox before pointing
 * it at production, which converts people who would otherwise bounce.
 */
export function ConnectPanel() {
  const [sandbox, setSandbox] = useState(false);
  const [starting, setStarting] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.5rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1.25rem" }}>
        <button
          className="mk-cta"
          disabled={starting}
          onClick={() => {
            setStarting(true);
            window.location.href = `/api/auth/start${sandbox ? "?sandbox=1" : ""}`;
          }}
        >
          {/* The Salesforce mark keeps its own blue rather than being tinted to
              the lime — a recoloured vendor logo reads as a knock-off, which is
              the opposite of what this button needs to convey. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/salesforce.svg"
            alt=""
            aria-hidden="true"
            style={{ width: 20, height: 20, flex: "none" }}
          />
          {starting ? "Redirecting to Salesforce…" : "Connect Salesforce"}
        </button>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: 15,
            color: "#9ea3ab",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => setSandbox(e.target.checked)}
            style={{ accentColor: "#9DD31A", cursor: "pointer", width: 16, height: 16 }}
          />
          Sandbox or scratch org
        </label>
      </div>

      {/*
        Salesforce puts a large orange "Security Warning" at the top of the
        consent screen for every external OAuth app. Hitting it unprepared is
        what makes people abandon a flow they had already decided to trust, so it
        is named here first — being told what to expect reads as candour, being
        surprised by it reads as a red flag. The warning's own condition (someone
        contacted you and told you to use this) does not apply to a reader who
        arrived here and chose to click.
      */}
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6f757e", margin: 0, maxWidth: 620 }}>
        Salesforce will show an orange security warning on the next screen. It appears for
        every third-party app and warns against being <em>talked into</em> connecting one —
        read it, then check what&apos;s actually being asked for: identity, and API access.{" "}
        <a
          href="/security"
          style={{ color: "#9ea3ab", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          What we do with it
        </a>
        .
      </p>

      <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6f757e", margin: 0, maxWidth: 620 }}>
        You&apos;ll need the API Enabled and View Setup and Configuration permissions — most
        admins have both. Nothing is written to your org.{" "}
        {/* Salesforce reuses an existing session silently, so someone signed in
            to the wrong org has no way to correct it without this. */}
        <a
          href="/api/auth/start?prompt=login"
          style={{ color: "#9ea3ab", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          Signed in to a different org?
        </a>
      </p>
    </div>
  );
}
