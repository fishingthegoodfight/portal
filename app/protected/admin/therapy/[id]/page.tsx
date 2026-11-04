import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  loadBudget,
  loadPartnerUsage,
  loadRequestSessions,
  loadSupportRequest,
  loadTherapists,
  loadTherapySettings,
} from "@/lib/therapy-access";
import { formatDateInZone, todayInZone } from "@/lib/format-date";
import {
  CONTACT_LABELS,
  formatCents,
  formatMonth,
  INSURANCE_LABELS,
  PROGRAM_LABELS,
  STATUS_LABELS,
} from "@/lib/therapy-support";
import { TherapyReviewPanel } from "@/components/admin/therapy-review-panel";
import { TherapySessionsPanel } from "@/components/admin/therapy-sessions-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ZONE = "America/Denver";
const date = (iso: string) => formatDateInZone(iso, ZONE);

/** A label and value row; nothing when the value is empty. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

async function RequestLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  // Opening the request is logged ("view") by the database.
  const result = await loadSupportRequest(supabase, id);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load this request: {result.error}</p>;
  const q = result.data;
  if (!q) notFound();

  const today = todayInZone(ZONE);
  const deciding = q.status === "submitted" || q.status === "waitlisted";
  const [therapists, settings, usage, sessions, budget] = await Promise.all([
    q.program === "scholarship" ? loadTherapists(supabase) : Promise.resolve([]),
    loadTherapySettings(supabase),
    q.program === "partner" ? loadPartnerUsage(supabase) : Promise.resolve(null),
    q.approved_at ? loadRequestSessions(supabase, q.id) : Promise.resolve([]),
    // An approval counts against this year's budget.
    q.program === "scholarship" && deciding ? loadBudget(supabase, Number(today.slice(0, 4))) : Promise.resolve(null),
  ]);

  const name = q.person
    ? [q.person.first_name, q.person.last_name].filter(Boolean).join(" ") || q.person.email || "(no name)"
    : "(deleted person)";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/protected/admin/therapy" className="text-sm text-muted-foreground hover:underline">
          ← All requests
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{name}</h1>
          <Badge>{STATUS_LABELS[q.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {PROGRAM_LABELS[q.program]}
          {q.renewal_of ? " renewal" : ""} · sent {date(q.submitted_at)}
          {q.chapter && ` · ${q.chapter}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {q.user_id === null ? (
              <p className="text-muted-foreground">This person has been deleted; the request is kept as a count.</p>
            ) : q.checkins === 0 ? (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
                No check-ins yet. They can still be approved, with a reason.
              </p>
            ) : (
              <p>
                Checked in at {q.checkins} event{q.checkins === 1 ? "" : "s"}
                {q.last_checkin && `, most recently ${date(q.last_checkin)}`}. Eligible.
              </p>
            )}
            <dl className="flex flex-col gap-2">
              <Row label="Override reason" value={q.eligibility_override_reason} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Counts events checked in at as a participant or volunteer, plus attendance credited from before the portal.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Email" value={q.person?.email} />
              <Row label="Phone" value={q.person?.phone} />
              <Row label="Home chapter" value={q.person?.chapter ?? q.chapter} />
              {q.program === "partner" && (
                <>
                  <Row label="Contact by" value={q.contact_preference && CONTACT_LABELS[q.contact_preference]} />
                  <Row label="Availability" value={q.availability && <span className="whitespace-pre-line">{q.availability}</span>} />
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      {q.program === "scholarship" && (
        <Card>
          <CardHeader>
            <CardTitle>Their therapist, as they gave it</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Name" value={q.therapist_name} />
              <Row label="Practice" value={q.therapist_practice} />
              <Row label="Email" value={q.therapist_email} />
              <Row label="Phone" value={q.therapist_phone} />
              <Row
                label="License"
                value={[q.therapist_license_type, q.therapist_license_state].filter(Boolean).join(", ")}
              />
              <Row label="Insurance could help" value={q.has_insurance && INSURANCE_LABELS[q.has_insurance]} />
            </dl>
          </CardContent>
        </Card>
      )}

      {q.note && (
        <Card>
          <CardHeader>
            <CardTitle>Anything they&apos;d like us to know</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm">{q.note}</p>
          </CardContent>
        </Card>
      )}

      {q.approved_at && (
        <Card>
          <CardHeader>
            <CardTitle>Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Approved" value={`${date(q.approved_at)}${q.approved_by_name ? ` by ${q.approved_by_name}` : ""}`} />
              <Row label="Sessions" value={q.sessions_approved !== null && `${q.sessions_used} of ${q.sessions_approved} used`} />
              <Row
                label="Therapist"
                value={
                  q.therapist &&
                  [q.therapist.name, q.therapist.practice, q.therapist.email, q.therapist.phone].filter(Boolean).join(" · ")
                }
              />
              <Row
                label="Flat rate"
                value={q.rate_cents !== null && `${formatCents(q.rate_cents)} a session, agreed ${q.rate_agreed_at ? date(q.rate_agreed_at) : ""}`}
              />
              <Row label="Referred" value={q.referred_at && date(q.referred_at)} />
            </dl>
          </CardContent>
        </Card>
      )}

      {q.approved_at && q.sessions_approved !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <TherapySessionsPanel
              requestId={q.id}
              canAdd={q.status === "approved"}
              sessions={sessions}
              sessionsApproved={q.sessions_approved}
              today={today}
            />
          </CardContent>
        </Card>
      )}

      {q.status === "waitlisted" && q.waitlist_month && (
        <p className="text-sm">Waitlisted for {formatMonth(q.waitlist_month)}.</p>
      )}

      {(q.status === "submitted" || q.status === "waitlisted" || q.status === "approved") && q.user_id && (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent>
            <TherapyReviewPanel
              requestId={q.id}
              program={q.program}
              status={q.status}
              checkins={q.checkins}
              savedOverrideReason={q.eligibility_override_reason}
              therapists={therapists}
              therapistId={q.therapist_id}
              given={{
                name: q.therapist_name ?? "",
                practice: q.therapist_practice ?? "",
                email: q.therapist_email ?? "",
                phone: q.therapist_phone ?? "",
                licenseType: q.therapist_license_type ?? "",
                licenseState: q.therapist_license_state ?? "",
              }}
              rateCents={settings?.scholarship_rate_cents ?? null}
              usage={usage}
              budget={budget}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Their other requests</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {q.history.length === 0 ? (
            <p className="text-muted-foreground">None. This is their first.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {q.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/protected/admin/therapy/${h.id}`} className="hover:underline">
                    {PROGRAM_LABELS[h.program]}
                    {h.renewal_of ? " renewal" : ""} · sent {date(h.submitted_at)}
                    {h.therapist_name && ` · ${h.therapist_name}`}
                    {h.id === q.renewal_of && <span className="text-muted-foreground"> (this renews it)</span>}
                  </Link>
                  <span className="flex items-center gap-2">
                    {h.sessions_approved !== null && (
                      <span className="tabular-nums text-muted-foreground">
                        {h.sessions_used}/{h.sessions_approved} sessions
                      </span>
                    )}
                    <Badge variant="secondary">{STATUS_LABELS[h.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TherapyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RequestLoader params={params} />
      </Suspense>
    </div>
  );
}
