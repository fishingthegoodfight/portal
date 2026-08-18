import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";
import { formatPhoneNumber } from "@/lib/phone";

async function ProfileFormLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;
  const userEmail = data.claims.email as string;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, email, phone, chapter, emergency_contact, emergency_phone, address_line1, address_line2, city, state, postal_code",
    )
    .eq("id", userId)
    .maybeSingle();

  return (
    <ProfileForm
      userId={userId}
      initialProfile={{
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? userEmail ?? "",
        // Reformat in case the stored value predates the phone mask (e.g.
        // pasted or entered before this field forced a format) so the
        // display is always standardized, not just newly-typed input.
        phone: formatPhoneNumber(profile?.phone ?? ""),
        chapter: profile?.chapter ?? "",
        emergency_contact: profile?.emergency_contact ?? "",
        emergency_phone: formatPhoneNumber(profile?.emergency_phone ?? ""),
        address_line1: profile?.address_line1 ?? "",
        address_line2: profile?.address_line2 ?? "",
        city: profile?.city ?? "",
        state: profile?.state ?? "",
        postal_code: profile?.postal_code ?? "",
      }}
    />
  );
}

export default function ProfilePage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-lg">
      <div>
        <h1 className="font-bold text-2xl mb-1">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          Keep your contact details up to date. This information is used to
          pre-fill RSVPs and volunteer signups.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ProfileFormLoader />
      </Suspense>
    </div>
  );
}
