import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadReport } from "@/lib/therapy-access";
import { todayInZone } from "@/lib/format-date";
import {
  formatCents,
  isReportGrain,
  periodLabel,
  PROGRAM_LABELS,
  REPORT_GRAINS,
  reportRange,
  type ReportGrain,
  type ReportRow,
} from "@/lib/therapy-support";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { TherapyReportExport } from "@/components/admin/therapy-report-export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const BASE_PATH = "/protected/admin/therapy/reports";
const GRAIN_LABELS: Record<ReportGrain, string> = { month: "By month", quarter: "By quarter", year: "Whole year" };

type SearchParams = { year?: string; grain?: string };

function rowLabel(r: ReportRow): string {
  if (r.level === "total") return "Both programs";
  if (r.level === "program") return PROGRAM_LABELS[r.program!];
  if (r.level === "region") return r.region ?? "";
  return r.chapter ?? "";
}

/** One period's table: both programs, then each program with its regions
 * and their chapters (the order the database returns them in). */
function PeriodTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium" />
            <th className="py-1.5 pr-3 text-right font-medium">Participants</th>
            <th className="py-1.5 pr-3 text-right font-medium">Sessions</th>
            <th className="py-1.5 pr-3 text-right font-medium">Dollars paid</th>
            <th className="py-1.5 text-right font-medium">Renewals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.level}-${r.program}-${r.region}-${r.chapter}`}
              className={cn(
                "border-b last:border-b-0",
                (r.level === "total" || r.level === "program") && "font-medium",
                r.level === "chapter" && "text-muted-foreground",
              )}
            >
              <td className={cn("py-1.5 pr-3", r.level === "region" && "pl-4", r.level === "chapter" && "pl-8")}>{rowLabel(r)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.participants}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.sessions}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.program === "partner" ? "—" : formatCents(r.dollars_cents)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.renewals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Counts only, no names; not logged. */
async function ReportLoader({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { year: yearParam, grain: grainParam } = await searchParams;
  const thisYear = Number(todayInZone("America/Denver").slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : thisYear;
  const grain: ReportGrain = isReportGrain(grainParam) ? grainParam : "quarter";

  const supabase = await createClient();
  const { from, to } = reportRange(year);
  const result = await loadReport(supabase, from, to, grain);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load the report: {result.error}</p>;

  const periods = [...new Set(result.data.map((r) => r.period))];
  const href = (next: { year?: number; grain?: ReportGrain }) => {
    const y = next.year ?? year;
    const g = next.grain ?? grain;
    return filterHref(BASE_PATH, { year: y === thisYear ? undefined : String(y), grain: g === "quarter" ? undefined : g });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Year" className="flex flex-wrap gap-2">
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <FilterPill key={y} href={href({ year: y })} active={year === y}>
              {y}
            </FilterPill>
          ))}
        </div>
        <div role="group" aria-label="Grouping" className="flex flex-wrap gap-2">
          {REPORT_GRAINS.map((g) => (
            <FilterPill key={g} href={href({ grain: g })} active={grain === g}>
              {GRAIN_LABELS[g]}
            </FilterPill>
          ))}
        </div>
      </div>

      <TherapyReportExport year={year} grain={grain} />

      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in {year} yet.</p>
      ) : (
        periods.map((period) => (
          <Card key={period}>
            <CardHeader>
              <CardTitle>{periodLabel(period, grain)}</CardTitle>
            </CardHeader>
            <CardContent>
              <PeriodTable rows={result.data.filter((r) => r.period === period)} />
            </CardContent>
          </Card>
        ))
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>Participants: different people with at least one session in the period. Sessions: sessions dated in the period.</p>
        <p>
          Dollars paid: scholarship sessions paid in the period, by the date paid. Renewals: renewals approved in the period.
        </p>
        <p>Chapter and region are as they were when the person sent their request. Someone since deleted still counts.</p>
      </div>
    </div>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <div className="flex w-full flex-col gap-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ReportLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
