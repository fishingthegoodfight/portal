import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";

/** Only a hint for the reader — the actual return trip is carried by the
 * account itself (see sign-up-form.tsx / app/auth/confirm/route.ts). */
async function ReturnNote({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (!safeNext(next)) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Once you confirm, you&apos;ll be taken right back to finish what you started.
    </p>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Thank you for signing up!
              </CardTitle>
              <CardDescription>Check your email to confirm</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                You&apos;ve successfully signed up. Please check your email to
                confirm your account before signing in.
              </p>
              <Suspense fallback={null}>
                <ReturnNote searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
