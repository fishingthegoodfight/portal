import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { withNext } from "@/lib/safe-next";
import { PRIVACY_POLICY_URL, SMS_CONSENT_TEXT, TERMS_URL } from "@/lib/sms-consent";

export const metadata: Metadata = {
  title: "Text messages · Fishing the Good Fight",
  description: "How Fishing the Good Fight members opt in to event and volunteer text messages, and the program terms.",
};

/**
 * The public page for the SMS program (Twilio 10DLC): shows the opt-in
 * exactly as members see it on their profile and the RSVP form (the box
 * itself lives behind sign-in, where reviewers can't reach it), and the
 * program terms. Static: nothing here reads or changes data.
 */
export default function SmsProgramPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 md:p-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Fishing the Good Fight Event &amp; Volunteer Texts</h1>
        <p className="text-muted-foreground">
          Members of Fishing the Good Fight can choose to get text messages about the events and retreats they&apos;ve
          signed up for. Texts are optional and only sent to members who opt in.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How members opt in</h2>
        <p className="text-sm">
          Signed-in members see this optional checkbox next to their mobile number in the &ldquo;Emails and
          texts&rdquo; section of their profile, and in &ldquo;Your details&rdquo; on an event RSVP form. It starts
          unchecked, and ticking it is never required to join, RSVP or volunteer. We record when each member opts in
          and the exact wording they agreed to.
        </p>
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              As shown in the member portal
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled className="mt-0.5 size-4 shrink-0" aria-label="Text message consent (example)" />
              <span>{SMS_CONSENT_TEXT}</span>
            </label>
          </CardContent>
        </Card>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href={withNext("/auth/login", "/protected/profile")}>Members: sign in to opt in</Link>
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Program terms</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <span className="font-medium">What we send:</span> reminders and logistics for events and retreats
            you&apos;ve signed up for (dates, locations, arrival information, schedule or weather changes), volunteer
            coordination, and follow-up such as post-event surveys and photo-sharing links. No marketing or
            fundraising texts.
          </li>
          <li>
            <span className="font-medium">Frequency:</span> message frequency varies, typically a few messages per
            event or retreat.
          </li>
          <li>
            <span className="font-medium">Cost:</span> message and data rates may apply.
          </li>
          <li>
            <span className="font-medium">Opt out:</span> reply STOP to any message, or uncheck the box on your
            profile. Reply START to rejoin.
          </li>
          <li>
            <span className="font-medium">Help:</span> reply HELP, or contact tcramer@fishingthegoodfight.org or
            414-322-7245.
          </li>
          <li>Mobile carriers are not liable for delayed or undelivered messages.</li>
          <li>
            No mobile information will be shared with third parties or affiliates for marketing or promotional
            purposes. Text messaging opt-in data and consent will not be shared with any third parties.
          </li>
        </ul>
        {(PRIVACY_POLICY_URL || TERMS_URL) && (
          <p className="flex flex-wrap gap-x-4 text-sm">
            {PRIVACY_POLICY_URL && (
              <a href={PRIVACY_POLICY_URL} className="underline underline-offset-4" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
            )}
            {TERMS_URL && (
              <a href={TERMS_URL} className="underline underline-offset-4" target="_blank" rel="noreferrer">
                Terms of Service
              </a>
            )}
          </p>
        )}
      </section>
    </main>
  );
}
