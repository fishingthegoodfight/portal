"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { setMemberChapterAction } from "@/lib/actions/members";
import {
  agoLabel,
  attendanceSummary,
  BAND_LABELS,
  MEMBER_BANDS,
  MEMBER_VIEWS,
  outreachSections,
  TOUCH_TYPE_LABELS,
  type Member,
  type MemberBand,
  type MemberView,
  type TouchType,
} from "@/lib/members";
import { formatCertDate } from "@/lib/certifications";
import { ChapterTag } from "@/components/chapter-tag";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { LogOutreachForm } from "@/components/log-outreach-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const BAND_VARIANT: Record<MemberBand, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  active: "secondary",
  quiet: "outline",
  dropped: "destructive",
  one_visit: "outline",
  none: "outline",
};

export function MemberBandBadge({ band }: { band: MemberBand }) {
  return <Badge variant={BAND_VARIANT[band]}>{BAND_LABELS[band]}</Badge>;
}

const byName = (a: Member, b: Member) => a.name.localeCompare(b.name);

/**
 * Members (app/protected/members), two views:
 *  - Needs outreach: who's due, in sections by band, most overdue first;
 *  - Everyone: the chapter's full list, searchable, filterable by band.
 * Admins' names open the contact profile (/protected/admin/people/[id]).
 */
export function MembersView({
  members,
  today,
  view,
  chapterOptions,
  selected,
  allValue,
  isAdmin,
  chapterNames,
}: {
  members: Member[];
  today: string;
  view: MemberView;
  chapterOptions: string[];
  selected: string;
  allValue: string;
  isAdmin: boolean;
  chapterNames: string[];
}) {
  const [band, setBand] = useState<MemberBand | null>(null);
  const [query, setQuery] = useState("");

  const showAll = selected === allValue;
  const href = (chapter: string, v: MemberView) =>
    filterHref("/protected/members", { chapter, view: v === "outreach" ? undefined : v });

  const due = useMemo(() => members.filter((m) => m.needsOutreach), [members]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(MEMBER_BANDS.map((b) => [b, 0])) as Record<MemberBand, number>;
    for (const m of members) c[m.band] += 1;
    return c;
  }, [members]);

  const sections = useMemo(() => outreachSections(members), [members]);

  const everyone = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => !band || m.band === band)
      .filter((m) => !q || [m.name, m.email, m.phone, m.chapter].join(" ").toLowerCase().includes(q))
      .sort(byName);
  }, [members, band, query]);

  const row = (m: Member) => (
    <MemberRow
      key={m.user_id}
      member={m}
      today={today}
      showChapter={showAll}
      isAdmin={isAdmin}
      chapterNames={chapterNames}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {chapterOptions.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Chapter</span>
            <div role="group" aria-label="Chapter" className="flex flex-wrap gap-2">
              {chapterOptions.map((c) => (
                <FilterPill key={c} href={href(c, view)} active={c === selected}>
                  {c === allValue ? "All chapters" : c}
                </FilterPill>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Show</span>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {(Object.keys(MEMBER_VIEWS) as MemberView[]).map((v) => (
              <FilterPill key={v} href={href(selected, v)} active={v === view}>
                {MEMBER_VIEWS[v]} ({v === "outreach" ? due.length : members.length})
              </FilterPill>
            ))}
          </div>
        </div>
      </div>

      {view === "outreach" ? (
        sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody needs outreach right now.{" "}
            <Link href={href(selected, "everyone")} className="underline underline-offset-4">
              See everyone
            </Link>
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.band} className="flex flex-col gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {section.title}{" "}
                  <span className="text-sm font-normal text-muted-foreground">({section.rows.length})</span>
                </h2>
                <p className="text-sm text-muted-foreground">{section.hint}</p>
              </div>
              <ul className="flex flex-col divide-y rounded-md border">{section.rows.map(row)}</ul>
            </section>
          ))
        )
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            type="search"
            placeholder={isAdmin ? "Search name, email, phone or chapter" : "Search name, email or phone"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search members"
            className="sm:max-w-sm"
          />
          <div role="group" aria-label="Filter by band" className="flex flex-wrap gap-2">
            <BandPill active={band == null} onClick={() => setBand(null)}>
              All
            </BandPill>
            {MEMBER_BANDS.filter((b) => counts[b] > 0).map((b) => (
              <BandPill key={b} active={band === b} onClick={() => setBand(band === b ? null : b)}>
                {BAND_LABELS[b]} ({counts[b]})
              </BandPill>
            ))}
          </div>
          {everyone.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody matches.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">{everyone.map(row)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

/** A band filter: the look of FilterPill, but a button, since the band and
 * search stay on the page rather than in the URL. */
function BandPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-foreground bg-foreground font-medium text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** "Outreach 2w ago by Sam (call): “left a voicemail”", or "No outreach yet". */
export function LastOutreach({ member: m, today }: { member: Member; today: string }) {
  if (!m.last_touch_on) return <span className="text-muted-foreground">No outreach yet</span>;
  const type = TOUCH_TYPE_LABELS[m.last_touch_type as TouchType] ?? m.last_touch_type;
  return (
    <span>
      <span title={formatCertDate(m.last_touch_on)}>Outreach {agoLabel(m.last_touch_on, today)}</span>
      <span className="text-muted-foreground">
        {" "}
        by {m.last_touch_by ?? "someone"} ({type})
        {m.last_touch_note && <>: &ldquo;{m.last_touch_note}&rdquo;</>}
      </span>
    </span>
  );
}

function MemberRow({
  member: m,
  today,
  showChapter,
  isAdmin,
  chapterNames,
}: {
  member: Member;
  today: string;
  showChapter: boolean;
  isAdmin: boolean;
  chapterNames: string[];
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [chapter, setChapter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noChapter = !m.chapter?.trim();

  const saveChapter = async () => {
    if (!chapter) return;
    setBusy(true);
    setError(null);
    const result = await setMemberChapterAction(m.user_id, chapter);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  };

  return (
    <li id={`member-${m.user_id}`} className="flex scroll-mt-24 flex-col gap-2 p-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
          <span className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <Link href={`/protected/admin/people/${m.user_id}`} className="font-medium hover:underline">
                {m.name}
              </Link>
            ) : (
              <span className="font-medium">{m.name}</span>
            )}
            <MemberBandBadge band={m.band} />
            {showChapter && !noChapter && <ChapterTag chapter={m.chapter as string} />}
          </span>
          {(m.phone || m.email) && (
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              {m.phone && (
                <a href={`tel:${m.phone.replace(/\D/g, "")}`} className="hover:underline">
                  {m.phone}
                </a>
              )}
              {m.phone && m.email && <span aria-hidden>·</span>}
              {m.email && (
                <a href={`mailto:${m.email}`} className="hover:underline">
                  {m.email}
                </a>
              )}
            </span>
          )}
          <span>
            {attendanceSummary(m, today)}
            {m.dropAlertSince && <span className="text-muted-foreground"> · used to come regularly</span>}
            {m.outreachStopped && <span className="text-muted-foreground"> · no longer prompted after repeated outreach</span>}
          </span>
          <LastOutreach member={m} today={today} />
        </div>
        {!logging && (
          <Button size="sm" variant="outline" className="w-fit shrink-0" onClick={() => setLogging(true)}>
            Log outreach
          </Button>
        )}
      </div>

      {isAdmin && noChapter && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={chapter} onChange={(e) => setChapter(e.target.value)} aria-label="Home chapter" className="w-auto">
            <option value="">Set home chapter…</option>
            {chapterNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={!chapter || busy} onClick={saveChapter}>
            Save
          </Button>
        </div>
      )}

      {logging && <LogOutreachForm memberId={m.user_id} today={today} onDone={() => setLogging(false)} />}
      {error && <p className="text-red-500">{error}</p>}
    </li>
  );
}
