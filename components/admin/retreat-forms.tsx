"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createRetreatAction,
  deleteRetreatSessionAction,
  priceOptionsFromRetreatAction,
  saveRetreatAction,
  saveRetreatDetailsAction,
  saveRetreatPaymentSettingsAction,
  saveRetreatSessionAction,
  savePriceOptionsAction,
  setRetreatPublishedAction,
  type PriceOptionInput,
  type RetreatCoreInput,
  type RetreatDetailsInput,
  type RetreatSessionInput,
} from "@/lib/actions/retreats";
import {
  AUDIENCE_LABELS,
  centsToInput,
  RETREAT_AUDIENCES,
  type PriceOption,
  type RetreatAudience,
  type RetreatDetails,
} from "@/lib/retreats";
import { LeadContactFields } from "@/components/admin/fields/lead-contact-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Option = { value: string; label: string };

/** Saved / error line under a form's button. */
function Status({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) return <span className="text-sm text-red-500">{error}</span>;
  if (saved) return <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>;
  return null;
}

/** One form's busy/saved/error state around a server action. */
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    setBusy(true);
    setSaved(false);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setSaved(true);
    router.refresh();
    return result.data;
  };
  return { busy, saved, error, run, touch: () => setSaved(false) };
}

// ---- Core fields: create and edit -------------------------------------------------------

export function RetreatCoreForm({
  eventId,
  initial,
  regions,
  timezones,
  waiverStates,
  canChangeAdminFields,
}: {
  /** null = create. */
  eventId: number | null;
  initial: RetreatCoreInput;
  regions: Option[];
  timezones: Option[];
  waiverStates: Option[];
  /** Region and lead: admins only. */
  canChangeAdminFields: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const { busy, saved, error, run, touch } = useSave();
  const set = <K extends keyof RetreatCoreInput>(key: K, value: RetreatCoreInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    touch();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (eventId == null) {
      const created = await run(() => createRetreatAction(form));
      if (created) router.push(`/protected/admin/retreats/${created.id}`);
    } else {
      await run(() => saveRetreatAction(eventId, form));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="retreat_name">Title</Label>
        <Input id="retreat_name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_region">Region</Label>
          <Select
            id="retreat_region"
            value={form.regionId}
            onChange={(e) => set("regionId", e.target.value)}
            disabled={!canChangeAdminFields}
            required
          >
            <option value="">Choose…</option>
            {regions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          {!canChangeAdminFields && <p className="text-xs text-muted-foreground">Only an admin can change the region.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_waiver_state">Waiver state</Label>
          <Select id="retreat_waiver_state" value={form.waiverState} onChange={(e) => set("waiverState", e.target.value)} required>
            <option value="">Choose…</option>
            {waiverStates.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Where the retreat is: participants sign that state&apos;s waiver.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_start_date">Starts</Label>
          <div className="flex gap-2">
            <Input id="retreat_start_date" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} required />
            <Input
              aria-label="Start time"
              type="time"
              className="w-32"
              value={form.startTime}
              onChange={(e) => set("startTime", e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_end_date">Ends</Label>
          <div className="flex gap-2">
            <Input id="retreat_end_date" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} required />
            <Input
              aria-label="End time"
              type="time"
              className="w-32"
              value={form.endTime}
              onChange={(e) => set("endTime", e.target.value)}
              required
            />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_timezone">Time zone</Label>
          <Select id="retreat_timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {timezones.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_capacity">Capacity (participants)</Label>
          <Input
            id="retreat_capacity"
            inputMode="numeric"
            placeholder="No limit"
            value={form.capacity}
            onChange={(e) => set("capacity", e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="retreat_description">Description</Label>
        <Textarea
          id="retreat_description"
          rows={6}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Public. Don&apos;t put the lodging or fishing location here: those are shown only to confirmed participants
          and volunteers, below.
        </p>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Retreat lead</legend>
        {canChangeAdminFields ? (
          <LeadContactFields
            idPrefix="retreat_lead"
            name={form.leadName}
            phone={form.leadPhone}
            email={form.leadEmail}
            leadUserId={form.leadUserId}
            onChangeName={(v) => set("leadName", v)}
            onChangePhone={(v) => set("leadPhone", v)}
            onChangeEmail={(v) => set("leadEmail", v)}
            onChangeLeadUserId={(v) => set("leadUserId", v)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {form.leadName || "No lead named"}. Only an admin can change the retreat lead.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : eventId == null ? "Create retreat" : "Save"}
        </Button>
        <Status saved={saved} error={error} />
      </div>
    </form>
  );
}

// ---- Publish -------------------------------------------------------------------------------

export function RetreatPublishToggle({ eventId, published }: { eventId: number; published: boolean }) {
  const { busy, error, run } = useSave();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={published ? "outline" : "default"}
        disabled={busy}
        onClick={() => run(() => setRetreatPublishedAction(eventId, !published))}
      >
        {busy ? "Saving..." : published ? "Unpublish" : "Publish"}
      </Button>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
}

// ---- Private details ------------------------------------------------------------------------

export function RetreatDetailsForm({ eventId, initial }: { eventId: number; initial: RetreatDetails | null }) {
  const [form, setForm] = useState<RetreatDetailsInput>({
    lodgingName: initial?.lodging_name ?? "",
    lodgingAddress: initial?.lodging_address ?? "",
    fishingName: initial?.fishing_name ?? "",
    fishingAddress: initial?.fishing_address ?? "",
    fishingLatitude: initial?.fishing_latitude?.toString() ?? "",
    fishingLongitude: initial?.fishing_longitude?.toString() ?? "",
    photosUrl: initial?.photos_url ?? "",
  });
  const [placeBy, setPlaceBy] = useState<"address" | "coordinates">(
    initial?.fishing_latitude != null ? "coordinates" : "address",
  );
  const { busy, saved, error, run, touch } = useSave();
  const set = (key: keyof RetreatDetailsInput, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    touch();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(() =>
      saveRetreatDetailsAction(eventId, {
        ...form,
        fishingAddress: placeBy === "address" ? form.fishingAddress : "",
        fishingLatitude: placeBy === "coordinates" ? form.fishingLatitude : "",
        fishingLongitude: placeBy === "coordinates" ? form.fishingLongitude : "",
      }),
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lodging_name">Lodging name</Label>
          <Input id="lodging_name" value={form.lodgingName} onChange={(e) => set("lodgingName", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lodging_address">Lodging address</Label>
          <Input id="lodging_address" value={form.lodgingAddress} onChange={(e) => set("lodgingAddress", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fishing_name">Fishing location</Label>
        <Input id="fishing_name" value={form.fishingName} onChange={(e) => set("fishingName", e.target.value)} />
      </div>
      <div role="radiogroup" aria-label="Fishing location by" className="flex flex-wrap gap-4 text-sm">
        {(["address", "coordinates"] as const).map((by) => (
          <label key={by} className="flex items-center gap-2">
            <input
              type="radio"
              name="fishing_place_by"
              checked={placeBy === by}
              onChange={() => {
                setPlaceBy(by);
                touch();
              }}
            />
            {by === "address" ? "Address" : "Coordinates (opens a map pin)"}
          </label>
        ))}
      </div>
      {placeBy === "address" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="fishing_address">Fishing location address</Label>
          <Input id="fishing_address" value={form.fishingAddress} onChange={(e) => set("fishingAddress", e.target.value)} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="fishing_lat">Latitude</Label>
            <Input
              id="fishing_lat"
              inputMode="decimal"
              placeholder="e.g. 39.6403"
              value={form.fishingLatitude}
              onChange={(e) => set("fishingLatitude", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fishing_lng">Longitude</Label>
            <Input
              id="fishing_lng"
              inputMode="decimal"
              placeholder="e.g. -106.3742"
              value={form.fishingLongitude}
              onChange={(e) => set("fishingLongitude", e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            In Google Maps, right-click the spot and click the numbers at the top to copy them.
          </p>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="photos_url">Shared photos link (Google Photos)</Label>
        <Input
          id="photos_url"
          type="url"
          placeholder="https://photos.app.goo.gl/…"
          value={form.photosUrl}
          onChange={(e) => set("photosUrl", e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save details"}
        </Button>
        <Status saved={saved} error={error} />
      </div>
    </form>
  );
}

// ---- Virtual sessions -----------------------------------------------------------------------

export type SessionFormRow = RetreatSessionInput & { id: number };

const EMPTY_SESSION: RetreatSessionInput = {
  id: null,
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  meetingUrl: "",
  audience: "",
};

/** Suggested sessions, one click each to start a new one from. */
const SESSION_SUGGESTIONS: { title: string; audience: RetreatAudience }[] = [
  { title: "Volunteer briefing", audience: "volunteers" },
  { title: "Leadership briefing", audience: "leadership" },
  { title: "Post-retreat group with the therapist", audience: "participants" },
];

function SessionEditor({
  eventId,
  initial,
  onDone,
}: {
  eventId: number;
  initial: RetreatSessionInput;
  onDone: () => void;
}) {
  const [form, setForm] = useState(initial);
  const { busy, error, run } = useSave();
  const set = <K extends keyof RetreatSessionInput>(key: K, value: RetreatSessionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const prefix = `session_${initial.id ?? "new"}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => saveRetreatSessionAction(eventId, form));
    if (ok !== null) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border p-3">
      {initial.id == null && (
        <div className="flex flex-wrap gap-2">
          {SESSION_SUGGESTIONS.map((s) => (
            <Button
              key={s.title}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setForm((f) => ({ ...f, title: s.title, audience: s.audience }))}
            >
              {s.title}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}_title`}>Title</Label>
          <Input id={`${prefix}_title`} value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}_audience`}>For</Label>
          <Select
            id={`${prefix}_audience`}
            value={form.audience}
            onChange={(e) => set("audience", e.target.value as RetreatAudience | "")}
            required
          >
            <option value="">Choose…</option>
            {RETREAT_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}_date`}>Date</Label>
          <Input id={`${prefix}_date`} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}_start`}>Starts</Label>
          <Input id={`${prefix}_start`} type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}_end`}>Ends (optional)</Label>
          <Input id={`${prefix}_end`} type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}_url`}>Meeting link</Label>
        <Input
          id={`${prefix}_url`}
          type="url"
          placeholder="https://zoom.us/j/…"
          value={form.meetingUrl}
          onChange={(e) => set("meetingUrl", e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving..." : "Save session"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </form>
  );
}

export function RetreatSessionsPanel({
  eventId,
  sessions,
}: {
  eventId: number;
  /** Pre-formatted for display alongside the editable values. */
  sessions: (SessionFormRow & { when: string })[];
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const { busy, error, run } = useSave();

  return (
    <div className="flex flex-col gap-3">
      {sessions.length === 0 && editing !== "new" && (
        <p className="text-sm text-muted-foreground">No virtual sessions yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {sessions.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <SessionEditor eventId={eventId} initial={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-medium">{s.title}</span>
                <span className="text-muted-foreground">
                  {s.when} · for {AUDIENCE_LABELS[s.audience as RetreatAudience]}
                </span>
                {s.meetingUrl ? (
                  <span className="truncate text-muted-foreground">{s.meetingUrl}</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">No meeting link yet</span>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(s.id)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove "${s.title}"?`)) run(() => deleteRetreatSessionAction(eventId, s.id));
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === "new" ? (
        <SessionEditor eventId={eventId} initial={EMPTY_SESSION} onDone={() => setEditing(null)} />
      ) : (
        <Button type="button" variant="outline" className="w-fit" onClick={() => setEditing("new")}>
          Add a session
        </Button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

// ---- Price options --------------------------------------------------------------------------

type PriceRow = PriceOptionInput & { key: string };

let rowKey = 0;
const nextKey = () => `row${++rowKey}`;

const toRows = (options: PriceOption[], keepIds: boolean): PriceRow[] =>
  options.map((o) => ({
    key: nextKey(),
    id: keepIds ? o.id : null,
    label: o.label,
    amount: centsToInput(o.amount_cents),
    description: o.description ?? "",
    isTrueCost: o.is_true_cost,
  }));

export function PriceOptionsEditor({
  eventId,
  options,
  otherRetreats,
}: {
  eventId: number;
  options: PriceOption[];
  /** Retreats to copy a list from: value = event id. */
  otherRetreats: Option[];
}) {
  const [rows, setRows] = useState<PriceRow[]>(() => toRows(options, true));
  const [copyFrom, setCopyFrom] = useState("");
  const { busy, saved, error, run, touch } = useSave();
  const [copyError, setCopyError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<PriceRow>) => {
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, ...patch } : patch.isTrueCost ? { ...r, isTrueCost: false } : r,
      ),
    );
    touch();
  };
  const move = (index: number, by: number) => {
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
    touch();
  };

  const copy = async () => {
    setCopyError(null);
    const result = await priceOptionsFromRetreatAction(eventId, Number(copyFrom));
    if (!result.ok) {
      setCopyError(result.error);
      return;
    }
    if (result.data.length === 0) {
      setCopyError("That retreat has no price options.");
      return;
    }
    if (rows.length > 0 && !confirm("Replace the options below with that retreat's? Nothing is saved until you click Save.")) {
      return;
    }
    setRows(toRows(result.data, false));
    touch();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(() => savePriceOptionsAction(eventId, rows.map((r) => ({ id: r.id, label: r.label, amount: r.amount, description: r.description, isTrueCost: r.isTrueCost }))));
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {otherRetreats.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="copy_prices_from">Start from another retreat&apos;s list</Label>
            <Select id="copy_prices_from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="w-72">
              <option value="">Choose…</option>
              {otherRetreats.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="outline" disabled={!copyFrom} onClick={copy}>
            Copy
          </Button>
          {copyError && <span className="text-sm text-red-500">{copyError}</span>}
        </div>
      )}

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No price options yet.</p>}
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="grid gap-1.5">
                <Label htmlFor={`${row.key}_label`}>Label</Label>
                <Input id={`${row.key}_label`} value={row.label} onChange={(e) => update(row.key, { label: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${row.key}_amount`}>Amount ($)</Label>
                <Input
                  id={`${row.key}_amount`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => update(row.key, { amount: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${row.key}_description`}>Description (optional)</Label>
              <Input
                id={`${row.key}_description`}
                value={row.description}
                onChange={(e) => update(row.key, { description: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={row.isTrueCost}
                  onCheckedChange={(checked) => update(row.key, { isTrueCost: checked === true })}
                />
                True cost
              </label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}>
                  Up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Down
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRows((rs) => rs.filter((r) => r.key !== row.key));
                    touch();
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey(), id: null, label: "", amount: "", description: "", isTrueCost: false }]);
            touch();
          }}
        >
          Add an option
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save price options"}
        </Button>
        <Status saved={saved} error={error} />
      </div>
      <p className="text-xs text-muted-foreground">
        Shown publicly in this order. Mark the option that covers what the retreat actually costs per person as the
        true cost: anything paid above it is a donation (used for receipts once payments are on).
      </p>
    </form>
  );
}

// ---- Deposit, balance due, refund policy ------------------------------------------------------

export function RetreatPaymentSettingsForm({
  eventId,
  depositCents,
  balanceDueDate,
  defaultBalanceDueDate,
  refundPolicy,
}: {
  eventId: number;
  depositCents: number | null;
  /** The retreat's own date, or null for the default. */
  balanceDueDate: string | null;
  /** 60 days before the start, "YYYY-MM-DD". */
  defaultBalanceDueDate: string;
  refundPolicy: string | null;
}) {
  const [deposit, setDeposit] = useState(centsToInput(depositCents));
  const [due, setDue] = useState(balanceDueDate ?? "");
  const [policy, setPolicy] = useState(refundPolicy ?? "");
  const { busy, saved, error, run, touch } = useSave();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(() => saveRetreatPaymentSettingsAction(eventId, { deposit, balanceDueDate: due, refundPolicy: policy }));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_deposit">Deposit ($)</Label>
          <Input
            id="retreat_deposit"
            inputMode="decimal"
            placeholder="No deposit option"
            value={deposit}
            onChange={(e) => {
              setDeposit(e.target.value);
              touch();
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="retreat_balance_due">Balance due</Label>
          <Input
            id="retreat_balance_due"
            type="date"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              touch();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Blank = 60 days before the start ({defaultBalanceDueDate}).
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="retreat_refund_policy">Refund policy</Label>
        <Textarea
          id="retreat_refund_policy"
          rows={5}
          value={policy}
          onChange={(e) => {
            setPolicy(e.target.value);
            touch();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Status saved={saved} error={error} />
      </div>
    </form>
  );
}
