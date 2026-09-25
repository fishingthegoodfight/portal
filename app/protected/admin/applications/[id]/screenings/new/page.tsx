import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { emptyScreening, SCREENABLE_STATUSES } from "@/lib/volunteer-screenings";
import { ScreeningForm } from "@/components/admin/screening-form";
import { loadScreeningReference } from "@/lib/admin/screening-reference";

/** "Record screening call" — the screening flag AND being able to see the
 * application (can_record_screening), from Invited to schedule onward. */
async function NewScreeningLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId)) notFound();

  const supabase = await createClient();
  const [{ data: canRecord }, loaded, access] = await Promise.all([
    supabase.rpc("can_record_screening", { p_application_id: applicationId }),
    loadScreeningReference(supabase, applicationId),
    loadEventAdminAccess(supabase),
  ]);
  if (!loaded) notFound();
  if (!canRecord) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to screening calls.</p>;
  }
  if (!SCREENABLE_STATUSES.includes(loaded.status)) {
    return (
      <p className="text-sm text-muted-foreground">
        A screening call can be recorded once they&apos;ve been invited to schedule one.
      </p>
    );
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", access?.userId ?? "")
    .maybeSingle();
  const myName = [me?.first_name, me?.last_name].filter(Boolean).join(" ");

  return (
    <>
      <h1 className="text-2xl font-bold">Screening call — {loaded.fullName}</h1>
      <ScreeningForm
        applicationId={applicationId}
        screeningId={null}
        initial={emptyScreening(myName, new Date().toISOString().slice(0, 10))}
        retreatTrack={loaded.reference.interestedInRetreats}
        canDecline={access?.isAdmin ?? false}
        reference={loaded.reference}
        roleTypes={loaded.roleTypes}
      />
    </>
  );
}

export default function NewScreeningPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <Suspense fallback={null}>
        <Back params={params} />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <NewScreeningLoader params={params} />
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
