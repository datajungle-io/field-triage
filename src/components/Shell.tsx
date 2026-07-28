import Link from "next/link";

/**
 * The Data Jungle chrome — a hand-coded equivalent of Evidence's default layout and
 * Sidebar.svelte, which generates its tree from the pages/ directory.
 *
 * Profile Triage and Report Triage are rendered but locked. They exist in the
 * paid product and this report is deliberately one page of a larger instance:
 * showing the doors is more honest, and more persuasive, than pretending the
 * product is only this.
 */

interface ShellProps {
  token: string;
  active?: "field-triage" | "detail";
  children: React.ReactNode;
}

export function Shell({ token, active = "field-triage", children }: ShellProps) {
  return (
    <div>
      <div className="app-topbar">
        <span>datajungle.io</span>
        <a
          href="https://calendly.com/brendan-mcdonald/30min"
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#0a2a1f",
            background: "#B5D333",
            padding: "0.35rem 0.75rem",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Book a call
        </a>
      </div>

      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="nav-group">
            <Link className="nav-section" href={`/r/${token}`}>
              Home
            </Link>
          </div>

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
            <span className="nav-leaf locked" title="Available in the full product">
              Profile Triage <LockIcon />
            </span>
            <span className="nav-leaf locked" title="Available in the full product">
              Report Triage <LockIcon />
            </span>
          </div>
        </aside>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
