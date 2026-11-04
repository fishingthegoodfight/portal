import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadBudget } from "@/lib/therapy-access";
import { todayInZone } from "@/lib/format-date";
import { formatCents } from "@/lib/therapy-support";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { TherapyBudgetForm } from "@/components/admin/therapy-budget-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BASE_PATH = "/protected/admin/therapy/budget";

/** One figure of the summary. */
function Figure({ label, cents, hint, tone }: { label: string; cents: number; hint: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-400")}>
        {cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents)}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

/** The scholarship budget for a calendar year: committed, owed, spent and
 * what's left. Counts only; not logged. */
async function BudgetLoader({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yearParam } = await searchParams;
  const thisYear = Number(todayInZone("America/Denver").slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : thisYear;

  const supabase = await createClient();
  const budget = await loadBudget(supabase, year);
  if (!budget) return <p className="text-sm text-red-500">Couldn&apos;t load the budget.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Year" className="flex flex-wrap gap-2">
        {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
          <FilterPill key={y} href={filterHref(BASE_PATH, { year: y === thisYear ? undefined : String(y) })} active={year === y}>
            {y}
          </FilterPill>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{year}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TherapyBudgetForm key={`${year}-${budget.budget_cents}`} year={year} budgetCents={budget.budget_cents} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Committed" cents={budget.committed_cents} hint="Sessions still to come on open approvals" />
            <Figure label="Owed" cents={budget.owed_cents} hint="Sessions logged, not yet paid" />
            <Figure label="Spent" cents={budget.spent_cents} hint="Sessions paid" />
            {budget.remaining_cents === null ? (
              <div className="flex flex-col gap-0.5 rounded-md border p-3">
                <span className="text-sm text-muted-foreground">Remaining</span>
                <span className="text-sm">No budget set for {year}</span>
              </div>
            ) : (
              <Figure
                label="Remaining"
                cents={budget.remaining_cents}
                hint={`Of ${formatCents(budget.budget_cents ?? 0)}`}
                tone={budget.remaining_cents < 0 ? "warn" : undefined}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Scholarships only (partner office sessions cost nothing). Each approval counts against the year it was
            approved in, including sessions and payments that happen the next year. {budget.approvals} approval
            {budget.approvals === 1 ? "" : "s"} in {year}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Budget</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <BudgetLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
