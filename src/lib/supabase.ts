import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Secret-key Supabase client.
 *
 * Every table has RLS enabled with no anon policies, so this is the only way in.
 * It must never be constructed in a Client Component — the service key bypasses
 * RLS entirely. Report pages read through it server-side after verifying the
 * request's scan token.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Next patches global fetch and caches GET responses in its Data Cache.
      // PostgREST reads (.select()) are GETs, so without this the census is
      // frozen at whatever the first render saw — the detail page would show
      // stale rows for the entire scan while dependency counts land behind it,
      // and edits to the underlying data would silently not appear.
      // RPC calls are POSTs and were never cached, which is why the KPI tiles
      // looked fine and masked this.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
