"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { dismissDuplicateAction } from "@/lib/actions/person-merge";
import { formatDateInZone } from "@/lib/format-date";
import type { DuplicatePair, DuplicateSide } from "@/lib/person-merge";
import { ROLE_LABELS } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const REASON_LABELS: Record<DuplicatePair["reasons"][number], string> = {
  name: "Same name",
  phone: "Same phone",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function SideSummary({ side }: { side: DuplicateSide }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/protected/admin/people/${side.id}`} className="font-medium hover:underline">
          {side.name ?? side.email ?? "Unnamed"}
        </Link>
        {side.role !== "participant" && <Badge variant="outline">{ROLE_LABELS[side.role]}</Badge>}
        {side.access_removed_at && (
          <Badge variant="outline" className="border-red-500/50 text-red-700 dark:text-red-400">
            Access removed
          </Badge>
        )}
      </span>
      <span className="break-words text-muted-foreground">
        {[side.email, side.phone, side.chapter].filter(Boolean).join(" · ")}
      </span>
      <span className="text-muted-foreground">
        {[
          side.created_at && `Created ${formatDateInZone(side.created_at, "America/Denver")}`,
          side.last_sign_in_at
            ? `last signed in ${formatDateInZone(side.last_sign_in_at, "America/Denver")}`
            : "never signed in",
          plural(side.rsvps, "RSVP", "RSVPs"),
          side.shifts > 0 && plural(side.shifts, "shift", "shifts"),
          side.volunteer_status && "volunteer",
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

/** Setup → Duplicate profiles: each likely pair, with Compare and merge
 * and "Not the same person" (which stops suggesting it). */
export function DuplicatePairs({ pairs }: { pairs: DuplicatePair[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const dismiss = async (pair: DuplicatePair, key: string) => {
    setBusy(key);
    setError(null);
    const result = await dismissDuplicateAction(pair.a.id, pair.b.id);
    setBusy(null);
    if (!result.ok) {
      setError({ key, message: result.error });
      return;
    }
    router.refresh();
  };

  if (pairs.length === 0) {
    return <p className="text-sm text-muted-foreground">No likely duplicates right now.</p>;
  }

  return (
    <ul className="flex flex-col gap-3 text-sm">
      {pairs.map((pair) => {
        const key = `${pair.a.id}:${pair.b.id}`;
        return (
          <li key={key} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              {pair.reasons.map((r) => (
                <Badge key={r} variant="secondary">
                  {REASON_LABELS[r]}
                </Badge>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SideSummary side={pair.a} />
              <SideSummary side={pair.b} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/protected/admin/people/${pair.a.id}/merge?with=${pair.b.id}`}>Compare and merge</Link>
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy === key} onClick={() => dismiss(pair, key)}>
                {busy === key ? "Saving..." : "Not the same person"}
              </Button>
            </div>
            {error?.key === key && (
              <p role="alert" className="text-red-700 dark:text-red-400">
                {error.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
