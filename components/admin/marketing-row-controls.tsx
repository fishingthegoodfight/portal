"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { setEventPostedAction } from "@/lib/actions/marketing";
import { MARKETING_CHANNEL_LABELS, type MarketingChannel } from "@/lib/marketing";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** "Posted to website" — saved as soon as it's ticked, with who ticked it
 * and when shown underneath. */
export function PostedToggle({
  eventId,
  channel,
  posted,
  postedLabel,
}: {
  eventId: number;
  channel: MarketingChannel;
  posted: boolean;
  /** "Tom Smith · Sep 25", worked out on the server; null when not posted. */
  postedLabel: string | null;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(posted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `posted_${channel}_${eventId}`;

  const toggle = async (next: boolean) => {
    setChecked(next);
    setSaving(true);
    setError(null);
    const result = await setEventPostedAction(eventId, channel, next);
    setSaving(false);
    if (!result.ok) {
      setChecked(!next);
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={saving}
          onCheckedChange={(c) => toggle(c === true)}
        />
        <label htmlFor={id} className="text-sm">
          Posted to {MARKETING_CHANNEL_LABELS[channel]}
        </label>
      </div>
      {saving ? (
        <span className="pl-6 text-xs text-muted-foreground">Saving…</span>
      ) : (
        checked &&
        postedLabel && <span className="pl-6 text-xs text-muted-foreground">{postedLabel}</span>
      )}
      {error && <span className="pl-6 text-xs text-red-500">{error}</span>}
    </div>
  );
}

/** Copies text to the clipboard — the event as plain text for the website,
 * or just its public link. */
export function CopyEventButton({
  text,
  label = "Copy text",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  return (
    <Button type="button" size="sm" variant="outline" onClick={copy}>
      {state === "copied" ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </Button>
  );
}
