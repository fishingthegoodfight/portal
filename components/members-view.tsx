"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { logMemberTouchAction, setMemberChapterAction } from "@/lib/actions/members";
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
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { VOLUNTEER_STATUS_LABELS, type VolunteerStatus } from "@/lib/volunteers";
import { ChapterTag } from "@/components/chapter-tag";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { LogOutreachForm } from "@/components/log-outreach-form";
import { EmailComposer } from "@/components/email-composer";
import { PhoneTools } from "@/components/phone-tools";
import { Checkbox } from "@/components/ui/checkbox";
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

/** Admins only: what a row's tags show, from the page (loadPersonTags). */
export type PersonTags = {
  /** Only when above participant. */
  role?: Exclude<Role, "participant">;
  volunteer?: { status: VolunteerStatus; roles: string[] };
};

/** Everyone's "Who" filter (admins): "" for everyone, "staff", "volunteers",
 * or "role:<role type name>". */
function matchesWho(tags: PersonTags | undefined, who: string): boolean {
  if (!who) return true;
  if (who === "staff") return tags?.role != null;
  if (who === "volunteers") return tags?.volunteer != null;
  return tags?.volunteer?.roles.includes(who.slice("role:".length)) ?? false;
}

/**
 * Members (app/protected/members), three views:
 *  - Needs outreach: who's due, in sections by band, most overdue first;
 *  - Everyone: the chapter's full list, searchable, filterable by band, and
 *    for admins tagged and filterable by site role and volunteer role;
 *  - Team & access (admins): `team`, rendered by the page.
 * Admins' names open the person's page (/protected/admin/people/[id]).
 * Tick people (or "select all shown") and Email them, or email one person
 * from their row (components/email-composer.tsx). The selection stays
 * through view and filter changes; a different chapter is a new page
 * (the page keys this on the chapter), so it clears.
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
  tags,
  roleTypeNames,
  team,
}: {
  members: Member[];
  today: string;
  view: MemberView;
  chapterOptions: string[];
  selected: string;
  allValue: string;
  isAdmin: boolean;
  chapterNames: string[];
  /** Admins only (null otherwise): tags by user id. */
  tags: Record<string, PersonTags> | null;
  /** Admins only: the volunteer role types, for the "Who" filter. */
  roleTypeNames: string[];
  /** The Team & access content, when that's the view. */
  team: React.ReactNode;
}) {
  const [band, setBand] = useState<MemberBand | null>(null);
  const [who, setWho] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<null | { userIds: string[]; audience: string }>(null);

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
      .filter((m) => !tags || matchesWho(tags[m.user_id], who))
      .filter((m) => !q || [m.name, m.email, m.phone, m.chapter].join(" ").toLowerCase().includes(q))
      .sort(byName);
  }, [members, band, query, tags, who]);

  const shown = view === "outreach" ? due : view === "everyone" ? everyone : [];
  const allShownPicked = shown.length > 0 && shown.every((m) => picked.has(m.user_id));
  const togglePicked = (userId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const toggleAllShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const m of shown) {
        if (allShownPicked) next.delete(m.user_id);
        else next.add(m.user_id);
      }
      return next;
    });
  const chapterLabel = showAll ? "all chapters" : selected;

  const row = (m: Member) => (
    <MemberRow
      key={m.user_id}
      member={m}
      today={today}
      showChapter={showAll}
      isAdmin={isAdmin}
      tags={tags?.[m.user_id]}
      chapterNames={chapterNames}
      picked={picked.has(m.user_id)}
      onTogglePicked={() => togglePicked(m.user_id)}
      onEmail={() => setComposing({ userIds: [m.user_id], audience: `${m.name} (${chapterLabel})` })}
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
            {(Object.keys(MEMBER_VIEWS) as MemberView[])
              .filter((v) => v !== "team" || isAdmin)
              .map((v) => (
                <FilterPill key={v} href={href(selected, v)} active={v === view}>
                  {MEMBER_VIEWS[v]}
                  {v !== "team" && ` (${v === "outreach" ? due.length : members.length})`}
                </FilterPill>
              ))}
          </div>
        </div>
      </div>

      {shown.length > 0 && (
        <label className="flex w-fit items-center gap-2 text-sm">
          <Checkbox checked={allShownPicked} onCheckedChange={toggleAllShown} />
          Select all shown ({shown.length})
        </label>
      )}

      {view === "team" ? (
        team
      ) : view === "outreach" ? (
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
          {tags && (
            <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who" className="w-auto sm:max-w-sm">
              <option value="">Anyone</option>
              <option value="staff">Admins and chapter leads</option>
              <option value="volunteers">Volunteers</option>
              {roleTypeNames.map((name) => (
                <option key={name} value={`role:${name}`}>
                  Volunteers: {name}
                </option>
              ))}
            </Select>
          )}
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

      {view !== "team" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link
            href={filterHref("/protected/emails", { chapter: showAll ? undefined : selected })}
            className="underline underline-offset-4"
          >
            Emails sent{showAll ? "" : ` to ${selected}`}
          </Link>
        </div>
      )}

      {picked.size > 0 && (
        <div className="sticky bottom-4 z-40 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3 shadow-lg">
          <span className="text-sm font-medium">{picked.size} selected</span>
          <Button
            size="sm"
            onClick={() =>
              setComposing({ userIds: [...picked], audience: `${picked.size} selected (${chapterLabel})` })
            }
          >
            Email
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {composing && (
        <EmailComposer
          source="members"
          chapter={showAll ? null : selected}
          audience={composing.audience}
          userIds={composing.userIds}
          onClose={() => setComposing(null)}
        />
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
  tags,
  chapterNames,
  picked,
  onTogglePicked,
  onEmail,
}: {
  member: Member;
  today: string;
  showChapter: boolean;
  isAdmin: boolean;
  tags: PersonTags | undefined;
  chapterNames: string[];
  picked: boolean;
  onTogglePicked: () => void;
  onEmail: () => void;
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
    <li id={`member-${m.user_id}`} className="flex scroll-mt-24 gap-3 p-3 text-sm">
      <Checkbox checked={picked} onCheckedChange={onTogglePicked} aria-label={`Select ${m.name}`} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
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
            {tags?.role && <Badge variant="outline">{ROLE_LABELS[tags.role]}</Badge>}
            {tags?.volunteer && (
              <Badge variant="outline" className="border-sky-500/50 text-sky-700 dark:text-sky-400">
                Volunteer
                {tags.volunteer.status !== "approved" && ` · ${VOLUNTEER_STATUS_LABELS[tags.volunteer.status]}`}
              </Badge>
            )}
            {showChapter && !noChapter && <ChapterTag chapter={m.chapter as string} />}
          </span>
          {tags?.volunteer && tags.volunteer.roles.length > 0 && (
            <span className="text-muted-foreground">{tags.volunteer.roles.join(", ")}</span>
          )}
          {(m.phone || m.email) && (
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              {m.phone && (
                <PhoneTools
                  phone={m.phone}
                  name={m.name}
                  onLogText={async () => {
                    const result = await logMemberTouchAction({ memberId: m.user_id, type: "text", touchedOn: today, note: "" });
                    if (result.ok) router.refresh();
                    return result;
                  }}
                />
              )}
              {m.email && (
                <button type="button" onClick={onEmail} className="font-medium text-foreground underline underline-offset-4">
                  Email
                </button>
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
      </div>
    </li>
  );
}
