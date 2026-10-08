"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { verifyCertificationAction } from "@/lib/actions/certifications";
import { Button } from "@/components/ui/button";

/**
 * An admin's controls for one certification: open the file (a short-lived
 * link, /protected/certifications/[id]/file) and mark it verified. Shown on
 * the Certifications screen and a volunteer's admin page.
 */
export function CertificationActions({
  certId,
  hasFile,
  verifiedLabel,
}: {
  certId: number;
  hasFile: boolean;
  /** "Verified Oct 8, 2026 by …", or null when not verified yet. */
  verifiedLabel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setBusy(true);
    setError(null);
    const result = await verifyCertificationAction(certId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {hasFile ? (
          <a
            href={`/protected/certifications/${certId}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            View file
          </a>
        ) : (
          <span className="text-muted-foreground">No file</span>
        )}
        {verifiedLabel ? (
          <span className="text-muted-foreground">{verifiedLabel}</span>
        ) : (
          <Button size="sm" variant="outline" disabled={busy || !hasFile} onClick={verify}>
            {busy ? "Verifying..." : "Mark verified"}
          </Button>
        )}
      </div>
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}
