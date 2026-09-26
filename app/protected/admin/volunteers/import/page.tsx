import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { VolunteerImport } from "@/components/admin/volunteer-import";

// Server Actions on this page take the page's limit — a chunk of
// IMPORT_CHUNK_SIZE new accounts can take a while.
export const maxDuration = 120;

async function ImportLoader() {
  const supabase = await createClient();
  const { data: roleTypes } = await supabase
    .from("volunteer_role_types")
    .select("name")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return <VolunteerImport activeRoleNames={(roleTypes ?? []).map((r) => r.name as string)} />;
}

export default function ImportVolunteersPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <div>
        <Link href="/protected/admin/volunteers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Volunteers
        </Link>
        <h1 className="mt-2 mb-1 text-2xl font-bold">Import volunteers</h1>
        <p className="text-sm text-muted-foreground">
          Bring in an existing roster from a CSV file. Nothing is written until you confirm the preview.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ImportLoader />
      </Suspense>
    </div>
  );
}
