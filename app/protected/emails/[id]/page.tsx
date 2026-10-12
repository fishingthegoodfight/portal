import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEventInstant } from "@/lib/format-date";
import { signatureLines } from "@/lib/bulk-email-text";

type Recipient = { id: number; email: string; first_name: string | null; status: string; error: string | null };

async function EmailResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: email }, { data: rows }] = await Promise.all([
    supabase
      .from("bulk_emails")
      .select("id, source, chapter, event_id, audience, subject, body, sender_name, sender_email, recipient_count, created_at, finished_at, event:events(name)")
      .eq("id", Number(id))
      .maybeSingle(),
    supabase
      .from("bulk_email_recipients")
      .select("id, email, first_name, status, error")
      .eq("bulk_email_id", Number(id))
      .order("id"),
  ]);
  // Not theirs to see (or no such send): the database returned nothing.
  if (!email) notFound();
  const recipients = (rows ?? []) as Recipient[];
  const count = (status: string) => recipients.filter((r) => r.status === status).length;
  const sent = count("sent");
  const failed = recipients.filter((r) => r.status === "failed");
  const pending = count("queued") + count("sending");
  const event = email.event as unknown as { name: string } | null;
  const signature = signatureLines(email.sender_name as string, email.chapter as string | null);
  const back =
    email.source === "roster" && email.event_id
      ? { href: `/protected/admin/events/${email.event_id}`, label: `Back to ${event?.name ?? "the event"}` }
      : { href: `/protected/members${email.chapter ? `?chapter=${encodeURIComponent(email.chapter as string)}` : ""}`, label: "Back to Members" };

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={pending > 0} />
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold">{sent}</p>
            <p className="text-sm text-muted-foreground">sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className={failed.length > 0 ? "text-2xl font-bold text-red-600" : "text-2xl font-bold"}>{failed.length}</p>
            <p className="text-sm text-muted-foreground">failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold">{pending}</p>
            <p className="text-sm text-muted-foreground">still sending</p>
          </CardContent>
        </Card>
      </div>
      {pending > 0 ? (
        <p className="text-sm text-muted-foreground">
          Sending one at a time. You can leave this page: it keeps going, and big lists finish within a few minutes.
        </p>
      ) : (
        <p className="text-sm">
          Done. {sent > 0 ? "Each person it reached shows this email as their latest outreach." : ""}
        </p>
      )}

      {failed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Didn&apos;t send ({failed.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y text-sm">
              {failed.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 py-2 [overflow-wrap:anywhere]">
                  <span className="font-medium">
                    {r.first_name ? `${r.first_name} · ` : ""}
                    {r.email}
                  </span>
                  <span className="text-muted-foreground">{r.error ?? "Unknown error"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{email.subject as string}</CardTitle>
          <p className="text-sm text-muted-foreground">
            From {email.sender_name as string} · {formatEventInstant(email.created_at as string, "America/Denver")} · to{" "}
            {email.audience as string}
            {event ? ` at ${event.name}` : ""} ({email.recipient_count as number})
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="whitespace-pre-wrap">{email.body as string}</p>
          <p className="text-muted-foreground">
            {signature[0]}
            <br />
            {signature[1]}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href={back.href} className="underline underline-offset-4">
          {back.label}
        </Link>
        <Link
          href={email.source === "roster" && email.event_id ? `/protected/emails?event=${email.event_id}` : `/protected/emails${email.chapter ? `?chapter=${encodeURIComponent(email.chapter as string)}` : ""}`}
          className="underline underline-offset-4"
        >
          All emails sent
        </Link>
      </div>
    </div>
  );
}

/**
 * One Members or roster email (lib/bulk-email.ts): how many sent, which
 * failed and why, and the message. Refreshes itself while it's still
 * going out. Visible to the sender, admins, and whoever can see that
 * chapter on Members or manage that event (can_view_bulk_email).
 */
export default function EmailResultPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-3xl flex-1 flex-col gap-6">
      <h1 className="text-2xl font-bold">Email</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EmailResult params={params} />
      </Suspense>
    </div>
  );
}
