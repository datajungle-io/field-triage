import type { Config } from "@netlify/functions";

/**
 * Resumes abandoned scans, once a minute.
 *
 * The browser normally drives ticks; this only matters when someone closes the
 * tab mid-scan. Their report then still finishes and still gets emailed.
 *
 * Netlify Scheduled Functions can't be expressed as a Next route handler, so
 * this thin wrapper calls the app's own /api/cron/tick endpoint. It deliberately
 * does no work itself — keeping the logic in the Next route means the same
 * endpoint serves Vercel Cron, this, or a manual curl.
 */
export default async function resumeScans() {
  const base = process.env.APP_URL ?? process.env.URL;
  if (!base) {
    console.error("resume-scans: neither APP_URL nor URL is set");
    return new Response("misconfigured", { status: 500 });
  }

  const secret = process.env.CRON_SECRET;
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/cron/tick`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

  const body = await res.text();
  console.log(`resume-scans: ${res.status} ${body.slice(0, 200)}`);
  return new Response(body, { status: res.status });
}

export const config: Config = {
  schedule: "* * * * *",
};
