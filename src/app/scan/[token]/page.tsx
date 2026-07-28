import { notFound, redirect } from "next/navigation";
import { ScanProgressView } from "@/components/ScanProgressView";
import { scanByToken } from "@/lib/scan/access";
import { loadProgress } from "@/lib/scan/progress";

export const dynamic = "force-dynamic";

export default async function ScanPage({ params }: { params: { token: string } }) {
  const scan = await scanByToken(params.token);
  if (!scan) notFound();

  if (scan.status === "failed") {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1.5rem" }}>
        <h1 className="hero-title">The scan couldn&apos;t finish</h1>
        <p className="hero-sub">{scan.error ?? "An unexpected error stopped the scan."}</p>
        <a className="hero-cta" href="/">
          Try again
        </a>
      </div>
    );
  }

  const progress = await loadProgress(scan.id);
  // Past first paint already (a resumed or reloaded scan) — no reason to make
  // them watch a progress bar for a report that exists.
  if (progress.reportReady) redirect(`/r/${scan.token}`);

  return <ScanProgressView token={scan.token} initialProgress={progress} />;
}
