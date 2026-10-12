import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { HandHeart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChapterTag } from "@/components/chapter-tag";
import { loadEventsNeedingVolunteers, needsLabel, VOLUNTEER_PAGE_DAYS } from "@/lib/bulletin";
import { withNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Volunteer · Fishing the Good Fight",
  description: "Help run Fishing the Good Fight events on and off the water.",
};

/** Where a new volunteer ends up: the application, after creating an
 * account (the sign-up form carries `next` through email confirmation). */
const APPLY = "/protected/volunteer/apply";
/** An existing account: their volunteer page, which sends anyone not yet
 * on the team on to the application. */
const VOLUNTEER_HOME = "/protected/volunteer";

async function NeededList() {
  await connection(); // "upcoming" is about now, not build time
  let events;
  try {
    events = await loadEventsNeedingVolunteers(new Date());
  } catch (err) {
    console.error("[volunteer page] failed to load needs:", err);
    return null;
  }
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every upcoming event has the volunteers it needs right now. Apply anyway: new events go up all the time.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id}>
          <Link href={event.path} className="block">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex flex-col gap-1 py-4">
                <span className="font-semibold">{event.name}</span>
                <span className="text-sm text-muted-foreground">
                  {event.day} · {event.time}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {event.chapter && <ChapterTag chapter={event.chapter} />}
                  {event.where}
                </span>
                <span className="mt-1 flex items-start gap-1.5 text-sm">
                  <HandHeart className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                  <span>
                    <span className="font-medium">Needed:</span> {needsLabel(event.needs)}
                  </span>
                </span>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The public volunteer page — where the weekly bulletin's "Volunteer with
 * us" QR code lands (app/bulletin). Readable without signing in: how
 * volunteering works, the upcoming events still short of volunteers
 * (lib/bulletin.ts), and the way in for a new or existing account.
 */
export default function VolunteerLandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 md:p-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Volunteer with Fishing the Good Fight</h1>
        <p className="text-muted-foreground">
          Volunteers help run our events on and off the water. After you apply, we&apos;ll set up a short call,
          check in with your references, and talk about which roles fit.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild>
            <Link href={withNext("/auth/sign-up", APPLY)}>Create an account and apply</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={withNext("/auth/login", VOLUNTEER_HOME)}>I already have an account</Link>
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            <span className="font-medium">Create your account</span> with your name, phone and email. We&apos;ll
            email you a six-digit code to confirm it.
          </li>
          <li>
            <span className="font-medium">Fill out the application.</span> It takes about 10–15 minutes. You&apos;ll
            need two references: one current FTGF volunteer, and one person who knows you well.
          </li>
          <li>
            <span className="font-medium">We&apos;ll be in touch</span> to set up a short call. We usually ask people
            to come to a couple of events first, but you&apos;re welcome to apply now.
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Where help is needed</h2>
        <p className="text-sm text-muted-foreground">
          Upcoming events in the next {VOLUNTEER_PAGE_DAYS / 7} weeks that still need volunteers.
        </p>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
          <NeededList />
        </Suspense>
      </section>
    </main>
  );
}
