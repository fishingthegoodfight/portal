"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { setBudgetAction } from "@/lib/actions/therapy-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One calendar year's scholarship budget. Blank clears it. */
export function TherapyBudgetForm({ year, budgetCents }: { year: number; budgetCents: number | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(budgetCents === null ? "" : (budgetCents / 100).toFixed(2).replace(/\.00$/, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await setBudgetAction(year, amount);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`budget_${year}`}>{year} scholarship budget ($)</Label>
        <Input
          id={`budget_${year}`}
          inputMode="decimal"
          placeholder="e.g. 15000"
          className="w-40"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
      {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
      {error && <span className="text-sm text-red-500">{error}</span>}
    </form>
  );
}
