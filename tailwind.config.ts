import type { Config } from "tailwindcss";

// Brand tokens copied from datajungle.io/tailwind.config.ts so the lead magnet reads as
// native Data Jungle. The `canopy` block below is additive: those are the hard-coded
// hexes the real Field Triage dashboard uses in its page <style> blocks
// (canopy-data-jungle/evidence/pages/metadata/field-triage.md). They differ slightly from
// the marketing palette — the dashboard is the reference here, since this page is a clone
// of it, so `canopy.lime` (#B5D333) is what the report uses, not brand `green.500`.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        headline: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        background: "#FFFFFF",
        "background-alt": "#FAFAFA",
        foreground: "#212121",
        grey: {
          50: "#FAFAFA",
          100: "#F5F5F5",
          200: "#EEEEEE",
          300: "#E0E0E0",
          400: "#BDBDBD",
          500: "#9E9E9E",
          600: "#757575",
          700: "#616161",
          800: "#424242",
          900: "#212121",
        },
        green: { 100: "#E9F5CC", 500: "#9DD31A", 700: "#6D9312" },
        blue: { 100: "#D7F2FA", 500: "#4DC4E9", 700: "#3589A3" },
        red: { 100: "#FEDAD5", 500: "#FD5944", 700: "#B13E2F" },
        yellow: { 100: "#FFF0C7", 500: "#FFBC03", 700: "#B28302" },
        purple: { 100: "#EDE1F6", 500: "#6E2AA6", 700: "#4E1D75" },
        brown: { 100: "#F1E4D9", 500: "#7E3701", 700: "#552501" },
        forest: { DEFAULT: "#00381F", light: "#0A4A2C" },

        // Canopy dashboard palette — semantic roles from the real Field Triage page.
        canopy: {
          lime: "#B5D333", // primary accent, "healthy", "ready · 0 deps"
          jungle: "#0A4D3A", // deleted / confirmed-good values
          deep: "#0A2A1F", // CTA text on lime
          coral: "#F07070", // dead / delete-ready
          amber: "#F5B731", // low / stale
          sky: "#89CFF0", // partial
          violet: "#7B4FA0", // dependencies, managed package
        },
      },
      maxWidth: { container: "1184px" },
      borderRadius: { sm: "4px", md: "12px", lg: "24px", full: "9999px" },
      boxShadow: {
        light: "0px 4px 20.1px 0px rgba(0,0,0,0.05)",
        card: "0px 14px 40px 0px rgba(33,33,33,0.06)",
        elevated: "0px 28px 80px 0px rgba(33,33,33,0.10)",
      },
      fontSize: {
        display: ["72px", { lineHeight: "1.05", letterSpacing: "-2px", fontWeight: "600" }],
        headline: ["56px", { lineHeight: "1.05", letterSpacing: "-2px", fontWeight: "600" }],
        h1: ["40px", { lineHeight: "1.1", letterSpacing: "-1px", fontWeight: "600" }],
        h2: ["32px", { lineHeight: "1.1", letterSpacing: "-0.8px", fontWeight: "600" }],
        h3: ["24px", { lineHeight: "1.2", fontWeight: "600" }],
        body: ["18px", { lineHeight: "1.5", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
};
export default config;
