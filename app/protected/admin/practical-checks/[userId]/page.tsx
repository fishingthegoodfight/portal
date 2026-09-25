import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { loadPracticalChecks } from "@/lib/admin/practical-checks";
import { PracticalChecksPanel } from "@/components/admin/practical-checks-panel";
import { Card, CardContent } from "@/components/ui/card";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person's practical instruction checks — linked from rosters, the
 * application page and the volunteer record. For admins, and chapter leads
 * for anyone with an application in or on a roster of one of their chapters
 * (can_record_practical_check).
 */
async function PracticalCheckLoader({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!UUID_PATTERN.test(userId)) notFound();

  const supabase = await createClient();
  const [{ data: allowed }, access] = await Promise.all([
    supabase.rpc("can_record_practical_check", { p_user_id: userId }),
    loadEventAdminAccess(supabase),
  ]);
  if (!allowed) {
    return <p className="text-sm text-muted-foreground">You can&apos;t see practical checks for this person.</p>;
  }

  const [{ checks, recorderNames }, { data: person }, { data: application }, { data: me }] = await Promise.all([
    loadPracticalChecks(supabase, userId),
    supabase.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle(),
    supabase.from("volunteer_applications").select("full_name").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("profiles").select("first_name, last_name").eq("id", access?.userId ?? "").maybeSingle(),
  ]);
  const name =
    [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
    (application?.full_name as string | undefined) ||
    "This person";

  return (
    <>
      <h1 className="text-2xl font-bold">Practical instruction check — {name}</h1>
      <p className="text-sm text-muted-foreground">
        Forty-five minutes on the water with an experienced instructor, where they teach the assessor
        as though they were a beginner. Required before a Fishing Instructor works a retreat or any
        event that requires health history. The latest check is the one that counts.
      </p>
      <Card>
        <CardContent className="pt-6">
          <PracticalChecksPanel
            userId={userId}
            checks={checks}
            recorderNames={recorderNames}
            canRecord
            defaultAssessor={[me?.first_name, me?.last_name].filter(Boolean).join(" ")}
          />
        </CardContent>
      </Card>
    </>
  );
}

export default function PracticalCheckPage({ params }: { params: Promise<{ userId: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-4 max-w-2xl">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PracticalCheckLoader params={params} />
      </Suspense>
    </div>
  );
}
