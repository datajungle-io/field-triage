import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Triage — Data Jungle",
  description:
    "Free Salesforce field audit. Connect your org and see which custom fields are dead, which are safe to delete, and which have zero dependencies blocking removal.",
  robots: { index: true, follow: true },
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
