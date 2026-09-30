import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { formatDateInZone, formatEventDateRange } from "@/lib/format-date";
import { resolveEventWaiver, waiverHeading, waiverStateName } from "@/lib/waivers";
import { PrintButton } from "@/components/admin/print-button";
import { WaiverText } from "@/components/waiver-text";
import { cn } from "@/lib/utils";

/** Blank entries on each sign-in page. */
const ENTRIES_PER_PAGE = 10;
/** Sign-in pages offered (?pages=). */
const MAX_PAGES = 4;

/** A ruled line to write on, with its label underneath. */
function WriteIn({ label, className, children }: { label: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex flex-1 items-end border-b border-black pb-0.5 text-sm">{children}</div>
      <span className="pt-0.5 text-[8px] uppercase leading-tight tracking-wide">{label}</span>
    </div>
  );
}

/**
 * The paper fallback for walk-ups: the event's participant waiver in full,
 * then blank sign-in pages to hand round. What's written here is entered
 * afterwards through Add walk-up, with "They signed a paper waiver instead"
 * (a record for this event only — see event_paper_waivers). Participants
 * only: volunteers sign their waiver at registration.
 *
 * Laid out in fixed columns with no breakpoint classes, so it prints the
 * same from a phone as from a laptop; on a narrow screen the preview
 * scrolls sideways instead of reflowing.
 */
async function WalkupSheetLoader({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pages?: string }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }
  const { pages: pagesParam } = await searchParams;
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.trunc(Number(pagesParam)) || 1));

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, chapter, waiver_state, starts_at, ends_at, timezone, location")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    notFound();
  }

  const requirement = await resolveEventWaiver(supabase, {
    chapter: event.chapter as string | null,
    waiver_state: event.waiver_state as string | null,
    starts_at: event.starts_at as string,
    timezone: event.timezone as string,
  });
  const dateRange = formatEventDateRange(
    event.starts_at as string,
    event.ends_at as string | null,
    event.timezone as string,
  );
  const eventDate = formatDateInZone(event.starts_at as string, event.timezone as string);
  const eventHeader = (
    <>
      <h1 className="text-xl font-bold">{event.name}</h1>
      <p className="text-sm">
        {dateRange}
        {event.location ? ` · ${event.location}` : ""}
      </p>
    </>
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Letter and A4 both leave room for ten entries inside these margins. */}
      <style>{`@media print { @page { margin: 0.5in; } }`}</style>

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <p className="text-lg font-semibold">Walk-up sign-in sheet</p>
          <p className="text-sm text-muted-foreground">
            The waiver, then {pages} sign-in {pages === 1 ? "page" : "pages"} of {ENTRIES_PER_PAGE}{" "}
            blank entries. Sign-in pages:{" "}
            {Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map((n) => (
              <Link
                key={n}
                href={`/protected/admin/events/${eventId}/walkup-sheet?pages=${n}`}
                className={cn("mx-1 underline underline-offset-4", n === pages && "font-semibold text-foreground no-underline")}
              >
                {n}
              </Link>
            ))}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-[7in] print:min-w-0 print:text-black">
          <section>
            {eventHeader}
            {requirement.kind === "ok" ? (
              <>
                <p className="mt-3 text-sm font-semibold">
                  {waiverHeading(requirement.state, requirement.year)} — {requirement.waiver.title}
                </p>
                <WaiverText markdown={requirement.waiver.body_markdown} className="mt-2" />
              </>
            ) : (
              <p className="mt-3 text-sm font-semibold">
                {requirement.kind === "no_state"
                  ? "No waiver state is set for this event, so there is no waiver to print. Set it on the event before using this sheet."
                  : `No ${requirement.year} ${waiverStateName(requirement.state)} waiver has been published, so there is no waiver to print. Publish it before using this sheet.`}
              </p>
            )}
          </section>

          {Array.from({ length: pages }, (_, page) => (
            <section
              key={page}
              className="mt-10 flex h-[9.4in] break-before-page break-inside-avoid flex-col border-t-4 border-foreground pt-4 print:mt-0 print:border-t-0 print:pt-0"
            >
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-base font-semibold">
                  {event.name} · {eventDate} · Walk-up sign-in
                </p>
                {pages > 1 && (
                  <p className="shrink-0 text-xs">
                    Page {page + 1} of {pages}
                  </p>
                )}
              </div>
              <p className="mt-1 text-sm font-medium">
                By signing below, I confirm I have read and agree to the waiver above.
              </p>

              <ol className="mt-2 flex flex-1 flex-col border-t border-black">
                {Array.from({ length: ENTRIES_PER_PAGE }, (_, i) => (
                  <li key={i} className="flex flex-1 gap-3 border-b border-neutral-400 py-1">
                    <span className="w-5 shrink-0 pt-1 text-sm font-semibold">
                      {page * ENTRIES_PER_PAGE + i + 1}
                    </span>
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="grid flex-1 grid-cols-[5fr_6fr_4fr] gap-4">
                        <WriteIn label="Name (print)" />
                        <WriteIn label="Email" />
                        <WriteIn label="Phone" />
                      </div>
                      <div className="grid flex-1 grid-cols-[5fr_4fr_5fr_2.4fr] gap-4">
                        <WriteIn label="Emergency contact name" />
                        <WriteIn label="Emergency contact phone" />
                        <WriteIn label="Signature" />
                        <WriteIn label="Date">{eventDate}</WriteIn>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mt-2 text-xs">
                <span className="font-semibold">Event lead:</span> afterwards, enter each person on
                the roster with Add walk-up, choosing &ldquo;They signed a paper waiver
                instead&rdquo;, and keep this sheet. Participants only — volunteers sign at
                registration.
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WalkupSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pages?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <WalkupSheetLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
