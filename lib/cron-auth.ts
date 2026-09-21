import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared gate for /api/cron/* routes: `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends it automatically; the pg_cron job reads it from Vault).
 * Rejects everything when CRON_SECRET is unset. Skipped under `next dev` so
 * the routes can be hit from a browser while testing.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
