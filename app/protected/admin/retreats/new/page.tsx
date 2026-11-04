import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { AdminOnlyGate } from "@/components/admin/admin-only-gate";
import { RetreatCoreForm } from "@/components/admin/retreat-forms";
import { Card, CardContent } from "@/components/ui/card";
import { loadRegionsAndChapters } from "@/lib/chapters";
import { retreatFormOptions } from "../options";

async function NewRetreatLoader() {
  const supabase = await createClient();
  const { regions, chapters } = await loadRegionsAndChapters(supabase);
  const options = retreatFormOptions(regions, chapters);
  return (
    <RetreatCoreForm
      eventId={null}
      initial={{
        name: "",
        regionId: "",
        startDate: "",
        startTime: "15:00",
        endDate: "",
        endTime: "11:00",
        timezone: options.timezones[0]?.value ?? "America/Denver",
        description: "",
        capacity: "",
        waiverState: "",
        leadName: "",
        leadEmail: "",
        leadPhone: "",
        leadUserId: "",
      }}
      {...options}
      canChangeAdminFields
    />
  );
}

export default function NewRetreatPage() {
  return (
    <AdminOnlyGate>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">New retreat</h1>
          <p className="text-sm text-muted-foreground">
            It starts unpublished. Add the lodging, sessions and prices on the next page, then publish it.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
              <NewRetreatLoader />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </AdminOnlyGate>
  );
}
