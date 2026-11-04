import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, MapPin } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { loadRegionsAndChapters } from "@/lib/chapters";
import { formatEventDateRange, formatEventInstant } from "@/lib/format-date";
import { publicEventPath } from "@/lib/event-slug";
import {
  AUDIENCE_LABELS,
  fishingMapUrl,
  lodgingMapUrl,
  loadViewerAudiences,
  regionName,
  RETREAT_DETAILS_COLUMNS,
  RETREAT_SESSION_COLUMNS,
  type RetreatDetails,
  type RetreatSession,
} from "@/lib/retreats";
import { RegionTag } from "@/components/region-tag";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function ExternalLinkText({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-green-700 underline underline-offset-4 dark:text-green-500"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

/**
 * One retreat for a signed-in person. The private details come straight
 * from retreat_details and retreat_sessions with the person's own client:
 * the database returns only what they may see (confirmed participants,
 * volunteers here, the leadership team for leadership sessions, the
 * retreat lead and admins), so this page has no rule of its own.
 */
async function RetreatLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/auth/login");

  const { data: retreat } = await supabase
    .from("events")
    .select("id, slug, name, region_id, starts_at, ends_at, timezone, description, status")
    .eq("id", eventId)
    .eq("kind", "retreat")
    .maybeSingle();
  if (!retreat) notFound();

  const [{ data: details }, { data: sessions }, audiences, { data: manages }, { regions }] = await Promise.all([
    supabase.from("retreat_details").select(RETREAT_DETAILS_COLUMNS).eq("event_id", eventId).maybeSingle(),
    supabase.from("retreat_sessions").select(RETREAT_SESSION_COLUMNS).eq("event_id", eventId).order("starts_at"),
    loadViewerAudiences(supabase, eventId),
    supabase.rpc("can_manage_event", { p_event_id: eventId }),
    loadRegionsAndChapters(supabase),
  ]);
  const d = details as RetreatDetails | null;
  const sessionRows = (sessions ?? []) as RetreatSession[];
  const timezone = retreat.timezone as string;
  const onRetreat = audiences.length > 0 || Boolean(manages);
  const fishingMap = d ? fishingMapUrl(d) : null;
  const lodgingMap = d ? lodgingMapUrl(d) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{retreat.name as string}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <RegionTag region={regionName(retreat.region_id as number, regions)} />
          <span>{formatEventDateRange(retreat.starts_at as string, retreat.ends_at as string | null, timezone)}</span>
        </div>
        {retreat.status === "cancelled" && (
          <p className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            This retreat has been cancelled.
          </p>
        )}
        {onRetreat && (
          <p className="text-sm text-muted-foreground">
            {manages && audiences.length === 0
              ? "You manage this retreat, so you see everything below."
              : `You're here as: ${audiences.map((a) => AUDIENCE_LABELS[a].toLowerCase()).join(", ")}.`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={publicEventPath(retreat.slug as string)}>Public page</Link>
          </Button>
          {Boolean(manages) && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/protected/admin/retreats/${eventId}`}>Setup</Link>
            </Button>
          )}
        </div>
      </div>

      {!onRetreat ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Where we&apos;re staying and fishing, the shared photos and the meeting links are shared with confirmed
            participants and the volunteers at this retreat.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Where</CardTitle>
              <CardDescription>For the people on this retreat only. Please don&apos;t share it.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {!d || (!d.lodging_name && !d.lodging_address && !d.fishing_name && !fishingMap) ? (
                <p className="text-muted-foreground">Details coming soon.</p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  {(d.lodging_name || d.lodging_address) && (
                    <>
                      <dt className="font-medium text-muted-foreground">Lodging</dt>
                      <dd className="flex flex-col gap-0.5">
                        {d.lodging_name && <span>{d.lodging_name}</span>}
                        {d.lodging_address && <span className="text-muted-foreground">{d.lodging_address}</span>}
                        {lodgingMap && (
                          <span>
                            <ExternalLinkText href={lodgingMap}>Map</ExternalLinkText>
                          </span>
                        )}
                      </dd>
                    </>
                  )}
                  {(d.fishing_name || fishingMap) && (
                    <>
                      <dt className="font-medium text-muted-foreground">Fishing</dt>
                      <dd className="flex flex-col gap-0.5">
                        {d.fishing_name && <span>{d.fishing_name}</span>}
                        {d.fishing_address && <span className="text-muted-foreground">{d.fishing_address}</span>}
                        {fishingMap && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                            <ExternalLinkText href={fishingMap}>
                              {d.fishing_latitude != null ? "Open the pin in Google Maps" : "Map"}
                            </ExternalLinkText>
                          </span>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {d?.photos_url && (
                <p>
                  <ExternalLinkText href={d.photos_url}>Shared photo album</ExternalLinkText>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Virtual sessions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {sessionRows.length === 0 ? (
                <p className="text-muted-foreground">None scheduled for you yet.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {sessionRows.map((s) => (
                    <li key={s.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-muted-foreground">
                        {s.ends_at
                          ? formatEventDateRange(s.starts_at, s.ends_at, timezone)
                          : formatEventInstant(s.starts_at, timezone)}
                        {manages ? ` · for ${AUDIENCE_LABELS[s.audience].toLowerCase()}` : ""}
                      </span>
                      {s.meeting_url ? (
                        <span>
                          <ExternalLinkText href={s.meeting_url}>Join the meeting</ExternalLinkText>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Meeting link coming soon.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {retreat.description && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">{retreat.description as string}</p>
      )}
    </div>
  );
}

export default function RetreatPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RetreatLoader params={params} />
      </Suspense>
    </div>
  );
}
