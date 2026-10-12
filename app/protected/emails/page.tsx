import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatEventInstant } from "@/lib/format-date";

type SearchParams = Promise<{ chapter?: string; event?: string }>;

type Row = {
  id: number;
  source: string;
  chapter: string | null;
  audience: string;
  subject: string;
  sender_name: string;
  recipient_count: number;
  created_at: string;
  finished_at: string | null;
  event: { name: string } | null;
};

async function EmailHistory({ searchParams }: { searchParams: SearchParams }) {
  const { chapter, event } = await searchParams;
  const eventId = event && /^\d+$/.test(event) ? Number(event) : null;
  const supabase = await createClient();
  let query = supabase
    .from("bulk_emails")
    .select("id, source, chapter, audience, subject, sender_name, recipient_count, created_at, finished_at, event:events(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (eventId) query = query.eq("event_id", eventId);
  else if (chapter) query = query.eq("chapter", chapter);
  const { data, error } = await query;
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load the history: {error.message}</p>;
  const rows = (data ?? []) as unknown as Row[];

  const heading = eventId
    ? `Emails sent about ${rows[0]?.event?.name ?? "this event"}`
    : chapter
      ? `Emails sent to ${chapter}`
      : "Emails sent";

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          From Members and event rosters: who sent each one, when, to whom, and the message.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/protected/emails/${r.id}`} className="flex flex-col gap-0.5 p-3 text-sm hover:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.subject}</span>
                  {!r.finished_at && <Badge variant="secondary">Sending</Badge>}
                </span>
                <span className="text-muted-foreground">
                  {r.sender_name} · {formatEventInstant(r.created_at, "America/Denver")} · {r.audience}
                  {r.event ? ` at ${r.event.name}` : ""} · {r.recipient_count}{" "}
                  {r.recipient_count === 1 ? "person" : "people"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The send history (bulk_emails): for one chapter (?chapter=, Members
 * sends to it) or one event (?event=, roster sends). Only what this person
 * may see comes back from the database (can_view_bulk_email).
 */
export default function EmailHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex w-full max-w-3xl flex-1 flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EmailHistory searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
