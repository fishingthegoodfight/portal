"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { saveTherapySettingsAction, setTherapyManagerAction } from "@/lib/actions/therapy-admin";
import type { TherapyManager } from "@/lib/therapy-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The scholarship flat rate and the partner office's monthly sessions. */
export function TherapySettingsForm({
  rateCents,
  partnerMonthlySessions,
}: {
  rateCents: number | null;
  partnerMonthlySessions: number;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(rateCents === null ? "" : (rateCents / 100).toFixed(2).replace(/\.00$/, ""));
  const [slots, setSlots] = useState(String(partnerMonthlySessions));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await saveTherapySettingsAction({ scholarshipRate: rate, partnerMonthlySessions: slots });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="scholarship_rate">Scholarship flat rate per session ($)</Label>
          <Input id="scholarship_rate" inputMode="decimal" placeholder="e.g. 60" value={rate} onChange={(e) => setRate(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            What FTGF pays the therapist. Each approval keeps the rate it was approved at.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="partner_slots">Partner office sessions per month</Label>
          <Input id="partner_slots" inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Once this month&apos;s logged sessions reach it, new referrals are waitlisted for next month.
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

/** Which admins have Therapy Support access. Only shown here. */
export function TherapyManagers({ managers, currentUserId }: { managers: TherapyManager[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (id: string, on: boolean) => {
    setBusy(id);
    setError(null);
    const result = await setTherapyManagerAction(id, on);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Removing your own access takes you out of this page.
    if (!on && id === currentUserId) {
      router.push("/protected/admin");
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y text-sm">
        {managers.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">{m.name || m.email}</span>
              {m.name && <span className="text-muted-foreground">{m.email}</span>}
              {m.id === currentUserId && <Badge variant="outline">You</Badge>}
              {m.hasAccess && <Badge>Has access</Badge>}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void toggle(m.id, !m.hasAccess)}
            >
              {busy === m.id ? "Saving..." : m.hasAccess ? "Remove access" : "Give access"}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
