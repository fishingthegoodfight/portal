import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { NewWaiverForm } from "@/components/admin/new-waiver-form";
import { WaiverText } from "@/components/waiver-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { waiverStateName, waiverStatesForChapters } from "@/lib/waivers";
import { loadChapters } from "@/lib/chapters";

type WaiverRow = {
  id: number;
  state: string;
  year: number;
  version: number;
  title: string;
  body_markdown: string;
  is_active: boolean;
  created_at: string;
};

async function WaiversLoader() {
  const supabase = await createClient();
  // Participant waivers only — the volunteer waiver (audience 'volunteer')
  // is seeded separately and isn't managed from this page.
  const [{ data, error }, chapters] = await Promise.all([
    supabase
      .from("waivers")
      .select("id, state, year, version, title, body_markdown, is_active, created_at")
      .eq("audience", "participant")
      .order("state", { ascending: true })
      .order("year", { ascending: false })
      .order("version", { ascending: false }),
    loadChapters(supabase),
  ]);

  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load waivers: {error.message}</p>;
  }
  const waivers = (data ?? []) as WaiverRow[];

  // The one participants are asked to sign for each state + year: the
  // highest active version.
  const currentIds = new Set<number>();
  const seen = new Set<string>();
  for (const w of waivers) {
    const key = `${w.state}-${w.year}`;
    if (w.is_active && !seen.has(key)) {
      seen.add(key);
      currentIds.add(w.id);
    }
  }

  const latestByState: Record<string, { title: string; bodyMarkdown: string }> = {};
  for (const w of waivers) {
    if (!(w.state in latestByState)) {
      latestByState[w.state] = { title: w.title, bodyMarkdown: w.body_markdown };
    }
  }

  // Every chapter's state, in chapter order, then any other state that
  // already has waivers (e.g. its chapter was since moved).
  const chapterStates = waiverStatesForChapters(chapters);
  const groups = Array.from(new Set([...chapterStates, ...waivers.map((w) => w.state)]))
    .map((code) => ({ code, rows: waivers.filter((w) => w.state === code) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      <NewWaiverForm latestByState={latestByState} states={chapterStates} />

      {waivers.length === 0 && (
        <p className="text-sm text-muted-foreground">No waivers yet. Add the first one above.</p>
      )}

      {groups.map(({ code, rows }) => (
        <Card key={code}>
          <CardHeader>
            <CardTitle>{waiverStateName(code)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {rows.map((w) => (
              <details key={w.id} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">
                    {w.year} · v{w.version} · {w.title}
                  </span>
                  {currentIds.has(w.id) && (
                    <span className="ml-2 rounded-full bg-green-600/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-500">
                      Current
                    </span>
                  )}
                  {!w.is_active && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Inactive
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    added {new Date(w.created_at).toISOString().slice(0, 10)}
                  </span>
                </summary>
                <div className="mt-3 max-h-96 overflow-y-auto border-t pt-3">
                  <WaiverText markdown={w.body_markdown} />
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

export default function AdminWaiversPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Waivers</h1>
        <p className="text-sm text-muted-foreground">
          One waiver per state per year. A waiver can&apos;t be edited once added, because people
          sign that exact text — to change it, add a new version.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <WaiversLoader />
      </Suspense>
    </div>
  );
}
