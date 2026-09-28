import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { VolunteerRegistrationForm } from "@/components/volunteer-registration-form";
import { formatPhoneNumber } from "@/lib/phone";
import { formatDateInZone } from "@/lib/format-date";
import {
  EMPTY_EXPERIENCE,
  experienceFromRow,
  type ExperienceRow,
  type InterestArea,
} from "@/lib/volunteer-applications";
import { prefillFromApplication, type RegistrationPrefill } from "@/lib/registration-prefill";

async function RegisterLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }
  const userId = data.claims.sub as string;

  const [{ data: volunteer }, { data: profile }, { data: details }] = await Promise.all([
    supabase.from("volunteers").select("status, registered_at").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("volunteer_registration_details").select("*").eq("volunteer_id", userId).maybeSingle(),
  ]);

  // Only reachable by someone with a volunteers row — anyone else (a
  // participant who just wandered here, or typed the URL) sees a short
  // explanation instead of the form.
  if (!volunteer) {
    return (
      <div className="max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Volunteer registration</h1>
        <p className="text-sm text-muted-foreground">
          Volunteer registration is by invitation only. If you&apos;d like to volunteer with
          Fishing the Good Fight, contact{" "}
          <a href="mailto:tcramer@fishingthegoodfight.org" className="underline underline-offset-4">
            tcramer@fishingthegoodfight.org
          </a>
          .
        </p>
      </div>
    );
  }

  const prefill = await loadPrefill(supabase, volunteer.registered_at as string | null);

  return (
    <>
      <div>
        <h1 className="font-bold text-2xl mb-1">Volunteer registration</h1>
        <p className="text-sm text-muted-foreground">
          A few questions, a waiver to sign, and you&apos;re set.
        </p>
      </div>
      <VolunteerRegistrationForm
        userId={userId}
        // Not status: a backfilled or imported volunteer is already
        // 'approved' but has never been through this form.
        alreadyRegistered={volunteer.registered_at != null}
        initialProfile={{
          first_name: profile?.first_name ?? "",
          last_name: profile?.last_name ?? "",
          email: profile?.email ?? (data.claims.email as string | undefined) ?? "",
          phone: formatPhoneNumber(profile?.phone ?? ""),
          address_line1: profile?.address_line1 ?? "",
          address_line2: profile?.address_line2 ?? "",
          city: profile?.city ?? "",
          state: profile?.state ?? "",
          postal_code: profile?.postal_code ?? "",
          emergency_contact: profile?.emergency_contact ?? "",
          emergency_phone: formatPhoneNumber(profile?.emergency_phone ?? ""),
          emergency_contact_relationship: profile?.emergency_contact_relationship ?? "",
          emergency_contact_2: profile?.emergency_contact_2 ?? "",
          emergency_phone_2: formatPhoneNumber(profile?.emergency_phone_2 ?? ""),
          emergency_contact_2_relationship: profile?.emergency_contact_2_relationship ?? "",
          chapter: profile?.chapter ?? "",
          tshirt_size: profile?.tshirt_size ?? "",
          favorite_snack: profile?.favorite_snack ?? "",
          favorite_na_beverage: profile?.favorite_na_beverage ?? "",
          skill_interests: prefill?.skillInterests ?? profile?.skill_interests ?? [],
          skill_interests_other: prefill?.skillInterestsOther ?? profile?.skill_interests_other ?? "",
          program_interests: prefill?.programInterests ?? profile?.program_interests ?? [],
        }}
        initialExperience={
          prefill?.experience ?? (details ? experienceFromRow(details as ExperienceRow) : EMPTY_EXPERIENCE)
        }
        prefilledFrom={prefill ? { appliedOn: prefill.appliedOn } : null}
      />
    </>
  );
}

/**
 * Their approved application's answers, when they haven't registered since
 * it was approved (never, or only before — a former volunteer approved
 * again). Otherwise null: the form starts from what they saved last time.
 */
async function loadPrefill(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registeredAt: string | null,
): Promise<RegistrationPrefill | null> {
  const { data: applications } = await supabase.rpc("my_volunteer_applications");
  const approved = ((applications ?? []) as { id: number; status: string; status_changed_at: string }[])
    .filter((a) => a.status === "approved")
    .sort((a, b) => Date.parse(b.status_changed_at) - Date.parse(a.status_changed_at))[0];
  if (!approved) return null;
  if (registeredAt && Date.parse(registeredAt) >= Date.parse(approved.status_changed_at)) return null;

  const [{ data: rows }, { data: areas }] = await Promise.all([
    supabase.rpc("my_volunteer_application", { p_id: approved.id }),
    // Turned-off areas too: the application keeps what it picked.
    supabase.from("volunteer_interest_areas").select("id, kind, label"),
  ]);
  const app = ((rows ?? []) as Parameters<typeof prefillFromApplication>[0][])[0];
  if (!app) return null;
  return {
    ...prefillFromApplication(app, (areas ?? []) as Pick<InterestArea, "id" | "kind" | "label">[]),
    appliedOn: formatDateInZone(app.submitted_at, "America/Denver"),
  };
}

export default function VolunteerRegisterPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RegisterLoader />
      </Suspense>
    </div>
  );
}
