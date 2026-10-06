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
 * "Already in the system?" for the roster's Add walk-up and Add volunteer
 * forms: search people by name or email (searchEventPeopleAction) and pick
 * one, which hands their email to the form. The form's own lookup and
 * checks take it from there.
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
  const [results, setResults] = useState<EventPersonCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchEventPeopleAction(eventId, trimmed);
      if (cancelled) return;
      setSearching(false);
      if (!result.ok) {
        setSearchError(result.error);
        setResults([]);
        return;
      }
      setSearchError(null);
      setResults(result.people);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eventId, trimmed]);

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_person_search`}>Find someone already in the system</Label>
      <Input
        id={`${idPrefix}_person_search`}
        type="search"
        autoComplete="off"
        placeholder="Search by name or email"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) setResults([]);
        }}
      />
      {trimmed.length >= 2 && (
        <div className="rounded-md border text-sm" role="listbox" aria-label="Matching people">
          {searching && results.length === 0 ? (
            <p className="p-2 text-muted-foreground">Searching…</p>
          ) : searchError ? (
            <p className="p-2 text-red-500">{searchError}</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-muted-foreground">No matching people. Enter their email below instead.</p>
          ) : (
            results.map((person) => (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  onPick(person);
                }}
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
      )}
    </div>
  );
}
