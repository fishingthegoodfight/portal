"use client";

import { useState } from "react";

import { sendTestTextAction } from "@/lib/actions/texting";
import { Button } from "@/components/ui/button";

/** Setup → Texting: "Send test text" to the signed-in admin's own number. */
export function TestTextButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await sendTestTextAction();
      setResult(r.ok ? { ok: true, text: r.message ?? "Sent." } : { ok: false, text: r.error });
    } catch {
      setResult({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send test text"}
        </Button>
      </div>
      {result && <p className={result.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-red-500"}>{result.text}</p>}
    </div>
  );
}
