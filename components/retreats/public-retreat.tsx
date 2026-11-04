import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegionTag } from "@/components/region-tag";
import { formatEventDateRange } from "@/lib/format-date";
import { loadPublicRegionsAndChapters, type PublicEvent } from "@/lib/public-events";
import { formatPrice, loadPriceOptions, loadViewerAudiences, regionName } from "@/lib/retreats";

/** "8 spots left", "1 spot left", "Full", or null with no limit. */
export function retreatSpotsLabel(spotsLeft: number | null): string | null {
  if (spotsLeft == null) return null;
  if (spotsLeft <= 0) return "Full";
  return `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`;
}

/**
 * A retreat's public page: title, region, dates, description, price
 * options and spots left, and nothing else. Read as anon, so it can't show
 * anything more (the lodging, fishing location and links live in tables
 * anon can't read at all).
 */
export async function PublicRetreat({
  event,
  spotsLeft,
  past,
}: {
  event: PublicEvent;
  spotsLeft: number | null;
  past: boolean;
}) {
  const [prices, { regions }] = await Promise.all([
    loadPriceOptions(createAnonClient(), event.id),
    loadPublicRegionsAndChapters(),
  ]);
  const cancelled = event.status === "cancelled";
  const spots = retreatSpotsLabel(spotsLeft);

  // Signed in and on this retreat (or managing it): a way to their details.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const signedIn = Boolean(auth?.claims);
  const [audiences, manages] = signedIn
    ? await Promise.all([
        loadViewerAudiences(supabase, event.id),
        supabase.rpc("can_manage_event", { p_event_id: event.id }).then((r) => Boolean(r.data)),
      ])
    : [[], false];
  const onRetreat = audiences.length > 0 || manages;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{event.name}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <RegionTag region={regionName(event.region_id, regions)} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {cancelled && (
          <div
            role="status"
            className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
          >
            <p className="font-semibold">This retreat has been cancelled.</p>
            {event.cancellation_reason && <p className="mt-1 whitespace-pre-line">{event.cancellation_reason}</p>}
          </div>
        )}
        {past && (
          <p role="status" className="rounded-md border bg-muted p-3 text-sm">
            This retreat has already happened.
          </p>
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-medium text-muted-foreground">When</dt>
          <dd>{formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}</dd>
          {!cancelled && !past && spots && (
            <>
              <dt className="font-medium text-muted-foreground">Spots</dt>
              <dd>{spots}</dd>
            </>
          )}
        </dl>

        {event.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{event.description}</p>}

        {prices.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Price options</h2>
            <ul className="flex flex-col divide-y rounded-md border">
              {prices.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5 p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {p.label}
                      {p.is_true_cost && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                          True cost
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{p.amount_cents === 0 ? "Free" : formatPrice(p.amount_cents)}</span>
                  </div>
                  {p.description && <span className="text-muted-foreground">{p.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {onRetreat ? (
          <Button asChild className="w-fit">
            <Link href={`/protected/retreats/${event.id}`}>Your retreat details</Link>
          </Button>
        ) : (
          !cancelled &&
          !past && (
            <p className="rounded-md border bg-muted/50 p-3 text-sm">Registration opens soon.</p>
          )
        )}
      </CardContent>
    </Card>
  );
}
