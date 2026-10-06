"use client";

import { useEffect, useState } from "react";

import { searchEventPeopleAction, type EventPersonCandidate } from "@/lib/actions/event-people";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RSVP_NOTE: Record<string, string> = {
  confirmed: "already on the roster",
  waitlisted: "on the waitlist",
  offered: "has an open offer",
};

/**
 * The matches for `query` (2+ characters) from searchEventPeopleAction, as a
 * pickable list: the part of the person search that sits under an input the
 * caller owns. `onResults` reports each finished search, so the caller can
 * tell "nobody found" from "found but not picked". `emptyText` replaces the
 * no-match line.
 */
export function EventPersonResults({
  eventId,
  query,
  onPick,
  onResults,
  emptyText = "No matching people.",
}: {
  eventId: number;
  query: string;
  onPick: (person: EventPersonCandidate) => void;
  onResults?: (people: EventPersonCandidate[]) => void;
  emptyText?: string;
}) {
  const [results, setResults] = useState<{ query: string; people: EventPersonCandidate[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchEventPeopleAction(eventId, trimmed);
      if (cancelled) return;
      if (!result.ok) {
        setSearchError(result.error);
        setResults({ query: trimmed, people: [] });
        onResults?.([]);
        return;
      }
      setSearchError(null);
      setResults({ query: trimmed, people: result.people });
      onResults?.(result.people);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onResults is a callback prop; re-running the search when its identity
    // changes would only repeat the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, trimmed]);

  if (trimmed.length < 2) return null;
  // Results for an earlier query are kept on screen while the next loads.
  const people = results?.people ?? [];
  const searching = results?.query !== trimmed;

  return (
    <div className="rounded-md border text-sm" role="listbox" aria-label="Matching people">
      {searching && people.length === 0 ? (
        <p className="p-2 text-muted-foreground">Searching…</p>
      ) : searchError ? (
        <p className="p-2 text-red-500">{searchError}</p>
      ) : people.length === 0 ? (
        <p className="p-2 text-muted-foreground">{emptyText}</p>
      ) : (
        people.map((person) => (
          <button
            key={person.id}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(person)}
            className="flex w-full flex-col items-start border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
          >
            <span className="font-medium">
              {person.name || person.email}
              {person.rsvpStatus && RSVP_NOTE[person.rsvpStatus] && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {RSVP_NOTE[person.rsvpStatus]}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {[person.email, person.chapter].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/**
 * "Already in the system?" for the roster's Add volunteer form: its own
 * search input over EventPersonResults. Picking someone hands their email to
 * the form, whose own lookup and checks take it from there.
 */
export function EventPersonSearch({
  eventId,
  idPrefix,
  onPick,
}: {
  eventId: number;
  idPrefix: string;
  onPick: (person: EventPersonCandidate) => void;
}) {
  const [query, setQuery] = useState("");

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_person_search`}>Find someone already in the system</Label>
      <Input
        id={`${idPrefix}_person_search`}
        type="search"
        autoComplete="off"
        placeholder="Search by name or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <EventPersonResults
        eventId={eventId}
        query={query}
        emptyText="No matching people. Enter their email below instead."
        onPick={(person) => {
          setQuery("");
          onPick(person);
        }}
      />
    </div>
  );
}
