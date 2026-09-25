import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadMyHealthHistory } from "@/lib/health-access";
import { HealthHistoryView } from "@/components/health-history-view";

/** One of your own submissions. Reading it is logged as self_view — kept
 * apart from staff access in the log. */
async function OwnHealthFormLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recordId = Number(id);
  if (!Number.isInteger(recordId)) notFound();

  const supabase = await createClient();
  const result = await loadMyHealthHistory(supabase, recordId);
  if (!result.ok) {
    return <p className="text-sm text-red-500">Couldn&apos;t load this form. Try again in a moment.</p>;
  }
  if (!result.data) notFound();
  return <HealthHistoryView record={result.data} />;
}

export default function OwnHealthFormPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <Link href="/protected/profile/medical" className="text-sm underline underline-offset-4">
          ← Medical information
        </Link>
        <h1 className="mt-2 font-bold text-2xl">Your health form</h1>
        <p className="text-sm text-muted-foreground">
          What you submitted, exactly as saved. Forms can&apos;t be edited — if something&apos;s wrong
          in this year&apos;s, submit a corrected one.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <OwnHealthFormLoader params={params} />
      </Suspense>
    </div>
  );
}
