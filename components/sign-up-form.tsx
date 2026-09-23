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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [directoryOptIn, setDirectoryOptIn] = useState("false");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

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
            // Read by the handle_new_user trigger into profiles.directory_opt_in.
            directory_opt_in: directoryOptIn === "true",
            // Where they were headed, saved ON THE ACCOUNT so it survives the
            // email-confirmation round trip whatever the confirmation link
            // carries, even opened on another device: /auth/confirm (and the
            // login form, as a fallback) read it back, then clear it.
            ...(next ? { return_to: next } : {}),
          },
        },
      });
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
