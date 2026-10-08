"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { logMemberTouchAction, setMemberChapterAction } from "@/lib/actions/members";
import {
  agoLabel,
  BAND_LABELS,
  MEMBER_BANDS,
  TOUCH_TYPE_LABELS,
  TOUCH_TYPES,
  type Member,
  type MemberBand,
  type TouchType,
} from "@/lib/members";
import { formatCertDate } from "@/lib/certifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NO_CHAPTER = "No chapter";

const SORTS = {
  name: "Name",
  lastTouch: "Last touch (oldest first)",
  due: "Touch due (soonest first)",
  lastSeen: "Last seen (most recent first)",
  firstSeen: "First seen (most recent first)",
  recent: "Check-ins, last 6 months",
  band: "Band",
} as const;
type SortKey = keyof typeof SORTS;

const BAND_VARIANT: Record<MemberBand, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  active: "secondary",
  quiet: "outline",
  dropped: "destructive",
  one_visit: "outline",
  none: "outline",
};

const lastContactDate = (m: Member) => m.lastContact?.on ?? "";

function compare(sort: SortKey) {
  const order = Object.fromEntries(MEMBER_BANDS.map((b, i) => [b, i]));
  return (a: Member, b: Member): number => {
    switch (sort) {
      case "lastTouch":
        return lastContactDate(a).localeCompare(lastContactDate(b)) || a.name.localeCompare(b.name);
      case "due":
        return (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.name.localeCompare(b.name);
      case "lastSeen":
        return (b.last_seen ?? "").localeCompare(a.last_seen ?? "") || a.name.localeCompare(b.name);
      case "firstSeen":
        return (b.first_seen ?? "").localeCompare(a.first_seen ?? "") || a.name.localeCompare(b.name);
      case "recent":
        return b.checkins_6mo - a.checkins_6mo || a.name.localeCompare(b.name);
      case "band":
        return order[a.band] - order[b.band] || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name);
    }
  };
}

/** Members (app/protected/members): filters, sorting, logging touches. */
export function MembersView({
  members,
  today,
  chapterOptions,
  selected,
  allValue,
  isAdmin,
  chapterNames,
}: {
  members: Member[];
  today: string;
  chapterOptions: string[];
  selected: string;
  allValue: string;
  isAdmin: boolean;
  chapterNames: string[];
}) {
  const [band, setBand] = useState<MemberBand | null>(null);
  const [needsTouch, setNeedsTouch] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [query, setQuery] = useState("");

  const showAll = selected === allValue;
  const alerts = useMemo(
    () => members.filter((m) => m.dropAlertSince).sort((a, b) => a.dropAlertSince!.localeCompare(b.dropAlertSince!)),
    [members],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(MEMBER_BANDS.map((b) => [b, 0])) as Record<MemberBand, number>;
    for (const m of members) c[m.band] += 1;
    return c;
  }, [members]);
  const needsCount = members.filter((m) => m.needsTouch).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => (!band || m.band === band) && (!needsTouch || m.needsTouch))
      .filter((m) => !q || [m.name, m.email, m.phone].join(" ").toLowerCase().includes(q))
      .sort(compare(sort));
  }, [members, band, needsTouch, sort, query]);

  const groups = useMemo(() => {
    if (!showAll) return [{ label: selected, rows: shown }];
    const byChapter = new Map<string, Member[]>();
    for (const m of shown) {
      const label = m.chapter?.trim() || NO_CHAPTER;
      byChapter.set(label, [...(byChapter.get(label) ?? []), m]);
    }
    return [...byChapter.entries()]
      .sort(([a], [b]) => (a === NO_CHAPTER ? -1 : b === NO_CHAPTER ? 1 : a.localeCompare(b)))
      .map(([label, rows]) => ({ label, rows }));
  }, [shown, showAll, selected]);

  return (
    <div className="flex flex-col gap-6">
      {chapterOptions.length > 1 && (
        <nav aria-label="Chapters" className="flex flex-wrap gap-2">
          {chapterOptions.map((c) => (
            <Link
              key={c}
              href={`/protected/members?chapter=${encodeURIComponent(c)}`}
              aria-current={c === selected ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                c === selected ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
              )}
            >
              {c === allValue ? "All chapters" : c}
            </Link>
          ))}
        </nav>
      )}

      {alerts.length > 0 && (
        <Card className="border-amber-500/60">
          <CardHeader>
            <CardTitle className="text-lg">Drop alerts ({alerts.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              Regulars who haven&apos;t been back. Each clears when they check in or someone logs a touch.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {alerts.map((m) => (
              <a key={m.user_id} href={`#member-${m.user_id}`} className="flex flex-wrap gap-x-2 hover:underline">
                <span className="font-medium">{m.name}</span>
                {showAll && <span className="text-muted-foreground">{m.chapter || NO_CHAPTER}</span>}
                <span className="text-muted-foreground">
                  last came {m.last_seen ? agoLabel(m.last_seen, today) : "—"} · {m.checkins_6mo_before_last} check-ins in
                  the 6 months before
                </span>
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterPill active={band == null} onClick={() => setBand(null)}>
            All ({members.length})
          </FilterPill>
          {MEMBER_BANDS.map((b) => (
            <FilterPill key={b} active={band === b} onClick={() => setBand(band === b ? null : b)}>
              {BAND_LABELS[b]} ({counts[b]})
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={needsTouch} onChange={(e) => setNeedsTouch(e.target.checked)} />
            Needs a touch ({needsCount})
          </label>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" className="w-auto">
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                Sort: {SORTS[key]}
              </option>
            ))}
          </Select>
          <Input
            type="search"
            placeholder="Search name, email, phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-56"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody matches.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            {showAll && (
              <h2 className="text-lg font-semibold">
                {group.label} <span className="text-sm font-normal text-muted-foreground">({group.rows.length})</span>
              </h2>
            )}
            <ul className="flex flex-col divide-y rounded-md border">
              {group.rows.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  today={today}
                  canSetChapter={isAdmin && !m.chapter?.trim()}
                  chapterNames={chapterNames}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-sm",
        active ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function LastContact({ member, today }: { member: Member; today: string }) {
  const c = member.lastContact;
  if (!c) return <span className="text-muted-foreground">Never reached</span>;
  if (c.kind === "touch") {
    return (
      <span title={c.note ?? undefined}>
        <span className="font-semibold">Touched {agoLabel(c.on, today)}</span> · {c.by} · {c.type}
        {c.note && <span className="text-muted-foreground"> · “{c.note}”</span>}
      </span>
    );
  }
  return (
    <span>
      <span className="font-semibold">Came {agoLabel(c.on, today)}</span>
      {c.event && <span className="text-muted-foreground"> · {c.event}</span>}
    </span>
  );
}

function MemberRow({
  member: m,
  today,
  canSetChapter,
  chapterNames,
}: {
  member: Member;
  today: string;
  canSetChapter: boolean;
  chapterNames: string[];
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [type, setType] = useState<TouchType>("call");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [chapter, setChapter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTouch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await logMemberTouchAction({ memberId: m.user_id, type, touchedOn: on, note });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setLogging(false);
    setNote("");
    router.refresh();
  };

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
            <span className="font-medium">{m.name}</span>
            <Badge variant={BAND_VARIANT[m.band]}>{BAND_LABELS[m.band]}</Badge>
            {m.needsTouch && <Badge variant="outline">Needs a touch</Badge>}
            {m.dropAlertSince && <Badge variant="destructive">Drop alert</Badge>}
          </span>
          <span className="text-muted-foreground">{[m.phone, m.email].filter(Boolean).join(" · ") || "—"}</span>
          <span className="text-muted-foreground">
            First seen {formatCertDate(m.first_seen)} · last seen {formatCertDate(m.last_seen)} · {m.checkins_6mo}{" "}
            {m.checkins_6mo === 1 ? "check-in" : "check-ins"} in 6 months
            {m.dueOn && !m.needsTouch && ` · next touch by ${formatCertDate(m.dueOn)}`}
          </span>
          <span>
            <LastContact member={m} today={today} />
          </span>
        </div>
        {!logging && (
          <Button size="sm" variant="outline" className="w-fit shrink-0" onClick={() => setLogging(true)}>
            Log a touch
          </Button>
        )}
      </div>

      {canSetChapter && (
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

      {logging && (
        <form onSubmit={saveTouch} className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-wrap gap-2">
            {TOUCH_TYPES.map((t) => (
              <FilterPill key={t} active={type === t} onClick={() => setType(t)}>
                {TOUCH_TYPE_LABELS[t]}
              </FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className="w-auto" aria-label="Date" />
            <Input
              placeholder="Short note (optional)"
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-w-48 flex-1"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving..." : "Save touch"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setLogging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </li>
  );
}
