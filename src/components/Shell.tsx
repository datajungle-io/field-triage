import Link from "next/link";

/**
 * The Data Jungle chrome — a hand-coded equivalent of Evidence's default layout
 * and Sidebar.svelte, which generates its tree from the pages/ directory.
 *
 * Profile Triage and Report Triage are rendered but locked. They exist in the
 * paid product and this report is deliberately one page of a larger instance:
 * showing the doors is more honest, and more persuasive, than pretending the
 * product is only this.
 */

interface ShellProps {
  token: string;
  active?: "field-triage" | "detail";
  /** Shown in the sidebar so the report says whose org it is. */
  orgName?: string | null;
  scannedAt?: string | null;
  expiresAt?: string | null;
  children: React.ReactNode;
}

export function Shell({
  token,
  active = "field-triage",
  orgName,
  scannedAt,
  expiresAt,
  children,
}: ShellProps) {
  const fmtDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;

  return (
    <div>
      <div className="app-topbar">
        <div className="app-topbar-inner">
          <a href="https://datajungle.io" target="_blank" rel="noreferrer" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dj-logo-dark.svg" alt="Data Jungle" height={20} />
          </a>
          <a
            href="https://calendly.com/brendan-mcdonald/30min"
            target="_blank"
            rel="noreferrer"
            className="topbar-cta"
          >
            Book a call
          </a>
        </div>
      </div>

      <div className="app-shell">
        <aside className="app-sidebar">
          {/*
            No "Home" item: this report is a single page, so it linked to itself
            and read as broken. The space is better spent saying whose org this
            is and when it was scanned — context that otherwise appears nowhere.
          */}
          {orgName && (
            <div className="sidebar-org">
              {/*
                A source label, not a badge. Set beside the org *name* the
                full-colour mark read as that company's own logo — worse than
                decorative, actively misleading. On its own muted line above the
                name, with the word "Salesforce org" carrying the meaning, it
                says where the data came from and nothing more. Desaturated so
                it sits in a monochrome column without competing with the one
                accent colour the page has.
              */}
              <div className="sidebar-org-source">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/salesforce.svg" alt="" aria-hidden="true" width={14} height={10} />
                Salesforce org
              </div>
              <div className="sidebar-org-name">{orgName}</div>
              {scannedAt && (
                <div className="sidebar-org-meta">Scanned {fmtDate(scannedAt)}</div>
              )}
              {expiresAt && (
                <div className="sidebar-org-meta">Expires {fmtDate(expiresAt)}</div>
              )}
            </div>
          )}

          <div className="nav-group">
            <span className="nav-section">Metadata</span>
            <Link
              className={`nav-leaf ${active === "field-triage" ? "active" : ""}`}
              href={`/r/${token}`}
            >
              Field Triage
            </Link>
            <div className="nav-sub">
              <Link
                className={`nav-leaf ${active === "detail" ? "active" : ""}`}
                href={`/r/${token}/detail`}
              >
                Triage Detail
              </Link>
            </div>
            {/*
              No locked Profile/Report Triage teasers. They advertised other
              dashboard pages, but the actual next step is a data quality audit —
              weeks of work and conversations with subject-matter experts, not
              another screen. Teasing the wrong thing costs credibility twice:
              the scan can't produce those pages, and they aren't what's for sale.
            */}
          </div>
        </aside>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

