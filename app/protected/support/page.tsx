import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadMySupportRequests } from "@/lib/therapy-access";
import { formatDateInZone } from "@/lib/format-date";
import {
  PARTICIPANT_SHARE_DOLLARS,
  PROGRAM_LABELS,
  SESSIONS_PER_APPROVAL,
  STATUS_LABELS,
} from "@/lib/therapy-support";
import { SupportRenewalButton, SupportRequestForm } from "@/components/support-request-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const OPEN_STATUSES = new Set(["submitted", "approved", "waitlisted"]);

/**
 * The participant's side of Therapy Support: what the two programs are, the
 * request form, and their own requests — status and sessions used, nothing
 * else (my_support_requests()).
 */
async function SupportLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");

  const requests = await loadMySupportRequests(supabase);
  const hasOpen = requests.some((r) => OPEN_STATUSES.has(r.status));

  return (
    <div className="flex flex-col gap-6">
      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your requests</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {PROGRAM_LABELS[r.program]}
                    {r.isRenewal && " (renewal)"} · sent {formatDateInZone(r.submittedAt, "America/Denver")}
                  </span>
                  <Badge variant={OPEN_STATUSES.has(r.status) ? "default" : "secondary"}>{STATUS_LABELS[r.status]}</Badge>
                </div>
                {r.sessionsApproved !== null && (
                  <span className="text-muted-foreground">
                    {r.sessionsUsed} of {r.sessionsApproved} sessions used
                  </span>
                )}
                {r.canRenew && <SupportRenewalButton previousId={r.id} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ask for support</CardTitle>
        </CardHeader>
        <CardContent>
          {hasOpen ? (
            <p className="text-sm text-muted-foreground">
              You have a request open. We&apos;ll email you whenever its status changes, and you can
              always check it here.
            </p>
          ) : (
            <SupportRequestForm />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SupportPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div className="flex flex-col gap-3">
        <h1 className="font-bold text-2xl">Support</h1>
        <p className="text-sm">
          Time on the water helps, and sometimes talking with someone helps too. If cost is getting in
          the way of counseling, we&apos;d like to help.
        </p>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="font-medium">Already seeing a therapist?</p>
            <p className="mt-1 text-muted-foreground">
              We can help pay for your sessions. We pay your therapist directly, and you pay them at least $
              {PARTICIPANT_SHARE_DOLLARS} a session yourself.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium">Looking for someone to talk to?</p>
            <p className="mt-1 text-muted-foreground">
              We can connect you with our partner office, which sees people we refer at no cost to you.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Either way, it&apos;s up to {SESSIONS_PER_APPROVAL} sessions at a time, and you can ask for more
          after that. Your request is private: only a small support team sees it, never your chapter or
          event leads.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SupportLoader />
      </Suspense>
    </div>
  );
}
