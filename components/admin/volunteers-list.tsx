"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendPortalInvitesAction, type PortalInviteOutcome } from "@/lib/actions/volunteer-invite";
import { timezoneForChapter } from "@/lib/chapters";
import { formatDateInZone } from "@/lib/format-date";
import {
  PORTAL_INVITE_BATCH_LIMIT,
  VOLUNTEER_STATUS_LABELS,
  type AccountState,
  type VolunteerStatus,
} from "@/lib/volunteers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type VolunteerListItem = {
  userId: string;
  status: VolunteerStatus;
  firstName: string;
  lastName: string;
  email: string;
  chapter: string;
  roles: string[];
  certMissingOrExpired: boolean;
  /** null when account states couldn't be loaded. */
  account: AccountState | null;
};

function displayName(v: VolunteerListItem) {
  return [v.firstName, v.lastName].filter(Boolean).join(" ") || v.email || v.userId;
}

/** Someone who has signed in already has a working account — nothing to
 * invite them to. */
function canInvite(v: VolunteerListItem) {
  return v.account != null && v.account.kind !== "active" && Boolean(v.email);
}

/**
 * The Volunteers list with each person's account state and "Send portal
 * invite" — one at a time from the row, or ticked and sent together, at
 * most PORTAL_INVITE_BATCH_LIMIT at once. There is deliberately no "select
 * all".
 */
export function VolunteersList({ volunteers }: { volunteers: VolunteerListItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sendingIds, setSendingIds] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<PortalInviteOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(volunteers.map((v) => [v.userId, v]));
  // Filters can hide a ticked row — only what's still listed and invitable counts.
  const selection = selected.filter((id) => byId.has(id) && canInvite(byId.get(id)!));
  const atLimit = selection.length >= PORTAL_INVITE_BATCH_LIMIT;

  const send = async (ids: string[]) => {
    setSendingIds(ids);
    setError(null);
    setOutcomes(null);
    const result = await sendPortalInvitesAction(ids);
    setSendingIds([]);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOutcomes(result.outcomes);
    setSelected((prev) => prev.filter((id) => !result.outcomes.some((o) => o.ok && o.volunteerId === id)));
    router.refresh();
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const sending = sendingIds.length > 0;
  const sent = outcomes?.filter((o) => o.ok) ?? [];
  const failed = outcomes?.filter((o) => !o.ok) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {selection.length === 0
              ? `Tick volunteers without an account to invite them together (up to ${PORTAL_INVITE_BATCH_LIMIT}).`
              : `${selection.length} selected${atLimit ? ` — the most one batch can send` : ` (up to ${PORTAL_INVITE_BATCH_LIMIT})`}`}
          </span>
          {selection.length > 0 && !confirming && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <Button type="button" size="sm" disabled={sending} onClick={() => setConfirming(true)}>
                Send portal invites…
              </Button>
            </div>
          )}
        </div>
        {confirming && (
          <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
            <p>
              Email a portal invite to {selection.length} {selection.length === 1 ? "person" : "people"}? Each gets
              a link to set a password and complete registration. Anyone already invited gets a fresh link.
            </p>
            <p className="text-xs text-muted-foreground">
              {selection.map((id) => displayName(byId.get(id)!)).join(", ")}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={sending} onClick={() => send(selection)}>
                {sending ? "Sending..." : `Send ${selection.length} ${selection.length === 1 ? "invite" : "invites"}`}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-red-500">{error}</p>}
        {outcomes && (
          <div className="flex flex-col gap-1">
            {sent.length > 0 && (
              <p className="text-green-600">
                Sent to {sent.length}: {sent.map((o) => o.name || o.email).join(", ")}
              </p>
            )}
            {failed.map((o) => (
              <p key={o.volunteerId} className="text-red-500">
                {o.name || o.email}: {o.error}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col divide-y rounded-md border">
        {volunteers.map((v) => {
          const invitable = canInvite(v);
          const isSelected = selection.includes(v.userId);
          return (
            <div key={v.userId} className="flex items-start gap-3 p-3 text-sm">
              <Checkbox
                className="mt-1"
                aria-label={`Select ${displayName(v)}`}
                checked={isSelected}
                disabled={!invitable || sending || (atLimit && !isSelected)}
                onCheckedChange={(checked) => toggle(v.userId, checked === true)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/protected/admin/volunteers/${v.userId}`} className="flex min-w-0 flex-col hover:underline">
                  <span className="font-medium">{displayName(v)}</span>
                  <span className="text-xs text-muted-foreground">
                    {v.chapter || "No chapter"} · {v.email}
                  </span>
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{VOLUNTEER_STATUS_LABELS[v.status]}</Badge>
                  {v.roles.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                  {v.certMissingOrExpired && <Badge variant="destructive">Cert missing/expired</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                <AccountStateLabel account={v.account} chapter={v.chapter} />
                {invitable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={sending}
                    onClick={() => send([v.userId])}
                  >
                    {sendingIds.length === 1 && sendingIds[0] === v.userId
                      ? "Sending..."
                      : v.account?.kind === "invited"
                        ? "Re-send invite"
                        : "Send portal invite"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AccountStateLabel({ account, chapter }: { account: AccountState | null; chapter: string }) {
  if (!account) return <span className="text-muted-foreground">Account: unknown</span>;
  if (account.kind === "active") return <span className="text-green-700 dark:text-green-400">Active</span>;
  if (account.kind === "invited") {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        Invited {formatDateInZone(account.invitedAt, timezoneForChapter(chapter))}
      </span>
    );
  }
  return <span className="text-muted-foreground">No account</span>;
}
