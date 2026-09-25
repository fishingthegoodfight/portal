import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { formatDateInZone } from "@/lib/format-date";
import {
  APPLICATION_STATUS_FOR_APPLICANT,
  interestAreaLabel,
  type ApplicationStatus,
} from "@/lib/volunteer-applications";
import { ApplicationAnswers, type ApplicationAnswersData } from "@/components/application-answers";

/**
 * The applicant's own application, read-only — everything they submitted,
 * both references as typed, the status in plain language and the date.
 * Read through my_volunteer_application(), which never returns reference 1's
 * match against the volunteer roster, the decline reason, internal notes,
 * the history or anything from a screening call.
 */
async function OwnApplicationLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId)) notFound();

  const supabase = await createClient();
  const [{ data: rows }, { data: areas }] = await Promise.all([
    supabase.rpc("my_volunteer_application", { p_id: applicationId }),
    supabase.from("volunteer_interest_areas").select("id, label, description, sort_order").order("sort_order"),
  ]);
  const app = ((rows ?? []) as (ApplicationAnswersData & { status: ApplicationStatus })[])[0];
  if (!app) notFound();

  const interestAreaNames = ((areas ?? []) as { id: number; label: string; description: string | null }[])
    .filter((a) => app.interest_area_ids.includes(a.id))
    .map(interestAreaLabel);

  return (
    <>
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <p>
          <span className="font-medium">Sent {formatDateInZone(app.submitted_at, "America/Denver")}.</span>{" "}
          {APPLICATION_STATUS_FOR_APPLICANT[app.status]}
        </p>
        <p className="mt-1 text-muted-foreground">
          This is what you sent us, exactly as saved. It can&apos;t be edited — if something&apos;s
          changed, just tell us when we talk.
        </p>
      </div>
      <ApplicationAnswers app={app} interestAreaNames={interestAreaNames} />
    </>
  );
}

export default function OwnApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <Link href="/protected/volunteer" className="text-sm underline underline-offset-4">
          ← Volunteer
        </Link>
        <h1 className="mt-2 font-bold text-2xl">Your volunteer application</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <OwnApplicationLoader params={params} />
      </Suspense>
    </div>
  );
}
