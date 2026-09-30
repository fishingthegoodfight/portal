import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";

import { NewLinkForm } from "@/components/new-link-form";

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
  if (params?.next?.startsWith("/auth/update-password")) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          This link has expired or was already used. Enter your email and we&apos;ll send you a
          new one.
        </p>
        <NewLinkForm />
        <p className="text-sm text-muted-foreground">
          Already set a password?{" "}
          <Link href="/auth/login" className="underline underline-offset-4">
            Sign in
          </Link>
          , or use{" "}
          <Link href="/auth/forgot-password" className="underline underline-offset-4">
            Forgot password
          </Link>
          .
        </p>
      </div>
    );
  }

  if (params?.type === "recovery") {
    return (
      <p className="text-sm text-muted-foreground">
        This password reset link has expired or was already used. Request a new one from the{" "}
        <Link href="/auth/forgot-password" className="underline underline-offset-4">
          forgot password page
        </Link>
        .
      </p>
    );
  }

  return (
    <>
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
            <CardHeader>
              <CardTitle className="text-2xl">
                Sorry, something went wrong.
              </CardTitle>
            </CardHeader>
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
