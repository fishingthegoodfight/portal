import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { ChapterFilterPills, FilterPill, filterHref } from "@/components/filter-pills";
import { ChapterTag } from "@/components/chapter-tag";
import { Badge } from "@/components/ui/badge";
import {
  CHAPTER_FILTER_OPTIONS,
  chapterSelectionFor,
  chapterSelectionLabel,
  chapterSelectionParam,
  parseChapterSelection,
  type ChapterSelection,
} from "@/lib/chapters";
import { formatDateInZone } from "@/lib/format-date";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUSES,
  CLOSED_STATUSES,
  isApplicationStatus,
  type ApplicationStatus,
} from "@/lib/volunteer-applications";
import { cn } from "@/lib/utils";

const BASE_PATH = "/protected/admin/applications";

type Row = {
  id: number;
  full_name: string;
  chapters: string[];
  submitted_at: string;
  status: ApplicationStatus;
  ref1_matched_volunteer: boolean;
  attendance_target: number | null;
};

type SearchParams = { status?: string; chapter?: string };

/** "open" (everything not closed) is the default; "all" includes closed. */
type StatusFilter = ApplicationStatus | "open" | "all";

async function ApplicationsLoader({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { status: statusParam, chapter: chapterParam } = await searchParams;
  const supabase = await createClient();
  const access = await loadEventAdminAccess(supabase);
  const selection = parseChapterSelection(
    chapterParam,
    access?.role === "chapter_lead" ? chapterSelectionFor(access.ledChapters) : null,
  );
  const status: StatusFilter =
    statusParam === "all" || isApplicationStatus(statusParam) ? (statusParam as StatusFilter) : "open";

  // RLS: an admin gets every application, a chapter lead the ones in their
  // chapters.
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase
      .from("volunteer_applications")
      .select("id, full_name, chapters, submitted_at, status, ref1_matched_volunteer, attendance_target")
      .order("submitted_at", { ascending: false }),
    supabase.from("app_settings").select("min_events_before_screening").maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load applications: {error.message}</p>;
  const all = (data ?? []) as Row[];
  const minimum = (settings?.min_events_before_screening as number | undefined) ?? 2;

  const { data: attendanceRows } =
    all.length > 0
      ? await supabase.rpc("volunteer_application_attendance", { p_application_ids: all.map((r) => r.id) })
      : { data: [] };
  const attendance = new Map(
    ((attendanceRows ?? []) as { application_id: number; attended: number }[]).map((a) => [a.application_id, a.attended]),
  );

  const selectedChapters = selection
    ? CHAPTER_FILTER_OPTIONS.filter((o) => selection.includes(o.slug)).map((o) => o.chapter)
    : null;
  const rows = all.filter(
    (r) =>
      (!selectedChapters || r.chapters.some((c) => selectedChapters.includes(c))) &&
      (status === "all" || (status === "open" ? !CLOSED_STATUSES.includes(r.status) : r.status === status)),
  );

  return (
    <div className="flex flex-col gap-6">
      <FilterBar selection={selection} status={status} counts={countByStatus(all)} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications here for {chapterSelectionLabel(selection)}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const attended = attendance.get(r.id) ?? 0;
            const target = r.attendance_target ?? minimum;
            return (
              <li key={r.id}>
                <Link
                  href={`${BASE_PATH}/${r.id}`}
                  className="flex flex-col gap-2 rounded-md border p-3 hover:bg-accent sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{r.full_name}</span>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      {r.chapters.map((c) => (
                        <ChapterTag key={c} chapter={c} />
                      ))}
                      <span>Applied {formatDateInZone(r.submitted_at, "America/Denver")}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                    <span
                      className={cn("tabular-nums", attended < target && "text-amber-700 dark:text-amber-400")}
                      title={`Events attended, against the ${target} this application needs`}
                    >
                      {attended} / {target} events
                    </span>
                    {r.ref1_matched_volunteer ? (
                      <Badge variant="outline">Ref 1 is a volunteer</Badge>
                    ) : (
                      <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">
                        Ref 1 not matched
                      </Badge>
                    )}
                    <Badge variant={CLOSED_STATUSES.includes(r.status) ? "secondary" : "default"}>
                      {APPLICATION_STATUS_LABELS[r.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function countByStatus(rows: Row[]): Partial<Record<ApplicationStatus, number>> {
  const counts: Partial<Record<ApplicationStatus, number>> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

function FilterBar({
  selection,
  status,
  counts,
}: {
  selection: ChapterSelection;
  status: StatusFilter;
  counts: Partial<Record<ApplicationStatus, number>>;
}) {
  const statusParam = status === "open" ? undefined : status;
  const href = (next: StatusFilter) =>
    filterHref(BASE_PATH, {
      chapter: chapterSelectionParam(selection),
      status: next === "open" ? undefined : next,
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Chapter</span>
        <ChapterFilterPills selection={selection} basePath={BASE_PATH} otherParams={{ status: statusParam }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Status</span>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          <FilterPill href={href("open")} active={status === "open"}>
            Open
          </FilterPill>
          {APPLICATION_STATUSES.filter((s) => counts[s] || s === status).map((s) => (
            <FilterPill key={s} href={href(s)} active={status === s}>
              {APPLICATION_STATUS_LABELS[s]} ({counts[s] ?? 0})
            </FilterPill>
          ))}
          <FilterPill href={href("all")} active={status === "all"}>
            All
          </FilterPill>
        </div>
      </div>
    </div>
  );
}

export default function ApplicationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Volunteer applications</h1>
        <p className="text-sm text-muted-foreground">
          Newest first. Attendance is events checked in at, plus any credited from before the
          portal. Applications waiting on attendance move to Ready to screen by themselves once they
          reach their target.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ApplicationsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
