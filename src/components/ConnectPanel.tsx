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
    <div className="hero" style={{ marginTop: "2rem" }}>
      <button
        className="hero-cta"
        style={{
          marginTop: 0,
          fontSize: "0.95rem",
          padding: "0.75rem 1.4rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.6rem",
        }}
        disabled={starting}
        onClick={() => {
          setStarting(true);
          window.location.href = `/api/auth/start${sandbox ? "?sandbox=1" : ""}`;
        }}
      >
        {/* The Salesforce mark keeps its own blue rather than being tinted to the
            lime — a recoloured vendor logo reads as a knock-off, which is the
            opposite of what this button needs to convey. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/salesforce.svg" alt="" className="sf-mark" aria-hidden="true" />
        {starting ? "Redirecting to Salesforce…" : "Connect Salesforce →"}
      </button>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: "1rem",
          fontSize: "0.85rem",
          color: "hsl(var(--base-content) / 0.7)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={sandbox}
          onChange={(e) => setSandbox(e.target.checked)}
          style={{ accentColor: "#B5D333", cursor: "pointer" }}
        />
        This is a sandbox or scratch org
      </label>

      <p
        style={{
          marginTop: "1rem",
          fontSize: "0.8rem",
          color: "hsl(var(--base-content) / 0.55)",
        }}
      >
        You&apos;ll need the API Enabled and View Setup and Configuration permissions — most
        admins have both. Nothing is written to your org.
      </p>

      {/* Salesforce reuses an existing session silently, so someone signed in to
          the wrong org has no way to correct it without this. */}
      <p style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
        <a
          href={`/api/auth/start?prompt=login${sandbox ? "&sandbox=1" : ""}`}
          style={{ color: "hsl(var(--base-content) / 0.55)" }}
        >
          Signed in to a different org? Choose an account →
        </a>
      </p>
    </div>
  );
}
