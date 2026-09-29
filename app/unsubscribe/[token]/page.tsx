import type { Metadata } from "next";
import { Suspense } from "react";

import { lookupUnsubscribeToken } from "@/lib/email-preferences";
import { UnsubscribeForm } from "@/components/unsubscribe-form";

/**
 * /unsubscribe/<token>: the footer link in the volunteer opportunities
 * email, no login (the proxy lets it through). Opening the link changes
 * nothing — email security scanners open links too — so it asks for one
 * tap. Mail clients' own one-click button posts to /api/unsubscribe/<token>.
 */
export const metadata: Metadata = {
  title: "Email preferences · Fishing the Good Fight",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = Promise<{ token: string }>;

async function UnsubscribeLoader({ params }: { params: Params }) {
  const { token } = await params;
  const lookup = await lookupUnsubscribeToken(token);
  if (!lookup.found) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">This link isn&apos;t active</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find the email settings this link is for. You can change which emails you
          get on your profile once you&apos;ve signed in.
        </p>
      </div>
    );
  }
  return <UnsubscribeForm token={token} maskedEmail={lookup.maskedEmail} initiallySubscribed={lookup.subscribed} />;
}

export default function UnsubscribePage({ params }: { params: Params }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <UnsubscribeLoader params={params} />
      </Suspense>
    </main>
  );
}
