import type { Metadata } from "next";
import { Suspense } from "react";

import { lookupReferenceToken } from "@/lib/reference-form";
import { ReferenceForm, ReferenceThankYou } from "@/components/reference-form";

/**
 * /reference/<token>: the public reference form, no login (the proxy lets
 * it through). The token is the only key: the page shows the applicant's
 * name and the reference's own, and nothing else about the applicant. Once
 * answered the link only says thank you; a replaced reference's link, or
 * one for a closed application, says it's no longer active.
 */
export const metadata: Metadata = {
  title: "Reference · Fishing the Good Fight",
  robots: { index: false, follow: false },
  // Keep the token out of the Referer header of anything this page links to.
  referrer: "no-referrer",
};

type Params = Promise<{ token: string }>;

async function ReferenceLoader({ params }: { params: Params }) {
  const { token } = await params;
  const lookup = await lookupReferenceToken(token);
  if (lookup.state === "submitted") return <ReferenceThankYou />;
  if (lookup.state !== "open") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">This link isn&apos;t active</h1>
        <p className="text-sm text-muted-foreground">
          We don&apos;t need a reference through this link any more — thank you all the same. If you think
          that&apos;s a mistake, reply to the email it came in.
        </p>
      </div>
    );
  }
  return (
    <ReferenceForm
      token={token}
      applicantName={lookup.applicantName}
      referenceName={lookup.referenceName}
      slot={lookup.slot}
      fishingQuestions={lookup.fishingQuestions}
    />
  );
}

export default function ReferencePage({ params }: { params: Params }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ReferenceLoader params={params} />
      </Suspense>
    </main>
  );
}
