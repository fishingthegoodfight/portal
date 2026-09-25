import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { formatDateInZone, formatEventInstant } from "@/lib/format-date";
import {
  APPLICATION_STATUS_LABELS,
  availabilityLabel,
  BEGINNER_COMFORT_LABELS,
  type ApplicationRecord,
} from "@/lib/volunteer-applications";
import { ApplicationActions, AttendanceCreditEditor } from "@/components/admin/application-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ZONE = "America/Denver";

const ACTION_LABELS: Record<string, string> = {
  submitted: "Applied",
  attendance_reached: "Reached the events-attended target",
  invited_to_schedule: "Invited to schedule a call",
  asked_to_attend_more: "Asked to attend a few events first",
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

  const [access, { data: history }, { data: attendanceRows }, { data: attendedEvents }, { data: credit }, { data: settings }, { data: roleTypes }] =
    await Promise.all([
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
      app.role_type_ids.length > 0
        ? supabase.from("volunteer_role_types").select("id, name").in("id", app.role_type_ids)
        : Promise.resolve({ data: [] }),
    ]);

  const isAdmin = access?.isAdmin ?? false;
  const attended = ((attendanceRows ?? []) as { attended: number }[])[0]?.attended ?? 0;
  const minimum = (settings?.min_events_before_screening as number | undefined) ?? 2;
  const target = app.attendance_target ?? minimum;
  const events = ((attendedEvents ?? []) as { event_id: number; name: string; chapter: string | null; starts_at: string; timezone: string }[])
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  // Names for everyone in the history and the credit's setter.
  const actorIds = [
    ...new Set(
      [...((history ?? []) as { actor: string | null }[]).map((h) => h.actor), credit?.set_by as string | null]
        .filter((v): v is string => Boolean(v)),
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
  const roleNames = ((roleTypes ?? []) as { id: number; name: string }[]).map((r) => r.name);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{app.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            Applied {formatDateInZone(app.submitted_at, ZONE)} · {app.chapters.join(", ")}
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

      <Section title="Contact">
        <Row label="Email" value={app.email} />
        <Row label="Phone" value={app.phone} />
      </Section>

      <Section title="About them">
        <Row label="Chapters" value={app.chapters.join(", ")} />
        <Row label="How they got connected" value={app.how_connected} />
        <Row label="How long coming to events" value={app.how_long_attending} />
      </Section>

      <Section title="Why">
        <Row label="Why volunteer" value={app.why_volunteer} />
        <Row label="Hope to get out of it" value={app.hope_to_get} />
        <Row label="Mission and their story" value={app.mission_connection ?? "—"} />
      </Section>

      <Section title="Roles">
        <Row label="Interested in" value={roleNames.length > 0 ? roleNames.join(", ") : "None picked"} />
        <Row label="Retreats" value={app.interested_in_retreats ? "Yes" : "No"} />
      </Section>

      <Section title="Fly fishing">
        <Row label="Years fly fishing" value={app.years_fly_fishing} />
        <Row label="Water fished most" value={app.water_fished} />
        <Row label="Taught or guided" value={app.has_taught_or_guided ? `Yes — ${app.taught_details ?? ""}` : "No"} />
        <Row label="Teaching a beginner" value={BEGINNER_COMFORT_LABELS[app.beginner_comfort] ?? String(app.beginner_comfort)} />
      </Section>

      <Section title="Certifications (self-reported)">
        <Row
          label="First Aid/CPR"
          value={app.cert_first_aid_cpr ? `Yes, expires ${app.cert_first_aid_cpr_expires ?? "—"}` : "No"}
        />
        <Row label="WFA / WFR" value={app.cert_wfa_wfr ? "Yes" : "No"} />
        <Row label="FFI casting instructor" value={app.cert_ffi_casting ? "Yes" : "No"} />
        <Row label="Guide license" value={app.cert_guide_license ? "Yes" : "No"} />
        <Row label="Other" value={app.cert_other ?? "—"} />
      </Section>

      <Section title="Availability">
        <Row label="When" value={app.availability.map(availabilityLabel).join(", ")} />
        <Row label="How often" value={app.frequency} />
      </Section>

      <Section title="References">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">1. {app.ref1_name}</span>
            {app.ref1_matched_volunteer ? (
              <Badge variant="outline">Matches an approved volunteer</Badge>
            ) : (
              <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">
                Email doesn&apos;t match an approved volunteer — follow up
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground">
            {app.ref1_email} · {app.ref1_phone} · {app.ref1_chapter}
          </span>
          <span className="text-muted-foreground">How they know them: {app.ref1_how_know}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-medium">2. {app.ref2_name}</span>
          <span className="text-muted-foreground">
            {app.ref2_email} · {app.ref2_phone}
          </span>
          <span className="text-muted-foreground">
            {app.ref2_relationship}, known them {app.ref2_known_for}
          </span>
        </div>
      </Section>

      <Section title="Anything else">
        <p className="whitespace-pre-line">{app.anything_else ?? "—"}</p>
      </Section>

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-[12rem_1fr]">
      <span className="font-medium">{label}</span>
      <span className="whitespace-pre-line">{value}</span>
    </div>
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
