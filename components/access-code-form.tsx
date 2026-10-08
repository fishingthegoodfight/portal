"use client";

import Link from "next/link";
import { useState } from "react";

import { requestAccessCodeAction, verifyAccessCodeAction } from "@/lib/actions/access-code";
import type { CodeMode } from "@/lib/code-page";
import { CODE_LIFETIME, CODE_MIN_GAP_MINUTES } from "@/lib/one-time-links";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const COPY: Record<CodeMode, { title: string; description: string; submit: string }> = {
  setup: {
    title: "Set up your account",
    description: "Send yourself a code, then type it here with the password you'd like.",
    submit: "Set password and sign in",
  },
  reset: {
    title: "Reset your password",
    description: "Send yourself a code, then type it here with a new password.",
    submit: "Set password and sign in",
  },
  signup: {
    title: "Confirm your email",
    description: "We've emailed you a six-digit code. Type it here to finish signing up.",
    submit: "Confirm and continue",
  },
};

/**
 * The code page's form (app/auth/code): email, the six-digit code, and —
 * when setting or resetting a password — the new password. "Send me a
 * code" emails one right then (requestAccessCodeAction), so it arrives while
 * they're here. On success it's a hard navigation, same as the login form:
 * the session just changed.
 */
export function AccessCodeForm({
  mode,
  initialEmail,
  next,
  justSent,
}: {
  mode: CodeMode;
  initialEmail: string;
  next: string | null;
  /** Sign-up just sent the first code (Supabase's email). */
  justSent: boolean;
}) {
  const copy = COPY[mode];
  const settingPassword = mode !== "signup";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(justSent && initialEmail ? initialEmail : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    setSending(true);
    const result = await requestAccessCodeAction({ email, mode, next });
    setSending(false);
    if (!result.ok) return setError(result.error);
    setSentTo(email.trim());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (settingPassword && password !== repeat) return setError("The two passwords don't match.");
    setSubmitting(true);
    const result = await verifyAccessCodeAction({ email, code, mode, password: settingPassword ? password : undefined, next });
    if (!result.ok) {
      setSubmitting(false);
      return setError(result.error);
    }
    window.location.href = result.destination;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="code_email">Email</Label>
            <Input
              id="code_email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSentTo(null);
              }}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            {sentTo ? (
              <p role="status">
                If {sentTo} has an account here, a code is on its way. It lasts {CODE_LIFETIME} and works once.
                Check your spam folder if it isn&apos;t there in a minute or two.
              </p>
            ) : (
              <p className="text-muted-foreground">
                {mode === "signup" ? "Didn't get the code?" : "We'll email you a six-digit code."}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={sending || !email.trim()}
              onClick={sendCode}
            >
              {sending ? "Sending..." : sentTo ? "Send me a new code" : "Send me a code"}
            </Button>
            {sentTo && (
              <p className="text-xs text-muted-foreground">
                A new code can be sent every {CODE_MIN_GAP_MINUTES} minutes. Only the latest one works.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="code_value">Code</Label>
            <Input
              id="code_value"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              placeholder="123456"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-lg tracking-widest"
            />
          </div>

          {settingPassword && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="code_password">New password</Label>
                <Input
                  id="code_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="code_repeat">Repeat password</Label>
                <Input
                  id="code_repeat"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Checking..." : copy.submit}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already know your password?{" "}
            <Link href="/auth/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
