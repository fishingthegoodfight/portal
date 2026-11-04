import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { loadRegionsAndChapters } from "@/lib/chapters";
import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { publicEventPath } from "@/lib/event-slug";
import { toZonedDateTimeInputs } from "@/lib/timezone";
import {
  balanceDueDate,
  loadPriceOptions,
  regionName,
  RETREAT_COLUMNS,
  RETREAT_DETAILS_COLUMNS,
  RETREAT_SESSION_COLUMNS,
  type RetreatDetails,
  type RetreatRow,
  type RetreatSession,
} from "@/lib/retreats";
import {
  PriceOptionsEditor,
  RetreatCoreForm,
  RetreatDetailsForm,
  RetreatPaymentSettingsForm,
  RetreatPublishToggle,
  RetreatSessionsPanel,
} from "@/components/admin/retreat-forms";
import { RegionTag } from "@/components/region-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { retreatFormOptions } from "../options";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Everything about one retreat but its people (that's the roster, the
 * ordinary event page). For admins and the retreat's own lead. */
async function RetreatSetupLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  if (!allowed) notFound();

  const [{ data: retreat }, { data: details }, { data: sessions }, prices, { regions, chapters }, access, { data: others }] =
    await Promise.all([
      supabase.from("events").select(RETREAT_COLUMNS).eq("id", eventId).eq("kind", "retreat").maybeSingle(),
      supabase.from("retreat_details").select(RETREAT_DETAILS_COLUMNS).eq("event_id", eventId).maybeSingle(),
      supabase.from("retreat_sessions").select(RETREAT_SESSION_COLUMNS).eq("event_id", eventId).order("starts_at"),
      loadPriceOptions(supabase, eventId),
      loadRegionsAndChapters(supabase),
      loadEventAdminAccess(supabase),
      supabase
        .from("events")
        .select("id, name, starts_at, timezone")
        .eq("kind", "retreat")
        .neq("id", eventId)
        .order("starts_at", { ascending: false })
        .limit(50),
    ]);
  if (!retreat) notFound();
  const r = retreat as RetreatRow;
  const isAdmin = access?.isAdmin ?? false;
  const options = retreatFormOptions(regions, chapters, {
    timezone: r.timezone,
    state: r.waiver_state ?? undefined,
    regionId: r.region_id,
  });
  const start = toZonedDateTimeInputs(new Date(r.starts_at), r.timezone);
  const end = r.ends_at ? toZonedDateTimeInputs(new Date(r.ends_at), r.timezone) : { date: "", time: "" };
  const defaultDue = balanceDueDate({ ...r, balance_due_date: null });

  const missing = [
    !details && "lodging and fishing location",
    prices.length === 0 && "price options",
    prices.length > 0 && !prices.some((p) => p.is_true_cost) && "which price is the true cost",
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{r.name}</h1>
          {r.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
          {!r.is_published && <Badge variant="outline">Unpublished</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <RegionTag region={regionName(r.region_id, regions)} />
          <span>{formatEventDateRange(r.starts_at, r.ends_at, r.timezone)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/protected/admin/events/${r.id}`}>Roster</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/protected/retreats/${r.id}`}>As participants see it</Link>
          </Button>
          {r.is_published && (
            <Button asChild variant="outline" size="sm">
              <Link href={publicEventPath(r.slug)}>Public page</Link>
            </Button>
          )}
        </div>
      </div>

      <Section
        title={r.is_published ? "Published" : "Not published yet"}
        description={
          r.is_published
            ? "Anyone can see the public page: title, region, dates, description, prices and spots left."
            : "Nobody but admins and the retreat lead can see it."
        }
      >
        <div className="flex flex-col gap-3">
          {!r.is_published && missing.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Still to add: {missing.join(", ")}.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Registration opens with the next part of this build. Until then a published retreat shows &ldquo;Registration
            opens soon.&rdquo;
          </p>
          <RetreatPublishToggle eventId={r.id} published={r.is_published} />
        </div>
      </Section>

      <Section title="Basics">
        <RetreatCoreForm
          key={`${r.id}-${r.region_id}-${r.lead_user_id}`}
          eventId={r.id}
          initial={{
            name: r.name,
            regionId: String(r.region_id),
            startDate: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
            timezone: r.timezone,
            description: r.description ?? "",
            capacity: r.capacity == null ? "" : String(r.capacity),
            waiverState: r.waiver_state ?? "",
            leadName: r.lead_name ?? "",
            leadEmail: r.lead_email ?? "",
            leadPhone: r.lead_phone ?? "",
            leadUserId: r.lead_user_id ?? "",
          }}
          {...options}
          canChangeAdminFields={isAdmin}
        />
      </Section>

      <Section
        title="Lodging, fishing and photos"
        description="Private: shown only to confirmed participants, volunteers at this retreat, the retreat lead and admins."
      >
        <RetreatDetailsForm eventId={r.id} initial={(details as RetreatDetails | null) ?? null} />
      </Section>

      <Section
        title="Virtual sessions"
        description="Each one is shown, with its meeting link, only to the people it's for. Leadership is the retreat lead plus volunteers here as Retreat Lead, Logistics Coordinator, Lead Fly Fishing Instructor or Retreat Therapist."
      >
        <RetreatSessionsPanel
          eventId={r.id}
          sessions={((sessions ?? []) as RetreatSession[]).map((s) => {
            const at = toZonedDateTimeInputs(new Date(s.starts_at), r.timezone);
            return {
              id: s.id,
              title: s.title,
              date: at.date,
              startTime: at.time,
              endTime: s.ends_at ? toZonedDateTimeInputs(new Date(s.ends_at), r.timezone).time : "",
              meetingUrl: s.meeting_url ?? "",
              audience: s.audience,
              when: s.ends_at
                ? formatEventDateRange(s.starts_at, s.ends_at, r.timezone)
                : formatEventInstant(s.starts_at, r.timezone),
            };
          })}
        />
      </Section>

      <Section title="Price options">
        <PriceOptionsEditor
          key={prices.map((p) => `${p.id}:${p.sort_order}:${p.amount_cents}:${p.is_true_cost}`).join(",")}
          eventId={r.id}
          options={prices}
          otherRetreats={((others ?? []) as { id: number; name: string; starts_at: string; timezone: string }[]).map((o) => ({
            value: String(o.id),
            label: `${o.name} (${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: o.timezone }).format(new Date(o.starts_at))})`,
          }))}
        />
      </Section>

      <Section title="Deposit, balance and refunds" description="Used once payments are switched on.">
        <RetreatPaymentSettingsForm
          eventId={r.id}
          depositCents={r.deposit_cents}
          balanceDueDate={r.balance_due_date}
          defaultBalanceDueDate={defaultDue}
          refundPolicy={r.refund_policy}
        />
      </Section>
    </div>
  );
}

export default function RetreatSetupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RetreatSetupLoader params={params} />
      </Suspense>
    </div>
  );
}
