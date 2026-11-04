"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { confirmRetreatHealthFormAction } from "@/lib/actions/retreat-registration";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrecheckState } from "@/lib/retreat-registration";
import { cn } from "@/lib/utils";

/**
 * The pre-retreat check, for a confirmed participant: one task, opening 21
 * days before the retreat and due 14 days before. Step 1 is the health
 * form (confirm it's still right, or fill in a new one); the wellness form
 * will be step 2 of the same check.
 */
export function PrecheckCard({
  eventId,
  phase,
  state,
  opensLabel,
  dueLabel,
  formSignedLabel,
  newFormHref,
}: {
  eventId: number;
  /** Before it opens, open, or past the due date. */
  phase: "not_open" | "open" | "overdue";
  state: PrecheckState;
  opensLabel: string;
  dueLabel: string;
  formSignedLabel: string | null;
  newFormHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "not_open") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pre-retreat check</CardTitle>
          <CardDescription>
            Opens {opensLabel}, and is due by {dueLabel}. We&apos;ll email you when it opens. It takes a few minutes, and
            we need it two weeks ahead so the team can review and prepare.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card className="border-l-4 border-l-green-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-green-600" aria-hidden />
            Pre-retreat check complete
          </CardTitle>
          <CardDescription>Thank you. If anything changes before the retreat, submit a new health form.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await confirmRetreatHealthFormAction(eventId);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  };

  return (
    <Card className={cn("border-l-4", phase === "overdue" ? "border-l-red-600" : "border-l-amber-500")}>
      <CardHeader>
        <CardTitle>{phase === "overdue" ? "Overdue: your pre-retreat check" : "Action needed: your pre-retreat check"}</CardTitle>
        <CardDescription className={cn(phase === "overdue" && "font-medium text-red-700 dark:text-red-400")}>
          {phase === "overdue"
            ? `This was due ${dueLabel}. Please complete it today: the team can't finish preparing without it.`
            : `Due by ${dueLabel}. We need it two weeks before the retreat so the team has time to review and prepare.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="font-medium">Step 1: your health form</p>
        {state === "needs_confirm" ? (
          <>
            <p>
              Your health form was signed {formSignedLabel}. Look it over, then tell us whether it&apos;s still right.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/protected/profile/medical">Look over my form</Link>
              </Button>
              <Button size="sm" disabled={busy} onClick={confirm}>
                {busy ? "Saving..." : "Nothing has changed"}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={newFormHref}>Something&apos;s changed: fill in a new form</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>Your health form on file doesn&apos;t cover this retreat any more, so we need a new one.</p>
            <div>
              <Button asChild size="sm">
                <Link href={newFormHref}>Fill in a new health form</Link>
              </Button>
            </div>
          </>
        )}
        {error && <p className="text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
