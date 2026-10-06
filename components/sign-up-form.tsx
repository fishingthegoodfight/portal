"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";

import { RegistrationFieldInput } from "@/components/registration-fields";
import { formatPhoneNumber } from "@/lib/phone";
import { withNext } from "@/lib/safe-next";
import { REGISTRATION_SECTIONS } from "@/lib/registration-sections";

const DIRECTORY_FIELD = REGISTRATION_SECTIONS.find((s) => s.id === "directory")!
  .fields[0];

export function SignUpForm({
  className,
  next,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  /** Where to go once the account is ready (already checked with safeNext),
   * e.g. the RSVP page of the public event they came from. */
  next: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [directoryOptIn, setDirectoryOptIn] = useState("false");
  const [error, setError] = useState<string | null>(null);
  // Their email already has an account — usually one we made when they
  // checked in at an event, which has no password yet.
  const [existingAccount, setExistingAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    setExistingAccount(false);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Your first and last name are required");
      setIsLoading(false);
      return;
    }
    if (phone.replace(/\D/g, "").length !== 10) {
      setError("Enter a 10-digit phone number");
      setIsLoading(false);
      return;
    }
    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const destination = next ?? "/protected/events";
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${destination}`,
          data: {
            // Read by the handle_new_user trigger onto the new profile: with
            // email confirmation there's no session yet, so this is the only
            // way to save them at sign-up. Chapter and emergency contact come
            // later, on the RSVP form (lib/core-profile.ts).
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone,
            directory_opt_in: directoryOptIn === "true",
            // Where they were headed, saved ON THE ACCOUNT so it survives the
            // email-confirmation round trip whatever the confirmation link
            // carries, even opened on another device: /auth/confirm (and the
            // login form, as a fallback) read it back, then clear it.
            ...(next ? { return_to: next } : {}),
          },
        },
      });
      // An email that already has an account: with email confirmation on,
      // Supabase answers with a stand-in user with no identities and sends
      // nothing (so it doesn't reveal who has an account); with it off, it
      // returns user_already_exists. Either way the password above wasn't
      // saved, so point them at Forgot password instead of "check your
      // email".
      if (error?.code === "user_already_exists" || (!error && data.user?.identities?.length === 0)) {
        setExistingAccount(true);
        return;
      }
      if (error) throw error;
      // Hard navigation: if email confirmation is off, signUp establishes a
      // session immediately, same as signInWithPassword — see the comments
      // in login-form.tsx / logout-button.tsx for why this can't be
      // router.push/refresh. With a session there's nothing to confirm, so
      // go straight on.
      window.location.href = data.session
        ? destination
        : withNext("/auth/sign-up-success", next);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="first_name">First name</Label>
                  <Input
                    id="first_name"
                    autoComplete="given-name"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input
                    id="last_name"
                    autoComplete="family-name"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(303) 555-0100"
                  maxLength={14}
                  required
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repeat Password</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              <RegistrationFieldInput
                field={DIRECTORY_FIELD}
                value={directoryOptIn}
                onChange={(_key, value) => setDirectoryOptIn(value)}
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              {existingAccount && (
                <p className="rounded-md border bg-muted/50 p-3 text-sm">
                  You already have an account. We may have created it when you checked in at
                  an event. Use{" "}
                  <Link href="/auth/forgot-password" className="underline underline-offset-4">
                    Forgot password
                  </Link>{" "}
                  to set your password.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating an account..." : "Sign up"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link href={withNext("/auth/login", next)} className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
