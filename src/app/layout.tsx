import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Triage — Data Jungle",
  description:
    "Free Salesforce field audit. Connect your org and see which custom fields are dead, which are safe to delete, and which have zero dependencies blocking removal.",
  robots: { index: true, follow: true },
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
        <link
          href="https://fonts.googleapis.com/css2?family=Mozilla+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
