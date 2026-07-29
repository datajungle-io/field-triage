import { NextResponse } from "next/server";
import { scanByToken } from "@/lib/scan/access";
import { loadCensus } from "@/lib/report/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The takeaway artifact. A report that can be forwarded to a colleague or pasted
 * into a ticket travels much further than one that only lives at a URL.
 *
 * Column order matches the v0 consulting deliverable
 * (sf-field-audit/field_triage_lead.csv) so it lands in a familiar shape, with
 * the reference-scan columns that prototype lacked.
 */
export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
) {
  const scan = await scanByToken(params.token);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Every field, unfiltered. The detail page hides standard and unmeasurable
  // fields by default and tells the reader the CSV has everything — so it must,
  // or that promise is a lie in the artifact people actually act on.
  const rows = await loadCensus(scan.id, { includeNoData: true });

  const header = [
    "Object",
    "Field API Name",
    "Label",
    "Type",
    "Category",
    "Namespace Prefix",
    "% Populated",
    "# Populated",
    "Total Records",
    "Health",
    "Dependencies",
    "On Layout",
    "Last Modified Date",
    "Deletion Candidate",
    "Candidate 0 Deps",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.object_name,
        row.field_api_name,
        row.field_label ?? "",
        row.sf_type ?? "",
        row.namespace_category,
        row.namespace_prefix ?? "",
        row.population_pct ?? "",
        row.populated_count ?? "",
        row.total_records ?? "",
        row.bucket,
        // Empty, not 0: a field whose references were never scanned has an
        // unknown dependency count, and writing 0 into a spreadsheet someone
        // will act on would be a lie with consequences.
        row.dependency_count ?? "",
        row.on_layout ? "TRUE" : "FALSE",
        row.last_modified_date ? row.last_modified_date.slice(0, 10) : "",
        row.is_safe_to_delete ? "TRUE" : "FALSE",
        row.is_safe_to_delete && row.dependency_count === 0 ? "TRUE" : "FALSE",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const filename = `field-triage-${(scan.org_name ?? "salesforce")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.csv`;

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
