import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { codePagePath } from "@/lib/code-page";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;

  // A password-setup link (a volunteer or portal invite, a resend for
  // someone who never finished one, or a link sent from this page — see
  // lib/actions/volunteer-invite.ts, person-invite.ts, new-link.ts) always
  // sends people through /auth/update-password on its way to where they're
  // headed. Recognizing that `next` prefix here, rather than just `type`,
  // is what keeps this specific to that flow instead of also firing for an
  // unrelated expired "forgot password" link, which is also `type=
  // recovery` but heads somewhere else.
  // A password-setup or reset link from before codes (an invite, a resend,
  // "send me a new link", the walk-up welcome, or Forgot password): those
  // links are gone, often used up by a mail scanner before the person
  // clicked. The code page is the way in now; nothing has to be asked of
  // an admin.
  if (params?.next?.startsWith("/auth/update-password") || params?.type === "recovery") {
    const inner = params?.next?.startsWith("/auth/update-password")
      ? new URLSearchParams(params.next.split("?")[1] ?? "").get("next")
      : null;
    return (
      <div className="flex flex-col gap-4">
        <CardTitle className="text-2xl">This link has expired</CardTitle>
        <p className="text-sm text-muted-foreground">
          We don&apos;t use links for this any more. Send yourself a code instead: it arrives while
          you&apos;re on the page, and you type it in with a new password.
        </p>
        <Button asChild className="w-full">
          <Link href={codePagePath({ mode: "setup", next: inner })}>Send me a new code</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          Already set a password?{" "}
          <Link href="/auth/login" className="underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <CardTitle className="mb-4 text-2xl">Sorry, something went wrong.</CardTitle>
      {params?.error ? (
        <p className="text-sm text-muted-foreground">
          Code error: {params.error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An unspecified error occurred.
        </p>
      )}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; type?: string; next?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            {/* The heading is ErrorContent's: it depends on what went wrong. */}
            <CardHeader className="pb-0" />
            <CardContent>
              <Suspense>
                <ErrorContent searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
