import type { Metadata } from "next";
import "./globals.css";

const TITLE = "Field Triage — Data Jungle";
/**
 * Kept close to the hero, and under ~155 characters so search results don't
 * truncate it mid-sentence. The old copy ran to 190 and spent its opening words
 * on mechanics ("Connect your org and see which…") rather than on what the
 * reader gets.
 */
const DESCRIPTION =
  "Find the Salesforce fields you can delete today. A free scan of every custom " +
  "field on Lead, Account, Contact and Opportunity — in about three minutes.";
const SITE = "https://triage.datajungle.io";

export const metadata: Metadata = {
  // Resolves relative asset URLs below into absolute ones. Crawlers reject a
  // relative og:image, so without this the card silently never appears.
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Data Jungle",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Field Triage — find the Salesforce fields you can delete today",
      },
    ],
  },
  twitter: {
    // The large card is the difference between a thumbnail beside the text and
    // a full-width image above it; on a visual card like this one, that is the
    // whole point of having it.
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  // Matches datajungle.io. src/app/icon.svg is picked up automatically by the
  // App Router; these are declared as well so the apple-touch icon and any
  // crawler that ignores the convention still resolve.
  icons: {
    icon: [{ url: "/dj-logomark.svg", type: "image/svg+xml" }],
    apple: "/dj-logomark.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          No <link> to fonts.googleapis.com. The faces are self-hosted from
          /public/fonts and declared in src/app/fonts.css — see
          scripts/vendor-fonts.py, which fetches the same optimised woff2 files
          Google serves.

          Loading them from Google sent every visitor's IP to a third party
          before they had consented to anything, on a page whose entire pitch is
          that it takes nothing it doesn't need. This page now makes no
          third-party requests at all.

          Mozilla Text is the dashboard face, Inter is the landing page (to
          match datajungle.io), and JetBrains Mono covers API names, which need
          a real monospace — the system fallback reads inconsistently across
          platforms.
        */}
      </head>
      <body>{children}</body>
    </html>
  );
}
