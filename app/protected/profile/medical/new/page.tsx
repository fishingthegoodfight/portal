import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { healthFormYearFor } from "@/lib/health-requirements";
import { HealthHistoryForm } from "@/components/health-history-form";
import { formatPhoneNumber } from "@/lib/phone";
import { safeNext } from "@/lib/safe-next";

async function NewHealthFormLoader({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  const userId = data.claims.sub as string;

  // Only the profile's emergency contacts are pre-filled (they're the live,
  // roster-visible ones). Nothing from an earlier year's form is.
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "chapter, emergency_contact, emergency_phone, emergency_contact_relationship, emergency_contact_2, emergency_phone_2, emergency_contact_2_relationship",
    )
    .eq("id", userId)
    .maybeSingle();

  return (
    <HealthHistoryForm
      year={healthFormYearFor(profile?.chapter as string | null | undefined)}
      returnTo={safeNext(next) ?? "/protected/profile/medical"}
      contacts={{
        emergencyContactName: profile?.emergency_contact ?? "",
        emergencyContactPhone: formatPhoneNumber(profile?.emergency_phone ?? ""),
        emergencyContactRelationship: profile?.emergency_contact_relationship ?? "",
        emergencyContact2Name: profile?.emergency_contact_2 ?? "",
        emergencyContact2Phone: formatPhoneNumber(profile?.emergency_phone_2 ?? ""),
        emergencyContact2Relationship: profile?.emergency_contact_2_relationship ?? "",
      }}
    />
  );
}

export default function NewHealthFormPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <h1 className="font-bold text-2xl">Health form</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <NewHealthFormLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
