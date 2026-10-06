"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { sendWalkupWelcomeCatchUpAction } from "@/lib/actions/walkup-welcome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RevealPanel } from "@/components/reveal-panel";

type Person = { userId: string; name: string; email: string; eventName: string; eventDate: string };

/**
 * The catch-up list on Setup → Walk-up welcome emails: everyone ticked to
 * start, untick anyone who shouldn't get it, then send — after a "Send to N
 * people?" confirmation. Nothing is sent until then.
 */
export function WalkupWelcomeCatchUp({ people }: { people: Person[] }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(people.map((p) => p.userId)));
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ sent: number; failed: { name: string; error: string }[]; skipped: number } | null>(
    null,
  );

  if (people.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {outcome
            ? `Sent ${outcome.sent}. Nobody else is waiting for a welcome email.`
            : "Nobody is waiting for a welcome email."}
        </CardContent>
      </Card>
    );
  }

  const count = people.filter((p) => ticked.has(p.userId)).length;
  const nameOf = new Map(people.map((p) => [p.userId, p.name]));

  const toggle = (userId: string, on: boolean) => {
    setConfirming(false);
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const send = async () => {
    setSending(true);
    setError(null);
    const result = await sendWalkupWelcomeCatchUpAction(people.filter((p) => ticked.has(p.userId)).map((p) => p.userId));
    setSending(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOutcome({
      sent: result.sent.length,
      failed: result.failed.map((f) => ({ name: nameOf.get(f.userId) ?? f.userId, error: f.error })),
      skipped: result.skipped.length,
    });
    router.refresh();
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        {outcome && (
          <RevealPanel role="status" className="text-sm">
            Sent {outcome.sent}.
            {outcome.skipped > 0 && ` ${outcome.skipped} skipped: no longer on the list (signed in or already sent).`}
            {outcome.failed.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-red-500">
                {outcome.failed.map((f) => (
                  <li key={f.name}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </RevealPanel>
        )}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {count} of {people.length} ticked
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setConfirming(false);
                setTicked(new Set(people.map((p) => p.userId)));
              }}
            >
              Tick all
            </button>
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setConfirming(false);
                setTicked(new Set());
              }}
            >
              Untick all
            </button>
          </div>
        </div>
        <ul className="flex flex-col">
          {people.map((person) => (
            <li key={person.userId} className="border-b py-2 last:border-b-0">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ticked.has(person.userId)}
                  onChange={(e) => toggle(person.userId, e.target.checked)}
                  disabled={sending}
                />
                <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                  <span className="font-medium">{person.name}</span>
                  <span className="text-muted-foreground">{person.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {person.eventName} · {person.eventDate}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <RevealPanel role="alert" revealKey={error} className="text-sm text-red-500">
            {error}
          </RevealPanel>
        )}
        {confirming ? (
          <RevealPanel className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">
              Send the welcome email to {count} {count === 1 ? "person" : "people"} now?
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={sending} onClick={send}>
                {sending ? "Sending..." : "Yes, send"}
              </Button>
              <Button size="sm" variant="outline" disabled={sending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </RevealPanel>
        ) : (
          <Button className="w-fit" disabled={count === 0 || sending} onClick={() => setConfirming(true)}>
            Send to {count} {count === 1 ? "person" : "people"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
