"use client";

import { useState, type ReactNode } from "react";

import type { DeleteResult, UsageResult } from "@/lib/admin/usage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Shared list controls for the admin setup screens (volunteer role types,
 * event types, event templates): a "Show inactive" toggle, and a Delete flow
 * that only deletes something nothing references — otherwise it says exactly
 * what's using it and offers Deactivate instead.
 */

export function ShowInactiveToggle({
  id,
  count,
  checked,
  onChange,
}: {
  id: string;
  /** How many inactive items exist — the toggle hides itself at zero. */
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (count === 0) return null;
  return (
    <label htmlFor={id} className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      Show inactive ({count})
    </label>
  );
}

type DeletableItem = { id: number; name: string; active: boolean };

type DeleteFlowState =
  | { kind: "checking"; item: DeletableItem }
  | { kind: "confirm"; item: DeletableItem }
  | { kind: "deleting"; item: DeletableItem }
  | { kind: "in_use"; item: DeletableItem; usage: string[] }
  | { kind: "error"; item: DeletableItem; message: string };

/**
 * One pending delete at a time per list. `begin(item)` checks usage first;
 * `panelFor(id)` renders that item's inline confirm / refusal panel (or
 * nothing). In-page rather than window.confirm — see the note on the
 * roster's remove confirmation (components/admin/event-roster.tsx).
 */
export function useDeleteFlow({
  noun,
  hiddenWhenInactive,
  checkUsage,
  remove,
  deactivate,
  onDone,
}: {
  /** e.g. "role type" — used in the panel copy. */
  noun: string;
  /** What deactivating does, finishing "Deactivating it …". */
  hiddenWhenInactive: string;
  checkUsage: (id: number) => Promise<UsageResult>;
  remove: (id: number) => Promise<DeleteResult>;
  deactivate: (id: number) => Promise<unknown>;
  /** Called after a delete or deactivate — typically router.refresh(). */
  onDone: () => void;
}) {
  const [state, setState] = useState<DeleteFlowState | null>(null);

  const begin = async (item: DeletableItem) => {
    setState({ kind: "checking", item });
    const result = await checkUsage(item.id);
    if (!result.ok) {
      setState({ kind: "error", item, message: result.error });
    } else if (result.usage.length > 0) {
      setState({ kind: "in_use", item, usage: result.usage });
    } else {
      setState({ kind: "confirm", item });
    }
  };

  const confirmDelete = async (item: DeletableItem) => {
    setState({ kind: "deleting", item });
    const result = await remove(item.id);
    if (result.ok) {
      setState(null);
      onDone();
    } else if (result.usage) {
      setState({ kind: "in_use", item, usage: result.usage });
    } else {
      setState({ kind: "error", item, message: result.error });
    }
  };

  const deactivateInstead = async (item: DeletableItem) => {
    setState({ kind: "deleting", item });
    await deactivate(item.id);
    setState(null);
    onDone();
  };

  const isBusy = (id: number) =>
    state?.item.id === id && (state.kind === "checking" || state.kind === "deleting");

  const panelFor = (id: number): ReactNode => {
    if (!state || state.item.id !== id || state.kind === "checking") return null;
    const { item } = state;
    const close = (
      <Button type="button" size="sm" variant="outline" onClick={() => setState(null)}>
        {state.kind === "confirm" ? "Cancel" : "Close"}
      </Button>
    );

    if (state.kind === "confirm" || state.kind === "deleting") {
      return (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm">
          <p>
            Delete the {noun} &ldquo;{item.name}&rdquo;? Nothing uses it. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={state.kind === "deleting"}
              onClick={() => confirmDelete(item)}
            >
              {state.kind === "deleting" ? "Deleting..." : "Delete"}
            </Button>
            {close}
          </div>
        </div>
      );
    }

    if (state.kind === "in_use") {
      return (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            &ldquo;{item.name}&rdquo; can&apos;t be deleted because it&apos;s in use:
          </p>
          <ul className="list-disc pl-5">
            {state.usage.map((line) => (
              <li key={line}>{line.charAt(0).toUpperCase() + line.slice(1)}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            {item.active
              ? `Deactivate it instead — deactivating ${hiddenWhenInactive}.`
              : "It's already inactive, so it's hidden from new events."}
          </p>
          <div className="flex gap-2">
            {item.active && (
              <Button type="button" size="sm" onClick={() => deactivateInstead(item)}>
                Deactivate instead
              </Button>
            )}
            {close}
          </div>
        </div>
      );
    }

    return (
      <div className="mt-3 flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
        <p>{state.message}</p>
        <div>{close}</div>
      </div>
    );
  };

  return { begin, panelFor, isBusy };
}
