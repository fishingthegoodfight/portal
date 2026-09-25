"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { withdrawApplicationAction } from "@/lib/actions/volunteer-applications";
import { Button } from "@/components/ui/button";

/** The applicant withdrawing their own application — asks once first. */
export function WithdrawApplicationButton({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    const result = await withdrawApplicationAction(applicationId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Withdraw your application? You can apply again later.</span>
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={withdraw}>
            {busy ? "Withdrawing..." : "Yes, withdraw"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Withdraw application
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
