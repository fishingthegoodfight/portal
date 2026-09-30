"use client";

import { useState } from "react";

import { requestNewLinkAction } from "@/lib/actions/new-link";
import { ONE_TIME_LINK_LIFETIME } from "@/lib/one-time-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Send me a new link" — on the page an expired or already-used invite
 * link lands on (app/auth/error). */
export function NewLinkForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const result = await requestNewLinkAction(email);
      if (result.ok) setSentTo(email.trim());
      else setError(result.error);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  };

  if (sentTo) {
    return (
      <p role="status" className="text-sm">
        If {sentTo} has an account here, a new link is on its way. It works once and lasts{" "}
        {ONE_TIME_LINK_LIFETIME}. Check your spam folder if it isn&apos;t there in a few minutes.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-2">
        <Label htmlFor="new_link_email">Your email</Label>
        <Input
          id="new_link_email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={sending}>
        {sending ? "Sending..." : "Send me a new link"}
      </Button>
    </form>
  );
}
