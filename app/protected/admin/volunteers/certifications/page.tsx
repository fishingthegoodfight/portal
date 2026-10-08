import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { CertificationActions } from "@/components/admin/certification-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chapterDisplayName, loadChapters } from "@/lib/chapters";
import {
  CERT_EXPIRING_DAYS,
  certState,
  certToday,
  formatCertDate,
  latestCert,
  type CertState,
} from "@/lib/certifications";

type CertRow = {
  id: number;
  volunteer_id: string;
  file_path: string | null;
  issued_on: string | null;
  expires_on: string | null;
  verified_at: string | null;
  verified_by: string | null;
};

type Row = {
  userId: string;
  name: string;
  chapter: string;
  /** The approved roles that need a current cert; empty if none do. */
  neededFor: string[];
  latest: CertRow | null;
  state: CertState | "missing";
  verifiedLabel: string | null;
};

const STATE_BADGE: Record<Row["state"], { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  missing: { label: "Missing", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  expiring: { label: "Expiring soon", variant: "outline" },
  current: { label: "Current", variant: "secondary" },
};

/**
 * Every approved volunteer who needs a First Aid/CPR/AED certification (a
 * role type with requires_cert) or has one on file, in three lists: who
 * needs attention (missing, expired, or expiring within CERT_EXPIRING_DAYS
 * where a role needs it), uploads nobody has verified yet, and everything on
 * file by expiry date. Admins only (the volunteers layout), and RLS only
 * shows certifications to admins.
 */
async function CertificationsLoader() {
  const supabase = await createClient();
  const today = certToday();

  const [{ data: volunteers, error }, chapters] = await Promise.all([
    supabase.from("volunteers").select("user_id").eq("status", "approved"),
    loadChapters(supabase),
  ]);
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load volunteers: {error.message}</p>;
  const ids = (volunteers ?? []).map((v) => v.user_id as string);
  if (ids.length === 0) return <p className="text-sm text-muted-foreground">No approved volunteers.</p>;

  const [{ data: profiles }, { data: approvals }, { data: certs, error: certError }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, email, chapter, access_removed_at").in("id", ids),
    supabase
      .from("volunteer_role_approvals")
      .select("volunteer_id, role_type:volunteer_role_types(name, requires_cert)")
      .in("volunteer_id", ids)
      .is("revoked_at", null),
    supabase
      .from("volunteer_certifications")
      .select("id, volunteer_id, file_path, issued_on, expires_on, verified_at, verified_by")
      .in("volunteer_id", ids)
      .eq("kind", "first_aid_cpr_aed"),
  ]);
  if (certError) return <p className="text-sm text-red-500">Couldn&apos;t load certifications: {certError.message}</p>;

  const certsByVolunteer = new Map<string, CertRow[]>();
  for (const cert of (certs ?? []) as CertRow[]) {
    certsByVolunteer.set(cert.volunteer_id, [...(certsByVolunteer.get(cert.volunteer_id) ?? []), cert]);
  }
  const neededBy = new Map<string, string[]>();
  for (const a of (approvals ?? []) as unknown as {
    volunteer_id: string;
    role_type: { name: string; requires_cert: boolean } | null;
  }[]) {
    if (a.role_type?.requires_cert) {
      neededBy.set(a.volunteer_id, [...(neededBy.get(a.volunteer_id) ?? []), a.role_type.name]);
    }
  }

  const verifierIds = [
    ...new Set(((certs ?? []) as CertRow[]).map((c) => c.verified_by).filter((id): id is string => Boolean(id))),
  ];
  const { data: verifiers } = verifierIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", verifierIds)
    : { data: [] };
  const verifierName = new Map(
    ((verifiers ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).map((p) => [
      p.id,
      [p.first_name, p.last_name].filter(Boolean).join(" ") || "an admin",
    ]),
  );

  const rows: Row[] = [];
  for (const p of (profiles ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    chapter: string | null;
    access_removed_at: string | null;
  }[]) {
    if (p.access_removed_at) continue;
    const neededFor = neededBy.get(p.id) ?? [];
    const latest = latestCert(certsByVolunteer.get(p.id) ?? []);
    if (neededFor.length === 0 && !latest) continue;
    rows.push({
      userId: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed",
      chapter: p.chapter ? chapterDisplayName(chapters, p.chapter) : "",
      neededFor,
      latest,
      state: latest ? certState(latest.expires_on, today) : "missing",
      verifiedLabel: latest?.verified_at
        ? `Verified ${formatCertDate(latest.verified_at.slice(0, 10))}${
            latest.verified_by ? ` by ${verifierName.get(latest.verified_by) ?? "an admin"}` : ""
          }`
        : null,
    });
  }

  const order: Record<Row["state"], number> = { missing: 0, expired: 1, expiring: 2, current: 3 };
  const byExpiry = (a: Row, b: Row) =>
    (a.latest?.expires_on ?? "9999-12-31").localeCompare(b.latest?.expires_on ?? "9999-12-31") ||
    a.name.localeCompare(b.name);

  const attention = rows
    .filter((r) => r.neededFor.length > 0 && r.state !== "current")
    .sort((a, b) => order[a.state] - order[b.state] || byExpiry(a, b));
  const unverified = rows.filter((r) => r.latest?.file_path && !r.latest.verified_at).sort(byExpiry);
  const onFile = rows.filter((r) => r.latest).sort(byExpiry);

  const count = (state: Row["state"]) => attention.filter((r) => r.state === state).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Missing" value={count("missing")} />
        <Tile label="Expired" value={count("expired")} />
        <Tile label={`Expiring in ${CERT_EXPIRING_DAYS} days`} value={count("expiring")} />
        <Tile label="Not verified" value={unverified.length} />
      </div>

      <Section
        title={`Needs attention (${attention.length})`}
        intro="Approved for a role that needs a current First Aid/CPR/AED certification, and it's missing, expired, or about to expire."
        empty="Everyone who needs one has a current certification."
        rows={attention}
      />
      <Section
        title={`Not verified yet (${unverified.length})`}
        intro="Uploads count as soon as they're made. Open the file, check it matches, and mark it verified."
        empty="Every uploaded certification has been verified."
        rows={unverified}
      />
      <Section
        title={`All certifications on file (${onFile.length})`}
        intro="Each volunteer's latest, soonest expiry first."
        empty="No certifications on file yet."
        rows={onFile}
      />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1 py-4">
        <span className="text-2xl font-bold">{value}</span>
        <span className="text-center text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function Section({ title, intro, empty, rows }: { title: string; intro: string; empty: string; rows: Row[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                key={row.userId}
                className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5 text-sm [overflow-wrap:anywhere]">
                  <Link href={`/protected/admin/volunteers/${row.userId}`} className="font-medium underline-offset-4 hover:underline">
                    {row.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {[row.chapter, row.neededFor.length > 0 ? `Needed for ${row.neededFor.join(", ")}` : "Not required for their roles"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATE_BADGE[row.state].variant}>{STATE_BADGE[row.state].label}</Badge>
                    {row.latest && (
                      <span className="text-muted-foreground">
                        {row.latest.expires_on
                          ? `${row.state === "expired" ? "Expired" : "Expires"} ${formatCertDate(row.latest.expires_on)}`
                          : "No expiry date"}
                        {row.latest.issued_on ? ` · issued ${formatCertDate(row.latest.issued_on)}` : ""}
                      </span>
                    )}
                  </span>
                </div>
                {row.latest && (
                  <CertificationActions
                    certId={row.latest.id}
                    hasFile={Boolean(row.latest.file_path)}
                    verifiedLabel={row.verifiedLabel}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function CertificationsPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-3xl">
      <div>
        <Link href="/protected/admin/volunteers" className="text-sm text-muted-foreground underline underline-offset-4">
          Volunteers
        </Link>
        <h1 className="mt-1 font-bold text-2xl mb-1">Certifications</h1>
        <p className="text-sm text-muted-foreground">
          First Aid/CPR/AED certifications: who needs one, what&apos;s expiring, and uploads waiting to be
          checked. A role needs one when &quot;Requires First Aid/CPR/AED&quot; is ticked on its role
          type (Role types). A certification is good through its expiry date.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <CertificationsLoader />
      </Suspense>
    </div>
  );
}
