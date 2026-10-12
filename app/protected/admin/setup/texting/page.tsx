import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { TestTextButton } from "@/components/admin/test-text-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEventInstant } from "@/lib/format-date";
import { SMS_CONSENT_IS_PLACEHOLDER } from "@/lib/sms-consent";

type SmsRow = { id: number; to_phone: string | null; body: string; status: string; error: string | null; created_at: string };

async function RecentTexts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sms_messages")
    .select("id, to_phone, body, status, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as SmsRow[];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No texts sent yet.</p>;
  return (
    <ul className="flex flex-col divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5 py-2 [overflow-wrap:anywhere]">
          <span>
            <span className="font-medium">{r.status}</span> · {r.to_phone ?? "no number"} ·{" "}
            {formatEventInstant(r.created_at, "America/Denver")}
          </span>
          <span className="text-muted-foreground">{r.body}</span>
          {r.error && <span className="text-red-500">{r.error}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Setup → Texting (admins; the Setup layout's gate): the groundwork for
 * texting through FTGF's Twilio Messaging Service (lib/twilio.ts). A test
 * text to yourself, and the latest texts with their delivery status.
 */
export default function TextingSetupPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Texting</h1>
        <p className="text-sm text-muted-foreground">
          Texts go through FTGF&apos;s Twilio Messaging Service, only to people who&apos;ve agreed to texts on their
          profile. Replying STOP or START to the number turns that off or on in the portal too.
        </p>
      </div>
      {SMS_CONSENT_IS_PLACEHOLDER && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          The consent wording is still a placeholder (lib/sms-consent.ts), so only admins can agree to texts for now.
          Paste the registered 10DLC wording there to offer it to everyone.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Test text</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Texts the number on your own profile. It only goes if you&apos;ve ticked the texts box on{" "}
            <Link href="/protected/profile#messages" className="underline underline-offset-4">
              your profile
            </Link>
            , same as for anyone.
          </p>
          <TestTextButton />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Latest texts</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
            <RecentTexts />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
