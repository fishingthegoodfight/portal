import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CalendarDays, HandHeart, MapPin, Tent } from "lucide-react";

import { PrintButton } from "@/components/admin/print-button";
import { isVirtualChapter } from "@/lib/chapters";
import {
  bulletinLinks,
  loadBulletin,
  needsLabel,
  qrSvg,
  spotsLabel,
  type BulletinEvent,
  type BulletinRetreat,
} from "@/lib/bulletin";
import { cn } from "@/lib/utils";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Weekly bulletin · Fishing the Good Fight",
  description: "What's coming up at Fishing the Good Fight: retreats, events, and where volunteers are needed.",
  robots: { index: false },
};

/** A printed page is always light, whatever the screen theme: every color
 * here is a fixed one, never a theme token. */

const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

function QrCard({ svg, url, title, body }: { svg: string; url: string; title: string; body: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border-2 border-green-800 p-3 sm:p-4">
      <div
        aria-hidden
        className="size-24 shrink-0 sm:size-32 print:size-[1.45in] [&>svg]:h-full [&>svg]:w-full"
        // Generated from our own URL by the qrcode package (lib/bulletin.ts).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-bold leading-tight text-green-900 sm:text-lg">{title}</p>
        <p className="text-xs leading-snug text-stone-600 sm:text-sm">{body}</p>
        <p className="break-all text-xs font-semibold text-stone-800">{shortUrl(url)}</p>
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: typeof Tent; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 border-b-2 border-green-800 pb-1 text-lg font-bold uppercase tracking-wide text-green-900 break-after-avoid">
      <Icon className="size-5" aria-hidden />
      {children}
    </h2>
  );
}

function RetreatRow({ retreat }: { retreat: BulletinRetreat }) {
  const pct = retreat.capacity ? Math.min(100, Math.round((retreat.enrolled / retreat.capacity) * 100)) : null;
  return (
    <li className="flex flex-col gap-1.5 border-b border-stone-200 py-2.5 last:border-b-0 break-inside-avoid sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{retreat.name}</p>
        <p className="text-sm text-stone-600">
          {retreat.dates}
          {retreat.where ? ` · ${retreat.where}` : ""}
        </p>
      </div>
      <div className="flex w-full flex-col gap-1 sm:w-48">
        <p className="text-sm font-semibold">
          {retreat.enrolled}
          {retreat.capacity != null ? ` of ${retreat.capacity}` : ""} enrolled
        </p>
        {pct != null && (
          <div className="h-2 overflow-hidden rounded-full bg-stone-200 [print-color-adjust:exact]">
            <div className="h-full rounded-full bg-green-700" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

function EventRow({ event, showChapter }: { event: BulletinEvent; showChapter: boolean }) {
  const spots = spotsLabel(event.spotsLeft);
  return (
    <li className="flex gap-3 border-b border-stone-200 py-2.5 last:border-b-0 break-inside-avoid">
      <div className="flex w-12 shrink-0 flex-col items-center rounded-md border border-stone-300 py-1 leading-none">
        <span className="text-[10px] font-semibold uppercase text-stone-500">{event.dateParts.weekday}</span>
        <span className="text-xl font-bold text-stone-900">{event.dateParts.day}</span>
        <span className="text-[10px] font-semibold uppercase text-stone-500">{event.dateParts.month}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="font-semibold leading-snug">{event.name}</p>
          {spots && (
            <span
              className={cn(
                "shrink-0 text-xs font-semibold",
                event.spotsLeft === 0 ? "font-bold uppercase tracking-wide text-red-700" : "text-green-800",
              )}
            >
              {spots}
            </span>
          )}
        </div>
        <p className="text-sm text-stone-600">
          {event.time}
          {showChapter && event.chapter && !isVirtualChapter(event.chapter) ? ` · ${event.chapter}` : ""}
        </p>
        {event.where && (
          <p className="flex items-center gap-1 text-sm text-stone-600">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{event.where}</span>
          </p>
        )}
        {event.needs.length > 0 && (
          <p className="mt-1 flex items-start gap-1.5 rounded bg-amber-100 px-2 py-1 text-sm text-amber-950 [print-color-adjust:exact]">
            <HandHeart className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Volunteers needed:</span> {needsLabel(event.needs)}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-stone-100 px-2 py-2.5 text-center [print-color-adjust:exact]">
      <span className="text-2xl font-bold text-green-900">{value}</span>
      <span className="text-xs leading-tight text-stone-600">{label}</span>
    </div>
  );
}

async function BulletinBody({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  await connection(); // "upcoming" is about now, not build time
  const { region: regionParam } = await searchParams;
  const links = bulletinLinks();
  let bulletin;
  let qr: { events: string; volunteer: string };
  try {
    [bulletin, qr] = await Promise.all([
      loadBulletin(new Date(), regionParam),
      Promise.all([qrSvg(links.events), qrSvg(links.volunteer)]).then(([events, volunteer]) => ({ events, volunteer })),
    ]);
  } catch (err) {
    console.error("[bulletin] failed to load:", err);
    return <p className="text-sm text-red-500">Couldn&apos;t load the bulletin. Please try again in a moment.</p>;
  }
  const region = bulletin.regionNames.find((name) => name.toLowerCase() === regionParam?.toLowerCase()) ?? null;
  const multiChapterRegions = new Set(
    bulletin.regions
      .filter((r) => new Set(r.events.map((e) => e.chapter)).size > 1)
      .map((r) => r.name),
  );

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[8.5in] flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label="Regions" className="flex flex-wrap gap-2">
          {[null, ...bulletin.regionNames].map((name) => (
            <Link
              key={name ?? "all"}
              href={name ? `/bulletin?region=${encodeURIComponent(name)}` : "/bulletin"}
              aria-current={name === region ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                name === region ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
              )}
            >
              {name ?? "All regions"}
            </Link>
          ))}
        </nav>
        <PrintButton />
      </div>

      <article className="mx-auto flex max-w-[8.5in] flex-col gap-5 bg-white p-4 text-stone-900 shadow-lg sm:p-[0.5in] print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-green-900 px-5 py-4 text-white [print-color-adjust:exact]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-200">Fishing the Good Fight</p>
            <h1 className="text-3xl font-bold leading-tight">Weekly Bulletin</h1>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-green-200">{region ?? "What's coming up"}</p>
            <p className="text-lg font-semibold">{bulletin.rangeLabel}</p>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-2">
          <Stat value={bulletin.eventCount} label={`${bulletin.eventCount === 1 ? "event" : "events"} in the next two weeks`} />
          <Stat value={bulletin.openVolunteerSlots} label={`volunteer ${bulletin.openVolunteerSlots === 1 ? "spot" : "spots"} to fill`} />
          <Stat value={bulletin.retreats.length} label={`${bulletin.retreats.length === 1 ? "retreat" : "retreats"} open for enrollment`} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
          <QrCard
            svg={qr.events}
            url={links.events}
            title="Join us at an event"
            body="Scan to see every upcoming event and save your spot."
          />
          <QrCard
            svg={qr.volunteer}
            url={links.volunteer}
            title="Volunteer with us"
            body="Help run events on and off the water. Scan to see where help is needed and apply."
          />
        </div>

        <section className="flex flex-col gap-2">
          <SectionHeading icon={Tent}>Retreats</SectionHeading>
          {bulletin.retreats.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-600">
              No retreats are open for enrollment right now. Ask your chapter lead about what&apos;s planned.
            </p>
          ) : (
            <ul>
              {bulletin.retreats.map((retreat) => (
                <RetreatRow key={retreat.path} retreat={retreat} />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeading icon={CalendarDays}>Upcoming events · next two weeks</SectionHeading>
          {bulletin.regions.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-600">
              No events{region ? ` in ${region} or online` : ""} in the next two weeks. Scan the events code for what&apos;s
              further out.
            </p>
          ) : (
            bulletin.regions.map((r) => (
              <div key={r.name} className="flex flex-col">
                <h3 className="flex items-baseline justify-between bg-stone-100 px-2 py-1 text-sm font-bold uppercase tracking-wider text-stone-700 break-after-avoid [print-color-adjust:exact]">
                  <span>{r.name}</span>
                  <span className="text-xs font-medium normal-case tracking-normal text-stone-500">
                    {r.events.length} {r.events.length === 1 ? "event" : "events"}
                  </span>
                </h3>
                <ul>
                  {r.events.map((event) => (
                    <EventRow key={event.id} event={event} showChapter={multiChapterRegions.has(r.name)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <footer className="mt-auto flex flex-col gap-1 border-t border-stone-300 pt-3 text-xs text-stone-500 sm:flex-row sm:justify-between">
          <span>
            Questions? Talk to your event lead or email {CONTACT_EMAIL}.
          </span>
          <span>Printed {bulletin.generatedLabel} · spots change daily, so scan for the latest.</span>
        </footer>
      </article>
    </>
  );
}

/**
 * The printable weekly bulletin (lib/bulletin.ts). Public, so a chapter
 * lead can print it without signing in; it shows only what the public
 * events list does, plus region names and open volunteer roles. One US
 * Letter page when the two weeks are quiet, more when they aren't; event
 * rows never split across pages.
 */
export default function BulletinPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  return (
    <main className="min-h-screen bg-stone-200 px-4 py-6 dark:bg-stone-900 sm:px-8 print:bg-white print:p-0">
      <style>{"@page { size: letter; margin: 0.5in; }"}</style>
      <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading...</p>}>
        <BulletinBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
