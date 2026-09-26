import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { formatDateInZone, formatEventInstant } from "@/lib/format-date";
import {
  APPLICATION_STATUS_LABELS,
  applicationChapterLabel,
  interestAreaNames,
  type ApplicationRecord,
} from "@/lib/volunteer-applications";
import { SCREENABLE_STATUSES, type ScreeningRecord } from "@/lib/volunteer-screenings";
import { ApplicationActions, AttendanceCreditEditor } from "@/components/admin/application-actions";
import { ApplicationAnswers } from "@/components/application-answers";
import { ScreeningView } from "@/components/admin/screening-view";
import { PracticalChecksPanel } from "@/components/admin/practical-checks-panel";
import { loadPracticalChecks } from "@/lib/admin/practical-checks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ZONE = "America/Denver";

const ACTION_LABELS: Record<string, string> = {
  submitted: "Applied",
  attendance_reached: "Reached the events-attended target",
  invited_to_schedule: "Invited to schedule a call",
  asked_to_attend_more: "Asked to attend a few events first",
  screening_recorded: "Screening call recorded",
  screened: "Screened",
  declined: "Declined",
  reapplication_allowed: "Allowed to apply again",
  withdrawn: "Withdrawn",
};

async function ApplicationLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId)) notFound();

  const supabase = await createClient();
  // RLS: only an admin or a chapter lead for one of its chapters gets it.
  const { data: row } = await supabase.from("volunteer_applications").select("*").eq("id", applicationId).maybeSingle();
  if (!row) notFound();
  const app = row as ApplicationRecord;

  const legacyRoleIds = app.legacy_role_type_ids ?? [];
  const [
    access,
    { data: history },
    { data: attendanceRows },
    { data: attendedEvents },
    { data: credit },
    { data: settings },
    { data: allRoleTypes },
    { data: interestAreas },
    { data: canScreen },
    { data: canRecordCheck },
    practical,
  ] = await Promise.all([
      loadEventAdminAccess(supabase),
      supabase
        .from("volunteer_application_events")
        .select("id, action, from_status, to_status, note, actor, emailed, created_at")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: true }),
      supabase.rpc("volunteer_application_attendance", { p_application_ids: [applicationId] }),
      supabase.rpc("volunteer_application_attended_events", { p_application_id: applicationId }),
      supabase.from("attendance_credits").select("events, note, set_by, set_at").eq("user_id", app.user_id).maybeSingle(),
      supabase.from("app_settings").select("min_events_before_screening, screening_scheduling_url").maybeSingle(),
      // Every role type, for the earlier form's picks and screenings'
      // recommended roles (inactive ones included).
      supabase.from("volunteer_role_types").select("id, name"),
      // Inactive areas too — an application keeps what it picked.
      supabase.from("volunteer_interest_areas").select("id, label, description, sort_order").order("sort_order"),
      // The screening flag AND able to see this application. Nobody else
      // learns anything about screenings, including that one exists.
      supabase.rpc("can_record_screening", { p_application_id: applicationId }),
      supabase.rpc("can_record_practical_check", { p_user_id: app.user_id }),
      loadPracticalChecks(supabase, app.user_id),
    ]);

  const [{ data: screeningRows }, { data: declineRecommended }] = canScreen
    ? await Promise.all([
        supabase
          .from("volunteer_screenings")
          .select("*")
          .eq("application_id", applicationId)
          .order("call_date", { ascending: false })
          .order("recorded_at", { ascending: false }),
        supabase.rpc("application_decline_recommended", { p_application_id: applicationId }),
      ])
    : [{ data: [] }, { data: false }];
  const screenings = (screeningRows ?? []) as ScreeningRecord[];

  const isAdmin = access?.isAdmin ?? false;
  const attended = ((attendanceRows ?? []) as { attended: number }[])[0]?.attended ?? 0;
  const minimum = (settings?.min_events_before_screening as number | undefined) ?? 2;
  const target = app.attendance_target ?? minimum;
  const events = ((attendedEvents ?? []) as { event_id: number; name: string; chapter: string | null; starts_at: string; timezone: string }[])
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  // Names for everyone in the history, the credit's setter, and the
  // screenings' recorders/editors.
  const actorIds = [
    ...new Set(
      [
        ...((history ?? []) as { actor: string | null }[]).map((h) => h.actor),
        credit?.set_by as string | null,
        ...screenings.flatMap((s) => [s.recorded_by, s.updated_by]),
        access?.userId ?? null,
      ].filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: actors } =
    actorIds.length > 0
      ? await supabase.from("profiles").select("id, first_name, last_name, email").in("id", actorIds)
      : { data: [] };
  const nameOf = (userId: string | null) => {
    if (!userId) return "Automatic";
    const p = (actors ?? []).find((a) => a.id === userId);
    return p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || (p.email as string) : "A reviewer";
  };
  const roleNameById = new Map(((allRoleTypes ?? []) as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const roleNamesFor = (ids: number[]) => ids.map((id) => roleNameById.get(id)).filter((n): n is string => Boolean(n));
  const legacyRoleNames = roleNamesFor(legacyRoleIds);
  const interestNames = interestAreaNames(
    (interestAreas ?? []) as { id: number; label: string; description: string | null }[],
    app.interest_area_ids,
    app.interest_other ?? null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{app.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            Applied {formatDateInZone(app.submitted_at, ZONE)} · {app.chapters.map(applicationChapterLabel).join(", ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{APPLICATION_STATUS_LABELS[app.status]}</Badge>
          {app.status === "declined" && app.reapplication_allowed && (
            <Badge variant="outline">May apply again</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next step</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationActions
            applicationId={app.id}
            status={app.status}
            attended={attended}
            target={target}
            isAdmin={isAdmin}
            reapplicationAllowed={app.reapplication_allowed}
            declineRecommended={declineRecommended === true}
            hasSchedulingUrl={Boolean((settings?.screening_scheduling_url as string | null)?.trim())}
          />
          {["approved", "withdrawn"].includes(app.status) && (
            <p className="text-sm text-muted-foreground">This application is closed.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            <span className="font-semibold">{attended}</span> events attended (target {target}
            {app.attendance_target != null ? ", raised when we asked them to attend more" : ", the Setup minimum"}
            ). {app.attendance_at_submission} when they applied.
          </p>
          {events.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {events.map((e) => (
                <li key={e.event_id}>
                  {e.name}
                  {e.chapter ? ` (${e.chapter})` : ""} · {formatDateInZone(e.starts_at, e.timezone)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No check-ins recorded in the portal.</p>
          )}
          {credit ? (
            <p>
              <span className="font-medium">+{credit.events as number} from before the portal:</span> “{credit.note as string}” —{" "}
              {nameOf(credit.set_by as string | null)}, {formatDateInZone(credit.set_at as string, ZONE)}
            </p>
          ) : null}
          {isAdmin && (
            <AttendanceCreditEditor
              userId={app.user_id}
              events={(credit?.events as number | undefined) ?? 0}
              note={(credit?.note as string | undefined) ?? ""}
            />
          )}
        </CardContent>
      </Card>

      {canScreen && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Screening calls</CardTitle>
              {SCREENABLE_STATUSES.includes(app.status) && (
                <Button asChild size="sm">
                  <Link href={`/protected/admin/applications/${app.id}/screenings/new`}>Record screening call</Link>
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only people with volunteer-screening access see this. The applicant never does.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {screenings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {SCREENABLE_STATUSES.includes(app.status)
                  ? "No screening call recorded yet."
                  : "Screening calls can be recorded once they've been invited to schedule one."}
              </p>
            ) : (
              screenings.map((s) => (
                <ScreeningView
                  key={s.id}
                  record={s}
                  recordedByName={nameOf(s.recorded_by)}
                  roleNames={roleNamesFor(s.recommended_role_type_ids ?? [])}
                  updatedByName={nameOf(s.updated_by)}
                  formatWhen={(iso) => formatEventInstant(iso, ZONE)}
                  editHref={
                    isAdmin || s.recorded_by === access?.userId
                      ? `/protected/admin/applications/${app.id}/screenings/${s.id}/edit`
                      : null
                  }
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {canRecordCheck && (
        <Card>
          <CardHeader>
            <CardTitle>Practical instruction check</CardTitle>
            <p className="text-xs text-muted-foreground">
              Forty-five minutes on the water, teaching an experienced instructor as though they were a
              beginner. Needed before a Fishing Instructor works a retreat.
            </p>
          </CardHeader>
          <CardContent>
            <PracticalChecksPanel
              userId={app.user_id}
              checks={practical.checks}
              recorderNames={practical.recorderNames}
              canRecord
              defaultAssessor={access?.userId ? nameOf(access.userId) : ""}
            />
          </CardContent>
        </Card>
      )}

      <ApplicationAnswers
        app={app}
        interestAreaNames={interestNames}
        reviewer={{ ref1Matched: app.ref1_matched_volunteer, legacyRoleNames }}
      />

      <Section title="History">
        <ul className="flex flex-col gap-1">
          {((history ?? []) as {
            id: number;
            action: string;
            to_status: string | null;
            note: string | null;
            actor: string | null;
            emailed: boolean;
            created_at: string;
          }[]).map((h) => (
            <li key={h.id}>
              <span className="text-muted-foreground">{formatEventInstant(h.created_at, ZONE)}</span> ·{" "}
              {ACTION_LABELS[h.action] ?? h.action}
              {h.emailed ? " (emailed)" : ""} · {nameOf(h.actor)}
              {h.note && <span className="block pl-4 text-muted-foreground">{h.note}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

export default function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-3xl">
      <Link href="/protected/admin/applications" className="text-sm underline underline-offset-4">
        ← All applications
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ApplicationLoader params={params} />
      </Suspense>
    </div>
  );
}
