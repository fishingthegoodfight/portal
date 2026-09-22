import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";

const CONTACT_EMAIL = "tcramer@fishingthegoodfight.org";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;

  // A password-setup link (a fresh invite, or a resend for someone who
  // never finished one — see lib/actions/volunteer-invite.ts) always sends
  // people through /auth/update-password on its way to the registration
  // form. Recognizing that `next` prefix here, rather than just `type`, is
  // what keeps this message specific to that flow instead of also firing
  // for an unrelated expired "forgot password" link, which is also `type=
  // recovery` but heads somewhere else.
  if (params?.next?.startsWith("/auth/update-password")) {
    return (
      <p className="text-sm text-muted-foreground">
        This invitation link has expired or was already used. Ask whoever invited you to send a
        new one, or contact{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
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
