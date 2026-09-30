"use client";

import { useEffect, useState } from "react";

import {
  leadAccountStatusAction,
  searchLeadCandidatesAction,
  type LeadCandidate,
} from "@/lib/actions/event-lead";
import type { LeadAccount } from "@/lib/admin/lead-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneNumber } from "@/lib/phone";

const ROLE_NOTE: Record<string, string> = {
  admin: "admin",
  chapter_lead: "chapter lead",
};

/**
 * The event lead block, shared by the admin event create and edit forms so
 * the two never drift apart: an optional person-picker over accounts (the
 * chosen person gets manage rights on the event — events.lead_user_id, see
 * can_manage_event), then the free-text name/phone/email shown to attendees,
 * which picking a person fills from their profile and which stay editable
 * (and are all there is for a lead without an account).
 *
 * The two can disagree — typing a name and email gives nobody access, and
 * retyping them leaves the old account assigned — so the block always says
 * which it is: who (if anyone) is assigned and can manage the event, by the
 * account's own name, and when the typed email belongs to an account, an
 * offer to assign it in one click. Saving with one account assigned and
 * another account's email typed is refused (leadAssignmentProblem).
 */
export function LeadContactFields({
  idPrefix,
  name,
  phone,
  email,
  leadUserId,
  onChangeName,
  onChangePhone,
  onChangeEmail,
  onChangeLeadUserId,
}: {
  idPrefix: string;
  name: string;
  phone: string;
  email: string;
  /** profiles.id of the linked account, or "". */
  leadUserId: string;
  onChangeName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onChangeLeadUserId: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The picked person's name as the picker showed it — falls back to the
  // lead name/email text (e.g. on the edit form, or a restored draft).
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchLeadCandidatesAction(trimmed);
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
  }, [trimmed]);

  // Who is actually assigned, and whether the typed email is an account's —
  // looked up for exactly what's in the form now (a stale answer is ignored).
  const emailKey = email.trim().toLowerCase();
  const emailComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey);
  const [account, setAccount] = useState<{
    forUser: string;
    forEmail: string;
    assigned: LeadAccount | null;
    emailMatch: LeadAccount | null;
  } | null>(null);
  useEffect(() => {
    if (!leadUserId && !emailComplete) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await leadAccountStatusAction({ leadUserId, email: emailComplete ? emailKey : "" });
      if (cancelled || !result.ok) return;
      setAccount({ forUser: leadUserId, forEmail: emailKey, assigned: result.assigned, emailMatch: result.emailMatch });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leadUserId, emailKey, emailComplete]);
  const current = account && account.forUser === leadUserId && account.forEmail === emailKey ? account : null;
  const assigned = leadUserId ? (current?.assigned ?? null) : null;
  const emailMatch = emailComplete ? (current?.emailMatch ?? null) : null;
  const checking = (Boolean(leadUserId) || emailComplete) && !current;
  // The typed email is someone else's account than the one assigned.
  const otherAccount = leadUserId && emailMatch && emailMatch.id !== leadUserId ? emailMatch : null;

  /** One click from "this email has an account" to assigned. The contact
   * details typed so far are kept; a blank name takes the account's. */
  const assign = (person: LeadAccount) => {
    onChangeLeadUserId(person.id);
    if (!name.trim()) onChangeName(person.name);
    setPickedLabel(person.name || person.email);
  };

  const pick = (person: LeadCandidate) => {
    onChangeLeadUserId(person.id);
    onChangeName(person.name);
    onChangeEmail(person.email);
    onChangePhone(formatPhoneNumber(person.phone));
    setPickedLabel(person.name || person.email);
    setQuery("");
    setResults([]);
  };

  const unlink = () => {
    onChangeLeadUserId("");
    setPickedLabel(null);
  };

  const linkedLabel =
    assigned?.name ?? pickedLabel ?? (name.trim() || email.trim() || "the linked account");
  const typedName = name.trim();
  const nameDiffers =
    Boolean(assigned && typedName) && typedName.toLowerCase() !== assigned!.name.trim().toLowerCase();
  const emailDiffers =
    Boolean(assigned && emailComplete) && !otherAccount && emailKey !== assigned!.email.trim().toLowerCase();
  const showResults = trimmed.length >= 2;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_lead_search`}>Event lead</Label>
        {leadUserId ? (
          <div className="flex flex-col gap-2 rounded-md border border-blue-600/40 bg-blue-600/5 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p>
                <span className="font-medium">{linkedLabel}</span>
                {assigned?.email && <span className="text-muted-foreground"> · {assigned.email}</span>}{" "}
                <span className="text-muted-foreground">— assigned, can manage this event</span>
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={unlink}>
                Remove
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {linkedLabel} can manage this event: see the roster with contact details, emergency
              contacts and registration answers, check people in, add walk-ups and volunteers,
              and edit it. Cancelling and restoring are for admins and the chapter&apos;s lead. Remove the
              assignment to take that away — the contact details below stay.
            </p>
            {otherAccount ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-sm">
                <p>
                  The lead email below belongs to <span className="font-medium">{otherAccount.name}</span>,
                  but the event is assigned to <span className="font-medium">{linkedLabel}</span>. It
                  can&apos;t be saved named as one person and assigned to another.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => assign(otherAccount)}>
                    Assign {otherAccount.name} instead
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={unlink}>
                    Remove the assignment
                  </Button>
                </div>
              </div>
            ) : (
              (nameDiffers || emailDiffers) && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  The contact details below
                  {nameDiffers ? ` name “${typedName}”` : ""}
                  {nameDiffers && emailDiffers ? " and" : ""}
                  {emailDiffers ? " use a different email" : ""}. That&apos;s what attendees see;{" "}
                  {linkedLabel} is who has access. If the lead has changed, remove the assignment
                  and pick the new person.
                </p>
              )
            )}
          </div>
        ) : (
          <>
            <Input
              id={`${idPrefix}_lead_search`}
              type="search"
              autoComplete="off"
              placeholder="Search people by name or email (optional)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim().length < 2) setResults([]);
              }}
              aria-describedby={`${idPrefix}_lead_search_help`}
            />
            <p id={`${idPrefix}_lead_search_help`} className="text-xs text-muted-foreground">
              Pick the lead&apos;s account to give them manage rights on this event and fill in
              their contact details. For a lead without an account, just fill in the fields below.
            </p>
            {showResults && (
              <div className="rounded-md border text-sm" role="listbox" aria-label="Matching people">
                {searching && results.length === 0 ? (
                  <p className="p-2 text-muted-foreground">Searching…</p>
                ) : searchError ? (
                  <p className="p-2 text-red-500">{searchError}</p>
                ) : results.length === 0 ? (
                  <p className="p-2 text-muted-foreground">No matching people.</p>
                ) : (
                  results.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => pick(person)}
                      className="flex w-full flex-col items-start border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                    >
                      <span className="font-medium">
                        {person.name || person.email}
                        {ROLE_NOTE[person.role] && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {ROLE_NOTE[person.role]}
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
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_lead_name`}>Lead name</Label>
          <Input
            id={`${idPrefix}_lead_name`}
            placeholder="Day-of contact"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}_lead_phone`}>Lead phone</Label>
          <Input
            id={`${idPrefix}_lead_phone`}
            type="tel"
            inputMode="numeric"
            placeholder="(303) 555-0100"
            maxLength={14}
            value={phone}
            onChange={(e) => onChangePhone(formatPhoneNumber(e.target.value))}
          />
        </div>
        <div className="grid gap-2 col-span-2">
          <Label htmlFor={`${idPrefix}_lead_email`}>Lead email</Label>
          <Input
            id={`${idPrefix}_lead_email`}
            type="email"
            value={email}
            onChange={(e) => onChangeEmail(e.target.value)}
          />
        </div>
      </div>

      {/* Nobody assigned: say plainly what typing a name and email does. */}
      {!leadUserId && emailMatch ? (
        <div className="flex flex-col gap-2 rounded-md border border-blue-600/40 bg-blue-600/5 p-3 text-sm">
          <p>
            <span className="font-medium">{emailMatch.name}</span> has an account with this email, but
            isn&apos;t assigned — so far these are contact details only, and they can&apos;t manage
            the event.
          </p>
          <Button type="button" size="sm" className="w-fit" onClick={() => assign(emailMatch)}>
            Assign {emailMatch.name} as lead
          </Button>
        </div>
      ) : (
        !leadUserId &&
        !checking &&
        (typedName || emailKey) && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Contact details only: {typedName || "this person"} won&apos;t be able to manage this event
            {emailComplete ? " — no account you can assign has this email" : ""}. To give them access,
            pick their account in the search above.
          </p>
        )
      )}
    </div>
  );
}
