import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { screeningToInput, type ScreeningRecord } from "@/lib/volunteer-screenings";
import { ScreeningForm } from "@/components/admin/screening-form";
import { loadScreeningReference } from "@/lib/admin/screening-reference";

/** Editing a screening: its recorder or any admin (the database enforces
 * the same). */
async function EditScreeningLoader({ params }: { params: Promise<{ id: string; screeningId: string }> }) {
  const { id, screeningId } = await params;
  const applicationId = Number(id);
  const recordId = Number(screeningId);
  if (!Number.isInteger(applicationId) || !Number.isInteger(recordId)) notFound();

  const supabase = await createClient();
  const [{ data: row }, loaded, access] = await Promise.all([
    // RLS: only returned to someone who can see screenings for it.
    supabase.from("volunteer_screenings").select("*").eq("id", recordId).eq("application_id", applicationId).maybeSingle(),
    loadScreeningReference(supabase, applicationId),
    loadEventAdminAccess(supabase),
  ]);
  if (!loaded || !row) notFound();
  const record = row as ScreeningRecord;
  if (!(access?.isAdmin || record.recorded_by === access?.userId)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only the person who recorded this call, or an admin, can edit it.
      </p>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Edit screening call — {loaded.fullName}</h1>
      <ScreeningForm
        applicationId={applicationId}
        screeningId={recordId}
        initial={screeningToInput(record)}
        retreatTrack={record.retreat_track}
        canDecline={access?.isAdmin ?? false}
        reference={loaded.reference}
        roleTypes={loaded.roleTypes}
      />
    </>
  );
}

export default function EditScreeningPage({ params }: { params: Promise<{ id: string; screeningId: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <Suspense fallback={null}>
        <Back params={params} />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <EditScreeningLoader params={params} />
      </Suspense>
    </div>
  );
}

async function Back({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Link href={`/protected/admin/applications/${id}`} className="text-sm underline underline-offset-4">
      ← Back to the application
    </Link>
  );
}
