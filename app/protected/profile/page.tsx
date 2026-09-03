import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";
import { formatPhoneNumber } from "@/lib/phone";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";

// Only ever redirect back into our own /protected pages — a bare "starts
// with /protected/" check keeps this from being turned into an open redirect
// via a return_to like "https://evil.example" or "//evil.example".
function safeReturnTo(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith("/protected/") ? value : null;
}

async function ProfileFormLoader({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const returnTo = safeReturnTo(return_to);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = data.claims.sub as string;
  const userEmail = data.claims.email as string;

  // select("*") rather than an explicit column list so a new registration
  // section's profile column (see lib/registration-sections.ts) is picked up
  // here automatically, same as the RSVP page loader does.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  // Every registration field's current value, keyed by its profile column —
  // formatted (e.g. the phone mask) in case a stored value predates that
  // formatting, same as the RSVP page does for its own initial values.
  const registrationFields: Record<string, string> = {};
  for (const section of REGISTRATION_SECTIONS) {
    for (const field of section.fields) {
      const raw = (profile?.[field.key] as string | null) ?? "";
      registrationFields[field.key] = field.format ? field.format(raw) : raw;
    }
  }

  return (
    <ProfileForm
      userId={userId}
      returnTo={returnTo}
      initialProfile={{
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? userEmail ?? "",
        // Reformat in case the stored value predates the phone mask (e.g.
        // pasted or entered before this field forced a format) so the
        // display is always standardized, not just newly-typed input.
        phone: formatPhoneNumber(profile?.phone ?? ""),
        chapter: profile?.chapter ?? "",
        address_line1: profile?.address_line1 ?? "",
        address_line2: profile?.address_line2 ?? "",
        city: profile?.city ?? "",
        state: profile?.state ?? "",
        postal_code: profile?.postal_code ?? "",
      }}
      initialRegistrationFields={registrationFields}
    />
  );
}

export default function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
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
        <ProfileFormLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
