import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { VolunteerRegistrationForm } from "@/components/volunteer-registration-form";
import { formatPhoneNumber } from "@/lib/phone";

async function RegisterLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }
  const userId = data.claims.sub as string;

  const [{ data: volunteer }, { data: profile }] = await Promise.all([
    supabase.from("volunteers").select("status").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
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
        alreadyRegistered={volunteer.status !== "invited"}
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
          emergency_phone: profile?.emergency_phone ?? "",
          chapter: profile?.chapter ?? "",
          tshirt_size: profile?.tshirt_size ?? "",
          favorite_snack: profile?.favorite_snack ?? "",
          favorite_na_beverage: profile?.favorite_na_beverage ?? "",
          skill_interests: profile?.skill_interests ?? [],
          skill_interests_other: profile?.skill_interests_other ?? "",
          program_interests: profile?.program_interests ?? [],
        }}
      />
    </>
  );
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
