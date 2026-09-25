import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventRoster } from "@/lib/admin/roster";
import { canViewEventHealthHistory, loadHealthHistoriesForPrint } from "@/lib/health-access";
import { formatEventDateRange } from "@/lib/format-date";
import { eventYear } from "@/lib/waivers";
import { PrintButton } from "@/components/admin/print-button";
import { HealthHistoryView } from "@/components/health-history-view";

type Person = {
  userId: string;
  name: string;
  /** "Participant" or the volunteer role. */
  role: string;
  emergency: string;
};

/**
 * Every participant's and volunteer's health form for one event, one per
 * printed page, large type — for the paper copy that goes to a retreat. The
 * access check is health_histories_for_print, which also logs "print" for
 * each person whose form it returns. Loading this page counts as printing
 * it: there's no way to tell whether the browser's print dialog was used.
 */
async function HealthPrintLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const supabase = await createClient();
  if (!(await canViewEventHealthHistory(supabase, eventId))) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have access to health information for this event.
      </p>
    );
  }
  const [roster, forms] = await Promise.all([
    loadEventRoster(supabase, eventId),
    loadHealthHistoriesForPrint(supabase, eventId),
  ]);
  if (!roster) notFound();
  if (!forms.ok) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the health forms: {forms.error}</p>;
  }
  const { event } = roster;
  const formByUser = new Map(forms.data.map((f) => [f.user_id, f]));

  const emergencyOf = (contact: string, phone: string) =>
    [contact, phone].filter(Boolean).join(" · ") || "none on file";
  const people: Person[] = [
    ...roster.roster.map((p) => ({
      userId: p.userId,
      name: `${p.firstName} ${p.lastName}`.trim(),
      role: "Participant",
      emergency: emergencyOf(p.emergencyContact, p.emergencyPhone),
    })),
    ...roster.volunteerRoster.map((v) => ({
      userId: v.userId,
      name: `${v.firstName} ${v.lastName}`.trim(),
      role: `Volunteer — ${v.role}`,
      emergency: emergencyOf(v.emergencyContact, v.emergencyPhone),
    })),
  ];
  // A volunteer with two shifts gets one page.
  const seen = new Set<string>();
  const pages = people.filter((p) => (seen.has(p.userId) ? false : (seen.add(p.userId), true)));
  const missing = pages.filter((p) => !formByUser.has(p.userId)).length;
  const year = eventYear(event.starts_at, event.timezone);

  return (
    <div className="flex flex-col">
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-bold text-2xl">Health forms — {event.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatEventDateRange(event.starts_at, event.ends_at, event.timezone)} · {pages.length}{" "}
            {pages.length === 1 ? "person" : "people"}
            {missing > 0 ? ` · ${missing} with no ${year} form` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            Confidential. Opening this page was recorded in the health access log. Keep the printout
            with the retreat lead and shred it afterwards.
          </p>
        </div>
        <PrintButton />
      </div>

      {pages.map((person) => {
        const form = formByUser.get(person.userId);
        return (
          <section
            key={person.userId}
            className="mb-10 break-after-page border-t-4 border-foreground pt-4 print:mb-0 print:border-t-0 print:pt-0"
          >
            <p className="mb-2 text-base font-semibold uppercase tracking-wide">
              {event.name} · {person.role} · CONFIDENTIAL
            </p>
            {form ? (
              <HealthHistoryView record={form} personName={person.name} variant="print" />
            ) : (
              <div className="flex flex-col gap-3 text-base">
                <h2 className="text-3xl font-bold">{person.name}</h2>
                <p className="text-2xl font-bold">NO {year} HEALTH FORM ON FILE</p>
                <p>Emergency contact (profile): {person.emergency}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function HealthPrintPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <HealthPrintLoader params={params} />
    </Suspense>
  );
}
