"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, ShieldCheck } from "lucide-react";

import { setDataAccessAction, setUserRoleAction } from "@/lib/actions/roles";
import { ROLE_LABELS, SCREENING_FLAG_RULE, screeningFlagGrants, type Role } from "@/lib/roles";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type RolePerson = {
  id: string;
  name: string;
  email: string;
  /** Their own home chapter (profiles.chapter). */
  chapter: string;
  role: Role;
  ledChapters: string[];
  /** profiles.can_view_volunteer_screening — only honoured for an admin. */
  canViewScreening: boolean;
  /** profiles.can_view_health_history — within the events they manage. */
  canViewHealthHistory: boolean;
};

const CHAPTER_OPTIONS = [...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER];

function roleSummary(person: RolePerson): string {
  if (person.role === "chapter_lead") {
    return person.ledChapters.length > 0
      ? `Chapter lead — ${person.ledChapters.join(", ")}`
      : "Chapter lead — no chapters yet";
  }
  return ROLE_LABELS[person.role];
}

/**
 * Admin-only screen for setting someone's role and, for a chapter lead, the
 * chapters they cover. Removing your own admin role asks first — only
 * another admin can give it back.
 */
export function RolesManager({
  currentUserId,
  staff,
  query,
  results,
}: {
  currentUserId: string;
  /** Everyone who's currently an admin or chapter lead, or has either
   * sensitive-data flag. */
  staff: RolePerson[];
  query: string;
  /** Search matches for `query`, or null when nothing's been searched. */
  results: RolePerson[] | null;
}) {
  const healthAccess = staff.filter((p) => p.canViewHealthHistory);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Admins, chapter leads and sensitive-data access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-sm">
            <HeartPulse className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
            <span>
              <span className="font-medium">Can see health histories: </span>
              {healthAccess.length === 0
                ? "nobody"
                : healthAccess.map((p) => p.name || p.email).join(", ")}
            </span>
          </p>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            staff.map((person) => (
              <PersonRow key={person.id} person={person} isSelf={person.id === currentUserId} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Find someone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* A plain GET form: the search lives in the URL (?q=). */}
          <form method="get" className="flex gap-2">
            <Label htmlFor="roles_q" className="sr-only">
              Name or email
            </Label>
            <Input
              id="roles_q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Name or email"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {results &&
            (results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one matches &ldquo;{query}&rdquo;.</p>
            ) : (
              results.map((person) => (
                <PersonRow key={person.id} person={person} isSelf={person.id === currentUserId} />
              ))
            ))}
          {!results && query.length > 0 && (
            <p className="text-sm text-muted-foreground">Type at least 2 characters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PersonRow({ person, isSelf }: { person: RolePerson; isSelf: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(person.role);
  const [chapters, setChapters] = useState<string[]>(person.ledChapters);
  const [confirmingSelfDemotion, setConfirmingSelfDemotion] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removesOwnAdmin = isSelf && person.role === "admin" && role !== "admin";

  const startEdit = () => {
    setRole(person.role);
    setChapters(person.ledChapters);
    setError(null);
    setConfirmingSelfDemotion(false);
    setEditing(true);
  };

  const save = async () => {
    if (removesOwnAdmin && !confirmingSelfDemotion) {
      setConfirmingSelfDemotion(true);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await setUserRoleAction(person.id, role, chapters);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setConfirmingSelfDemotion(false);
      return;
    }
    setEditing(false);
    setConfirmingSelfDemotion(false);
    // Demoting yourself takes you out of this admin-only page.
    if (removesOwnAdmin) {
      router.push("/protected/events");
      return;
    }
    router.refresh();
  };

  const toggleChapter = (name: string, checked: boolean) =>
    setChapters((prev) => (checked ? [...prev, name] : prev.filter((c) => c !== name)));

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{person.name || person.email}</span>
            {isSelf && <Badge variant="outline">You</Badge>}
          </div>
          <span className="text-sm text-muted-foreground">
            {[person.email, person.chapter && `Home chapter: ${person.chapter}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="text-sm">{roleSummary(person)}</span>
        </div>
        {!editing && (
          <Button type="button" size="sm" variant="outline" onClick={startEdit}>
            Change role
          </Button>
        )}
      </div>

      {/* Keyed on the saved values, so a refresh after a change made from
        * this person's other row (staff list vs. search) is picked up. */}
      <DataAccessFlags
        key={`${person.canViewScreening}-${person.canViewHealthHistory}`}
        person={person}
      />

      {editing && (
        <div className="mt-3 flex flex-col gap-3 border-t pt-3">
          <div className="grid gap-2">
            <Label htmlFor={`role_${person.id}`}>Role</Label>
            <Select
              id={`role_${person.id}`}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setConfirmingSelfDemotion(false);
              }}
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>

          {role === "chapter_lead" && (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Chapters they lead</span>
              <div className="flex flex-wrap gap-4 text-sm">
                {CHAPTER_OPTIONS.map((name) => (
                  <label key={name} className="flex items-center gap-2">
                    <Checkbox
                      checked={chapters.includes(name)}
                      onCheckedChange={(c) => toggleChapter(name, c === true)}
                    />
                    {name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                They can create events in these chapters and manage every event in them.
              </p>
            </div>
          )}

          {confirmingSelfDemotion && (
            <div
              role="alert"
              className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
            >
              <p className="font-medium">You&apos;re about to remove your own admin role.</p>
              <p className="mt-1">
                You&apos;ll lose access to setup, the volunteer registry, waivers and this page
                straight away{role === "chapter_lead" ? ", and keep only your chapters' events" : ""}.
                Only another admin can make you an admin again.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={confirmingSelfDemotion ? "destructive" : "default"}
              disabled={saving}
              onClick={save}
            >
              {saving
                ? "Saving..."
                : confirmingSelfDemotion
                  ? "Yes, remove my admin role"
                  : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setConfirmingSelfDemotion(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The two sensitive-data flags, always visible on the row (not behind
 * "Change role") and each saved as soon as it's ticked. Health history is
 * styled apart from screening so the two are never mistaken for each other.
 */
function DataAccessFlags({ person }: { person: RolePerson }) {
  const router = useRouter();
  const [flags, setFlags] = useState({
    screening: person.canViewScreening,
    healthHistory: person.canViewHealthHistory,
  });
  const [saving, setSaving] = useState<"screening" | "healthHistory" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (flag: "screening" | "healthHistory", value: boolean) => {
    const next = { ...flags, [flag]: value };
    setSaving(flag);
    setError(null);
    setFlags(next);
    const result = await setDataAccessAction(person.id, next);
    setSaving(null);
    if (!result.ok) {
      setFlags(flags);
      setError(result.error);
      return;
    }
    router.refresh();
  };


  return (
    <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
      <label
        className={cn(
          "flex items-start gap-2 rounded-md border p-2 text-sm",
          flags.screening && "border-sky-500/50 bg-sky-500/5",
        )}
      >
        <Checkbox
          className="mt-0.5"
          checked={flags.screening}
          disabled={saving !== null}
          onCheckedChange={(c) => toggle("screening", c === true)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
            Volunteer screening
            <span className="font-normal text-muted-foreground">
              {saving === "screening" ? "· saving…" : flags.screening ? "· on" : "· off"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {flags.screening
              ? screeningFlagGrants(person.role, person.ledChapters)
              : SCREENING_FLAG_RULE}
          </span>
        </span>
      </label>

      <label
        className={cn(
          "flex items-start gap-2 rounded-md border p-2 text-sm",
          flags.healthHistory && "border-rose-500/60 bg-rose-500/10",
        )}
      >
        <Checkbox
          className="mt-0.5 border-rose-600 data-[state=checked]:bg-rose-600 data-[state=checked]:text-white"
          checked={flags.healthHistory}
          disabled={saving !== null}
          onCheckedChange={(c) => toggle("healthHistory", c === true)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-400">
            <HeartPulse className="size-4" aria-hidden />
            Health histories
            <span className="font-normal text-muted-foreground">
              {saving === "healthHistory" ? "· saving…" : flags.healthHistory ? "· on" : "· off"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            Only applies within the events this person already manages — it never gives them
            any other events.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-500 sm:col-span-2">{error}</p>}
    </div>
  );
}
