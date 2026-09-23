import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client that is ALWAYS the anonymous role — no cookies, no
 * session — whoever is viewing. The public event page reads through this so
 * what it can see is exactly what the database lets anon see (published
 * events, a fixed column list without the meeting link — see the
 * 2026-09-23 "Public event pages" schema-changes.sql entry), even when a
 * signed-in admin opens it.
 */
export function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
