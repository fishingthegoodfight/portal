import { Suspense } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadWalkupWelcomeCandidates } from "@/lib/walkup-welcome";
import { formatDateInZone } from "@/lib/format-date";
import { WalkupWelcomeCatchUp } from "@/components/admin/walkup-welcome-catch-up";

async function CandidatesLoader() {
  // Admins only (the Setup layout's gate); read with the service role
  // because the list needs auth.users (walkup_welcome_candidates).
  let candidates;
  try {
    candidates = await loadWalkupWelcomeCandidates(createAdminClient());
  } catch (err) {
    return (
      <p className="text-sm text-red-500">
        Couldn&apos;t load the list: {err instanceof Error ? err.message : String(err)}
      </p>
    );
  }
  return (
    <WalkupWelcomeCatchUp
      people={candidates.map((c) => ({
        userId: c.userId,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email,
        email: c.email,
        eventName: c.eventName,
        eventDate: formatDateInZone(c.eventStartsAt, c.timeZone),
      }))}
    />
  );
}

export default function WalkupWelcomePage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Walk-up welcome emails</h1>
        <p className="text-sm text-muted-foreground">
          A walk-up for someone with no account creates one for them, with no password they know.
          The morning after the event they&apos;re sent a short welcome from the chapter with a link
          to set one. This list is everyone who should have had it and hasn&apos;t: accounts made at
          a walk-up before the automatic email existed, or ones it couldn&apos;t reach. Anyone who
          has signed in since isn&apos;t listed.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Not covered: an email address typed wrong at the desk. The send goes nowhere and nothing
          here shows it, so a typo looks the same as someone who just hasn&apos;t replied.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <CandidatesLoader />
      </Suspense>
    </div>
  );
}
