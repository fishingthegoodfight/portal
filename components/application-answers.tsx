import {
  availabilityLabel,
  BEGINNER_COMFORT_LABELS,
  RETREAT_COMMITMENTS,
  RETREAT_QUESTION,
  type ApplicationRecord,
} from "@/lib/volunteer-applications";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** What the applicant submitted — the fields both the applicant's own view
 * and the review screen show. */
export type ApplicationAnswersData = Omit<
  ApplicationRecord,
  | "user_id"
  | "status_changed_at"
  | "attendance_at_submission"
  | "attendance_target"
  | "ready_since"
  | "reapplication_allowed"
  | "ref1_matched_volunteer"
  | "legacy_role_type_ids"
>;

/**
 * An application's answers, read-only. Used by the applicant's own view and
 * the review screen. The reviewer-only extras (reference 1's match against
 * approved volunteers, roles picked on the phase 1 form) are passed in only
 * by the review screen — the applicant's page never has them to pass.
 */
export function ApplicationAnswers({
  app,
  interestAreaNames,
  reviewer,
}: {
  app: ApplicationAnswersData;
  interestAreaNames: string[];
  reviewer?: { ref1Matched: boolean; legacyRoleNames: string[] };
}) {
  return (
    <>
      <Section title="Contact">
        <Row label="Name" value={app.full_name} />
        <Row label="Email" value={app.email} />
        <Row label="Phone" value={app.phone} />
      </Section>

      <Section title="About you">
        <Row label="Chapters" value={app.chapters.join(", ")} />
        <Row label="How you got connected" value={app.how_connected} />
        <Row label="How long coming to events" value={app.how_long_attending} />
      </Section>

      <Section title="Why">
        <Row label="Why volunteer" value={app.why_volunteer} />
        <Row label="Hope to get out of it" value={app.hope_to_get} />
        <Row label="Mission and your story" value={app.mission_connection ?? "—"} />
      </Section>

      <Section title="What you'd like to help with">
        <Row label="Interested in" value={interestAreaNames.length > 0 ? interestAreaNames.join("\n") : "None picked"} />
        <Row label={RETREAT_QUESTION} value={app.interested_in_retreats ? "Yes" : "No"} />
        {app.interested_in_retreats && (
          <Row
            label="Retreat commitments"
            value={
              app.ack_retreat_commitment == null
                ? "Not asked (applied before these were added)"
                : RETREAT_COMMITMENTS.map((c) => `${app[c.column] ? "✓" : "✗"} ${c.label}`).join("\n")
            }
          />
        )}
        {reviewer && reviewer.legacyRoleNames.length > 0 && (
          <Row label="Roles picked on the earlier form" value={reviewer.legacyRoleNames.join(", ")} />
        )}
      </Section>

      <Section title="Fly fishing">
        <Row label="Years fly fishing" value={app.years_fly_fishing} />
        <Row label="How often you fish now" value={app.fishing_frequency ?? "Not asked (applied before this was added)"} />
        <Row label="Water fished most" value={app.water_fished} />
        <Row label="Taught or guided" value={app.has_taught_or_guided ? `Yes — ${app.taught_details ?? ""}` : "No"} />
        <Row label="Teaching a beginner" value={BEGINNER_COMFORT_LABELS[app.beginner_comfort] ?? String(app.beginner_comfort)} />
      </Section>

      <Section title="Certifications">
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
            {reviewer &&
              (reviewer.ref1Matched ? (
                <Badge variant="outline">Matches an approved volunteer</Badge>
              ) : (
                <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">
                  Email doesn&apos;t match an approved volunteer — follow up
                </Badge>
              ))}
          </div>
          <span className="text-muted-foreground">
            {app.ref1_email} · {app.ref1_phone} · {app.ref1_chapter}
          </span>
          <span className="text-muted-foreground">How they know you: {app.ref1_how_know}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-medium">2. {app.ref2_name}</span>
          <span className="text-muted-foreground">
            {app.ref2_email} · {app.ref2_phone}
          </span>
          <span className="text-muted-foreground">
            {app.ref2_relationship}, known you {app.ref2_known_for}
          </span>
        </div>
      </Section>

      <Section title="Anything else">
        <p className="whitespace-pre-line">{app.anything_else ?? "—"}</p>
      </Section>
    </>
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
    <div className="grid gap-x-3 sm:grid-cols-[14rem_1fr]">
      <span className="font-medium">{label}</span>
      <span className="whitespace-pre-line">{value}</span>
    </div>
  );
}
