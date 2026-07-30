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
          Mozilla Text is the Data Jungle dashboard face — loaded from Google
          Fonts exactly as the Evidence app does in pages/+layout.svelte, rather
          than via next/font, so the two apps resolve the same webfont files.
          JetBrains Mono covers API names, which need a real monospace: the
          dashboard falls back to the system mono there and it reads
          inconsistently across platforms.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Inter is loaded for the landing page only, to match datajungle.io.
          Once you're inside a report the app switches to Mozilla Text — the
          face the real dashboards use — so the shift from marketing site to
          product is something you feel rather than read.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Mozilla+Text:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
