import { serviceClient } from "@/lib/supabase";

/**
 * Scans are addressed by their unguessable token everywhere a browser can see
 * them — never by the uuid primary key. One secret, and it's the one printed in
 * the URL the user was given.
 */
export interface ScanRecord {
  id: string;
  token: string;
  status: string;
  org_name: string | null;
  org_type: string | null;
  is_sandbox: boolean;
  /**
   * The connected org's own domain. Setup deep links must be built against it —
   * the production dashboard can hardcode one org's URL, a multi-tenant tool
   * cannot.
   */
  instance_url: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
}

export async function scanByToken(token: string): Promise<ScanRecord | null> {
  if (!token || token.length < 20) return null;

  const { data, error } = await serviceClient()
    .from("scans")
    .select(
      "id, token, status, org_name, org_type, is_sandbox, instance_url, error, created_at, completed_at, expires_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as ScanRecord;
}
