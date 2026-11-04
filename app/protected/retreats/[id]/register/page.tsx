import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { homeChapterOption, loadChapters } from "@/lib/chapters";
import { formatEventDateRange } from "@/lib/format-date";
import { loadMyHealthHistoryList } from "@/lib/health-access";
import { formatHealthDate, healthFormCoversUntil } from "@/lib/health-requirements";
import { profileValueFromColumn, REGISTRATION_SECTIONS } from "@/lib/registration-sections";
import { ACTIVE_STATUSES, type RegistrationStatus } from "@/lib/retreat-registration";
import { loadPriceOptions } from "@/lib/retreats";
import { waiverInfoForUser } from "@/lib/waivers";
import { RetreatRegistrationForm } from "@/components/retreats/registration-form";
import { Button } from "@/components/ui/button";

type SearchParams = { price?: string };

async function RegisterLoader({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const { price } = await searchParams;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/auth/login");
  const userId = auth.claims.sub as string;

  const { data: retreat } = await supabase
    .from("events")
    .select("id, name, chapter, kind, starts_at, ends_at, timezone, status, is_published, waiver_state, registration_sections")
    .eq("id", eventId)
    .eq("kind", "retreat")
    .maybeSingle();
  if (!retreat || !retreat.is_published) notFound();

  const back = (
    <Button asChild variant="outline" className="w-fit">
      <Link href={`/protected/retreats/${eventId}`}>Back to the retreat</Link>
    </Button>
  );
  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request.
  const closed = retreat.status !== "scheduled" || new Date(retreat.starts_at as string).getTime() <= Date.now();
  if (closed) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">Registration is closed for this retreat.</p>
        {back}
      </div>
    );
  }

  const { data: existing } = await supabase
    .from("retreat_registrations")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing && ACTIVE_STATUSES.includes(existing.status as RegistrationStatus)) {
    redirect(`/protected/retreats/${eventId}`);
  }

  const [{ data: profile }, chapters, prices, forms, waiver, { data: spotsLeft }, { data: volunteering }, customLookup] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      loadChapters(supabase),
      loadPriceOptions(supabase, eventId),
      loadMyHealthHistoryList(supabase),
      waiverInfoForUser(
        supabase,
        {
          chapter: retreat.chapter as string | null,
          waiver_state: retreat.waiver_state as string | null,
          starts_at: retreat.starts_at as string,
          timezone: retreat.timezone as string,
        },
        userId,
      ),
      supabase.rpc("retreat_spots_left", { p_event_id: eventId }),
      supabase
        .from("volunteer_signups")
        .select("id, opportunity:volunteer_opportunities!inner(event_id)")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .eq("opportunity.event_id", eventId)
        .limit(1),
      price ? supabase.rpc("retreat_custom_price_lookup", { p_event_id: eventId, p_token: price }) : Promise.resolve({ data: null }),
    ]);

  if ((volunteering ?? []).length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          You&apos;re volunteering at this retreat, so you can&apos;t also register as a participant. If that&apos;s wrong,
          reply to any of our emails and we&apos;ll sort it out.
        </p>
        {back}
      </div>
    );
  }
  if (price && !customLookup.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          That price link isn&apos;t valid any more: it may have been used already or withdrawn. Reply to the email it came
          in and we&apos;ll send a new one.
        </p>
        {back}
      </div>
    );
  }
  if (!price && prices.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">Registration opens once the prices are set. Check back soon.</p>
        {back}
      </div>
    );
  }

  const profileFields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) profileFields[field.key] = profileValueFromColumn(field, profile?.[field.key]);
  }
  // The registration needs a form signed in the last 12 months; the
  // pre-retreat check makes sure it still covers the retreat itself.
  const latest = forms[0] ?? null;
  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request.
  const current = latest != null && healthFormCoversUntil(latest.signedAt).getTime() > Date.now();
  const here = `/protected/retreats/${eventId}/register${price ? `?price=${encodeURIComponent(price)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Register: {retreat.name as string}</h1>
        <p className="text-sm text-muted-foreground">
          {formatEventDateRange(retreat.starts_at as string, retreat.ends_at as string | null, retreat.timezone as string)}
        </p>
      </div>
      <RetreatRegistrationForm
        userId={userId}
        eventId={eventId}
        retreatName={retreat.name as string}
        profile={{
          first_name: (profile?.first_name as string | null) ?? "",
          last_name: (profile?.last_name as string | null) ?? "",
          phone: (profile?.phone as string | null) ?? "",
          chapter: homeChapterOption(profile?.chapter as string | null, chapters),
        }}
        profileFields={profileFields}
        registrationSections={(retreat.registration_sections as string[] | null) ?? []}
        waiver={waiver}
        chapters={chapters}
        priceOptions={prices}
        custom={
          price && customLookup.data
            ? { token: price, amountCents: Number((customLookup.data as { amount_cents: number }).amount_cents) }
            : null
        }
        health={{
          current,
          signedLabel: latest ? formatHealthDate(latest.signedAt) : null,
          href: `/protected/profile/medical/new?next=${encodeURIComponent(here)}`,
        }}
        full={typeof spotsLeft === "number" && spotsLeft <= 0}
      />
    </div>
  );
}

export default function RetreatRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RegisterLoader params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
