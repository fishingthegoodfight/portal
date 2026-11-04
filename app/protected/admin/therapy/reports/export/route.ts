import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canManageTherapySupport, loadReport, loadReportPeople } from "@/lib/therapy-access";
import { isReportGrain, periodLabel, PROGRAM_LABELS, reportRange, type SupportProgram } from "@/lib/therapy-support";

/** One CSV cell: quoted when it has a comma, quote or line break; a leading
 * =, +, - or @ is prefixed so a spreadsheet doesn't run it as a formula. */
function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const dollars = (cents: number) => (cents / 100).toFixed(2);
const program = (p: SupportProgram | null) => (p ? PROGRAM_LABELS[p] : "Both programs");

/**
 * Therapy Support's grant-reporting export. Counts only by default; with
 * names=1, one row per person instead (therapy_admin_report_people, which
 * logs "export"). Anyone without access gets "not found", the same as the
 * pages, and the database refuses them regardless.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!(await canManageTherapySupport(supabase))) return new NextResponse("Not found", { status: 404 });

  const params = request.nextUrl.searchParams;
  const year = Number(params.get("year"));
  const grainParam = params.get("grain");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return new NextResponse("Choose a year", { status: 400 });
  const grain = isReportGrain(grainParam) ? grainParam : "quarter";
  const { from, to } = reportRange(year);
  const names = params.get("names") === "1";

  let body: string;
  if (names) {
    const result = await loadReportPeople(supabase, from, to);
    if (!result.ok) return new NextResponse(result.error, { status: 500 });
    body = csv([
      ["Year", "Name", "Program", "Region", "Chapter", "Sessions", "Dollars paid", "Renewals approved"],
      ...result.data.map((r) => [year, r.name, program(r.program), r.region, r.chapter, r.sessions, dollars(r.dollars_cents), r.renewals]),
    ]);
  } else {
    const result = await loadReport(supabase, from, to, grain);
    if (!result.ok) return new NextResponse(result.error, { status: 500 });
    body = csv([
      ["Period", "Period start", "Level", "Program", "Region", "Chapter", "Unique participants", "Sessions funded", "Dollars paid", "Renewals approved"],
      ...result.data.map((r) => [
        periodLabel(r.period, grain),
        r.period,
        r.level,
        program(r.program),
        r.region,
        r.chapter,
        r.participants,
        r.sessions,
        dollars(r.dollars_cents),
        r.renewals,
      ]),
    ]);
  }

  const filename = `ftgf-support-${year}-${names ? "with-names" : grain}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
