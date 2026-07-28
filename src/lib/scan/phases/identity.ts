import type { PhaseContext, PhaseResult } from "@/lib/scan/types";

/**
 * Phase 1 — who connected, and from where.
 *
 * This is also the lead capture. Salesforce's identity endpoint returns a
 * verified name, email and org, so there is no form anywhere in the product —
 * the connect action itself is the conversion, and the resulting contact detail
 * is stronger than anything a typed field would produce.
 */

interface OrganizationRow {
  Id: string;
  Name: string | null;
  OrganizationType: string | null;
  InstanceName: string | null;
  IsSandbox: boolean | null;
}

export async function runIdentity(ctx: PhaseContext): Promise<PhaseResult> {
  const info = await ctx.sf.userInfo();

  // Org name and edition need a SOQL hop; the identity payload carries neither,
  // and "Acme Corp · Enterprise Edition" is what makes the lead alert readable.
  let org: OrganizationRow | undefined;
  try {
    const rows = await ctx.sf.query<OrganizationRow>(
      "SELECT Id, Name, OrganizationType, InstanceName, IsSandbox FROM Organization LIMIT 1",
    );
    org = rows[0];
  } catch (err) {
    ctx.log(`Organization query failed — continuing without org detail: ${String(err).slice(0, 120)}`);
  }

  const { error: scanError } = await ctx.db
    .from("scans")
    .update({
      org_id: info.organization_id,
      org_name: org?.Name ?? null,
      org_type: org?.OrganizationType ?? null,
      is_sandbox: org?.IsSandbox ?? false,
    })
    .eq("id", ctx.scanId);
  if (scanError) throw new Error(`scans update failed: ${scanError.message}`);

  const { error: leadError } = await ctx.db.from("leads").upsert(
    {
      scan_id: ctx.scanId,
      name: info.name ?? null,
      email: info.email ?? null,
      username: info.preferred_username ?? null,
      user_id: info.user_id,
      org_id: info.organization_id,
      org_name: org?.Name ?? null,
      org_type: org?.OrganizationType ?? null,
      is_sandbox: org?.IsSandbox ?? false,
    },
    { onConflict: "scan_id" },
  );
  if (leadError) throw new Error(`leads upsert failed: ${leadError.message}`);

  ctx.log(`Connected: ${info.email ?? info.user_id} @ ${org?.Name ?? info.organization_id}`);
  return { done: true, total: 1, scanned: 1, failed: 0 };
}
