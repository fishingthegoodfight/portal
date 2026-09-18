import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely and can create auth
 * users. Server-only: SUPABASE_SERVICE_ROLE_KEY must never be exposed to the
 * client (it has no NEXT_PUBLIC_ prefix, so Next.js already won't bundle it,
 * but don't import this file from a "use client" component regardless).
 *
 * Only call this from trusted, admin-gated server code — see
 * lib/actions/admin-walkup.ts for the one place that needs it today (to
 * create the backing auth user for a walk-up who has no account yet).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
