import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import type { DuplicatePair } from "@/lib/person-merge";
import { DuplicatePairs } from "@/components/admin/duplicate-pairs";

async function PairsLoader() {
  // Admins only (the Setup layout's gate, and admin_possible_duplicates
  // checks again).
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_possible_duplicates");
  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the list: {error.message}</p>;
  }
  return <DuplicatePairs pairs={(data ?? []) as DuplicatePair[]} />;
}

export default function DuplicatesPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Duplicate profiles</h1>
        <p className="text-sm text-muted-foreground">
          Profiles that look like the same person signing in with two emails: the same first and last name, or the
          same phone number. Compare a pair to merge it into one profile, or mark it as two different people so it
          isn&apos;t suggested again. Spotted one this list misses? Use &ldquo;Merge with another profile&rdquo; on
          their page.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PairsLoader />
      </Suspense>
    </div>
  );
}
