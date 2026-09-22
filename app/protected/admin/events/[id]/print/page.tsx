import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventRoster } from "@/lib/admin/roster";
import { formatEventDateRange } from "@/lib/format-date";
import { PrintButton } from "@/components/admin/print-button";
import { dietaryDisplay } from "@/lib/registration-sections";

/** Restrictions text, "No restrictions", or a bold marker for no answer. */
function DietaryCell({ note, collected }: { note: string | null; collected: boolean }) {
  const display = dietaryDisplay(note);
  if (display.kind === "restrictions") return <>{display.text}</>;
  if (!collected) return <>—</>;
  if (display.kind === "none") return <>No restrictions</>;
  return <strong>NOT ANSWERED</strong>;
}

async function PrintRosterLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    notFound();
  }

  const supabase = await createClient();
  const data = await loadEventRoster(supabase, eventId);
  if (!data) {
    notFound();
  }
  const { event, roster, dietary } = data;

  return (
    <div className="flex-1 w-full flex flex-col gap-6 print:gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl">{event.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          {event.virtual_link && (
            <p className="text-sm text-muted-foreground">
              Join online: {event.virtual_link}
              {event.virtual_access_notes ? ` — ${event.virtual_access_notes}` : ""}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {roster.length} on roster
            {dietary.collected && dietary.notAnsweredCount > 0
              ? ` · ${dietary.notAnsweredCount} haven't answered dietary`
              : ""}
          </p>
        </div>
        <PrintButton />
      </div>

      <table className="w-full border-collapse text-sm print:text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">Phone</th>
            <th className="py-2 pr-3 font-semibold">Emergency contact</th>
            <th className="py-2 pr-3 font-semibold">Dietary</th>
            <th className="py-2 pr-3 font-semibold">Waiver</th>
            <th className="w-10 py-2 font-semibold">✓</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((person) => {
            const emergency = [person.emergencyContact, person.emergencyPhone]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={person.rsvpId} className="border-b border-neutral-300">
                <td className="py-2 pr-3">
                  {person.firstName} {person.lastName}
                </td>
                <td className="py-2 pr-3">{person.phone || "—"}</td>
                <td className="py-2 pr-3">{emergency || "—"}</td>
                <td className="py-2 pr-3">
                  <DietaryCell note={person.dietaryNotes} collected={dietary.collected} />
                </td>
                <td className="py-2 pr-3">
                  {person.waiverSignedOn ? person.waiverSignedOn : <strong>NOT SIGNED</strong>}
                </td>
                <td className="py-2">
                  <span className="inline-block h-4 w-4 border border-black" aria-hidden />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {roster.length === 0 && <p className="text-sm text-muted-foreground">No RSVPs yet.</p>}
    </div>
  );
}

export default function PrintRosterPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <PrintRosterLoader params={params} />
    </Suspense>
  );
}
