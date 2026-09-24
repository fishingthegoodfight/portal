import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ChapterTag } from "@/components/chapter-tag";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEventDateRange } from "@/lib/format-date";
import { isVirtualChapter } from "@/lib/chapters";
import { publicEventPath } from "@/lib/event-slug";
import { rsvpPath, withNext } from "@/lib/safe-next";
import {
  hasHappened,
  loadPublicEvent,
  publicLocationLines,
  publicLocationSummary,
} from "@/lib/public-events";

type Params = Promise<{ slug: string }>;

const ORG_NAME = "Fishing the Good Fight";

/**
 * Link-preview tags (Open Graph + Twitter card) for texts, Facebook,
 * Instagram and the like: title, date/time in the event's own zone, and where.
 * The preview image is ./opengraph-image.tsx. Nothing here comes from
 * anything anon can't read — see lib/public-events.ts.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await loadPublicEvent(slug);
  if (lookup.kind !== "found") return { title: ORG_NAME };

  const { event } = lookup;
  const cancelled = event.status === "cancelled";
  const title = cancelled ? `Cancelled: ${event.name}` : event.name;
  const description = [
    formatEventDateRange(event.starts_at, event.ends_at, event.timezone),
    publicLocationSummary(event),
    event.chapter && !isVirtualChapter(event.chapter) ? `${event.chapter} chapter` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const url = publicEventPath(event.slug);

  return {
    title: `${title} · ${ORG_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: ORG_NAME, title, description, url },
    twitter: { card: "summary_large_image", title, description },
  };
}

async function PublicEventLoader({ params }: { params: Params }) {
  const { slug } = await params;
  const lookup = await loadPublicEvent(slug);
  if (lookup.kind === "not_found") notFound();
  // Old numeric-id links and retired slugs land on the current URL, so
  // whatever gets shared from here on is the canonical one.
  if (lookup.kind === "redirect") permanentRedirect(publicEventPath(lookup.slug));

  const { event, spotsLeft } = lookup;
  await connection(); // "has it happened yet" is about now, not build time
  const cancelled = event.status === "cancelled";
  const past = !cancelled && hasHappened(event, new Date());

  // Only to pick the RSVP button's destination — the event itself was read
  // as anon above, whoever is signed in.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const signedIn = Boolean(auth?.claims);
  const destination = rsvpPath(event.id);

  const locationLines = publicLocationLines(event);
  const virtual = isVirtualChapter(event.chapter);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{event.name}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {event.chapter && <ChapterTag chapter={event.chapter} />}
          {event.event_type && <span>{event.event_type}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {cancelled && (
          <div
            role="status"
            className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
          >
            <p className="font-semibold">This event has been cancelled.</p>
            {event.cancellation_reason && (
              <p className="mt-1 whitespace-pre-line">{event.cancellation_reason}</p>
            )}
          </div>
        )}
        {past && (
          <p role="status" className="rounded-md border bg-muted p-3 text-sm">
            This event has already happened. Thanks to everyone who came!
          </p>
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-medium text-muted-foreground">When</dt>
          <dd>{formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}</dd>

          <dt className="font-medium text-muted-foreground">Where</dt>
          <dd>
            {virtual ? (
              "Online — the meeting link is sent to registered participants."
            ) : locationLines.length > 0 ? (
              locationLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))
            ) : (
              "Location to be announced"
            )}
          </dd>

          {!cancelled && !past && (
            <>
              <dt className="font-medium text-muted-foreground">Spots</dt>
              <dd>
                {spotsLeft == null
                  ? "Open — no limit"
                  : spotsLeft > 0
                    ? `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`
                    : "Full — you can join the waitlist"}
              </dd>
            </>
          )}
        </dl>

        {event.description && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{event.description}</p>
        )}
        {event.occurrence_note && (
          <p className="whitespace-pre-line rounded-md border-l-2 border-l-green-600 bg-green-600/10 px-3 py-2 text-sm">
            {event.occurrence_note}
          </p>
        )}

        {!cancelled && !past && (
          <div className="flex flex-col gap-2">
            {signedIn ? (
              <Button asChild className="w-fit">
                <Link href={destination}>
                  {spotsLeft === 0 ? "Join the waitlist" : "RSVP"}
                </Link>
              </Button>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href={withNext("/auth/login", destination)}>Sign in to RSVP</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={withNext("/auth/sign-up", destination)}>Create an account</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You&apos;ll come straight back here to finish your RSVP.
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The public, shareable page for one event — no login needed. */
export default function PublicEventPage({ params }: { params: Params }) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center">
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-5">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
          <PublicEventLoader params={params} />
        </Suspense>
      </div>
    </main>
  );
}
