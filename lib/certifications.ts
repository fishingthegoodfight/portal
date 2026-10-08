import { todayInZone } from "@/lib/format-date";

/**
 * Volunteer certifications (volunteer_certifications, files in the private
 * volunteer-certifications bucket). One kind for now, First Aid/CPR/AED; a
 * role type with requires_cert needs a current one. An upload counts as
 * soon as it's made; an admin can open the file and mark it verified
 * (verified_by/verified_at), which is shown but doesn't gate anything.
 * Plain functions, safe in client components.
 */

/** Dates are judged in Denver, like the rest of the volunteer side. */
export const CERT_ZONE = "America/Denver";

/** How far ahead an expiry counts as "expiring soon". */
export const CERT_EXPIRING_DAYS = 60;

/** Largest upload accepted (also set on the bucket). */
export const CERT_MAX_BYTES = 10 * 1024 * 1024;

/** What the file input offers (the bucket allows the same types). */
export const CERT_ACCEPT = "image/*,application/pdf";

export type CertState = "current" | "expiring" | "expired";

/** Today in CERT_ZONE, "YYYY-MM-DD". */
export function certToday(): string {
  return todayInZone(CERT_ZONE);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A cert is good through its expiry date; no expiry date never expires. */
export function certState(expiresOn: string | null, today: string = certToday()): CertState {
  if (!expiresOn) return "current";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, CERT_EXPIRING_DAYS)) return "expiring";
  return "current";
}

/** The one that counts: the latest expiry (no expiry beats any date). */
export function latestCert<T extends { expires_on: string | null }>(certs: T[]): T | null {
  let best: T | null = null;
  for (const cert of certs) {
    if (!best) best = cert;
    else if (best.expires_on && (!cert.expires_on || cert.expires_on > best.expires_on)) best = cert;
  }
  return best;
}

/** "Oct 8, 2026" from "2026-10-08". */
export function formatCertDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
