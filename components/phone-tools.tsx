"use client";

import { useState } from "react";

import { toE164 } from "@/lib/phone";

type LogResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * A person's phone number with what you do with it: tap the number to call,
 * Text opens your own messaging app (an sms: link, one person only — never
 * a group, so nobody's number is shown to anyone else), Copy for a laptop,
 * and Log text to record that you texted them (a "text" touch). Members
 * and the event roster use it.
 */
export function PhoneTools({
  phone,
  name,
  onLogText,
}: {
  phone: string;
  name: string;
  /** Omitted where texting can't be logged. */
  onLogText?: () => Promise<LogResult>;
}) {
  const e164 = toE164(phone);
  const [copied, setCopied] = useState(false);
  const [logState, setLogState] = useState<null | "busy" | { done: string } | { error: string }>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (not a secure context): the number is right there to select.
    }
  };

  const logText = async () => {
    if (!onLogText) return;
    setLogState("busy");
    try {
      const result = await onLogText();
      setLogState(result.ok ? { done: result.message ?? "Text logged" } : { error: result.error });
    } catch {
      setLogState({ error: "Couldn't reach the server" });
    }
  };

  const action = "font-medium text-foreground underline-offset-4 hover:underline";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <a href={e164 ? `tel:${e164}` : `tel:${phone.replace(/\D/g, "")}`} className="hover:underline">
        {phone}
      </a>
      {e164 && (
        <a href={`sms:${e164}`} className={action} aria-label={`Text ${name}`}>
          Text
        </a>
      )}
      <button type="button" onClick={copy} className={action} aria-label={`Copy ${name}'s number`}>
        {copied ? "Copied" : "Copy"}
      </button>
      {onLogText &&
        (logState && typeof logState === "object" && "done" in logState ? (
          <span className="text-green-700 dark:text-green-400">{logState.done}</span>
        ) : (
          <button type="button" onClick={logText} disabled={logState === "busy"} className={action}>
            {logState === "busy" ? "Logging…" : "Log text"}
          </button>
        ))}
      {logState && typeof logState === "object" && "error" in logState && (
        <span className="text-red-500">{logState.error}</span>
      )}
    </span>
  );
}
