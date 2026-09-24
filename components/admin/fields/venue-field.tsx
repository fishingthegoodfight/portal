"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { findVenueByName, venueAddressLine, venuesForChapter, type Venue } from "@/lib/venues";

/**
 * Venue name as a combo box: type freely for a one-off venue, or pick a
 * saved one (lib/venues.ts) to fill in the address — which stays editable.
 * Offers the event's chapter's venues (plus all-chapter ones) with a toggle
 * to see every chapter's. When the typed name isn't a saved venue and
 * `onSaveVenueChange` is given, offers "Save this venue for next time".
 */
export function VenueField({
  idPrefix,
  value,
  required,
  venues,
  chapter,
  onChangeName,
  onPick,
  saveVenue,
  onSaveVenueChange,
}: {
  idPrefix: string;
  value: string;
  required: boolean;
  /** Active saved venues this person can see. */
  venues: Venue[];
  /** The event's chapter — scopes the list. "" shows every venue. */
  chapter: string;
  onChangeName: (name: string) => void;
  onPick: (venue: Venue) => void;
  saveVenue?: boolean;
  /** Omit to never offer saving (no permission, or a template). */
  onSaveVenueChange?: (save: boolean) => void;
}) {
  const inputId = `${idPrefix}_venue`;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const scoped = showAllChapters ? venues : venuesForChapter(venues, chapter);
  const query = value.trim().toLowerCase();
  // Once the name exactly matches a venue (e.g. just picked), show the whole
  // list again rather than narrowing to that one.
  const exact = findVenueByName(scoped, value);
  const options = (
    query && !exact
      ? scoped.filter((v) =>
          `${v.name} ${venueAddressLine(v)}`.toLowerCase().includes(query),
        )
      : scoped
  )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const hasOtherChapters = Boolean(chapter) && venuesForChapter(venues, chapter).length < venues.length;

  // "New" = not a saved venue for this chapter (a same-named venue from
  // another chapter doesn't count — saving adds this chapter's own).
  const isNewName =
    value.trim() !== "" && !findVenueByName(venuesForChapter(venues, chapter), value);

  const pick = (venue: Venue) => {
    onPick(venue);
    onSaveVenueChange?.(false);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open && options[highlight]) {
      e.preventDefault();
      pick(options[highlight]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="grid gap-2 col-span-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId}>Venue name</Label>
        {hasOtherChapters && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={showAllChapters}
              onCheckedChange={(c) => setShowAllChapters(c === true)}
            />
            Show all chapters&apos; venues
          </label>
        )}
      </div>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[highlight] ? `${listId}-${options[highlight].id}` : undefined}
          autoComplete="off"
          required={required}
          placeholder={venues.length > 0 ? "Pick a saved venue or type a new one" : undefined}
          value={value}
          onChange={(e) => {
            onChangeName(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Let a click on an option land before the list closes.
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {open && options.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background p-1 shadow-md"
          >
            {options.map((venue, i) => (
              <li
                key={venue.id}
                id={`${listId}-${venue.id}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown, not click: fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(venue);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                  i === highlight && "bg-muted",
                )}
              >
                <div className="font-medium">
                  {venue.name}
                  {showAllChapters && venue.chapter && venue.chapter !== chapter && (
                    <span className="font-normal text-muted-foreground"> · {venue.chapter}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{venueAddressLine(venue)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onSaveVenueChange && isNewName && (
        <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={saveVenue ?? false}
            onCheckedChange={(c) => onSaveVenueChange(c === true)}
          />
          Save this venue for next time
        </label>
      )}
    </div>
  );
}
