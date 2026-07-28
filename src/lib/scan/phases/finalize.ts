import { loginHostFor } from "@/lib/salesforce/oauth";
import { notifyNewScan } from "@/lib/notify";
import type { PhaseContext, PhaseResult } from "@/lib/scan/types";

/**
 * Phase 9 — headline numbers, token revocation, lead alert.
 *
 * Revocation is the part that matters. The connect screen promises the grant
 * stops working when the scan finishes, and this is where that promise is kept:
 * the token is revoked upstream at Salesforce and the ciphertext is cleared from
 * the row, so neither we nor anyone reading the database can act as that user.
 */
export async function runFinalize(ctx: PhaseContext): Promise<PhaseResult> {
  const summary = await summarise(ctx);

  const { error: leadError } = await ctx.db
    .from("leads")
    .update({
      fields_scanned: summary.fieldsScanned,
      objects_scanned: summary.objectsScanned,
      delete_ready: summary.deleteReady,
      ready_no_deps: summary.readyNoDeps,
    })
    .eq("scan_id", ctx.scanId);
  if (leadError) ctx.log(`Lead summary update failed: ${leadError.message}`);

  const { data: scan } = await ctx.db
    .from("scans")
    .select("token, org_name, is_sandbox, is_cli_session")
    .eq("id", ctx.scanId)
    .single();

  // Never revoke a CLI session — that token belongs to the developer's `sf`
  // login, and revoking it would log them out of the org as a side effect of
  // running a test. Real OAuth scans always revoke.
  const revoked = scan?.is_cli_session
    ? false
    : await ctx.sf.revoke(loginHostFor(scan?.is_sandbox ?? false));

  const { error: scanError } = await ctx.db
    .from("scans")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      // Cleared whether or not revocation succeeded: if Salesforce refused the
      // revoke we still have no business holding the ciphertext, and the token
      // expires on the org's own session timeout regardless.
      sf_access_token_encrypted: null,
      token_revoked_at: revoked ? new Date().toISOString() : null,
    })
    .eq("id", ctx.scanId);
  if (scanError) throw new Error(`scans finalize failed: ${scanError.message}`);

  ctx.log(
    `Complete: ${summary.fieldsScanned} fields, ${summary.deleteReady} delete-ready, ` +
      `${summary.readyNoDeps} with zero dependencies. ` +
      (scan?.is_cli_session
        ? "CLI session left intact."
        : `Token ${revoked ? "revoked" : "cleared (revoke failed)"}.`),
  );

  // Best-effort: a failed notification must not fail a finished scan.
  await notifyNewScan(ctx.scanId).catch((err) =>
    ctx.log(`Lead notification failed: ${String(err).slice(0, 160)}`),
  );

  return { done: true, total: 1, scanned: 1, failed: 0 };
}

interface Summary {
  fieldsScanned: number;
  objectsScanned: number;
  deleteReady: number;
  readyNoDeps: number;
}

async function summarise(ctx: PhaseContext): Promise<Summary> {
  const { data, error } = await ctx.db.rpc("scan_summary", { p_scan_id: ctx.scanId });
  if (error) throw new Error(`scan_summary failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    fieldsScanned: Number(row.fields_scanned ?? 0),
    objectsScanned: Number(row.objects_scanned ?? 0),
    deleteReady: Number(row.delete_ready ?? 0),
    readyNoDeps: Number(row.ready_no_deps ?? 0),
  };
}
