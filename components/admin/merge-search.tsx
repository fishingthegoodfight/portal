"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { searchMergeCandidatesAction, type MergeCandidate } from "@/lib/actions/person-merge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Picking the other profile by hand on the merge page: a search by name,
 * email or phone, each result linking to the comparison. */
export function MergeSearch({ userId }: { userId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; people: MergeCandidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchMergeCandidatesAction(trimmed, userId);
      if (cancelled) return;
      setError(result.ok ? null : result.error);
      setResults({ query: trimmed, people: result.ok ? result.people : [] });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, userId]);

  const shown = trimmed.length >= 2 && results?.query === trimmed ? results.people : null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid gap-2">
        <Label htmlFor="merge_search">Find their other profile</Label>
        <Input
          id="merge_search"
          autoComplete="off"
          placeholder="Name, email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {shown &&
        (shown.length === 0 ? (
          <p className="text-muted-foreground">No matching people.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {shown.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/protected/admin/people/${userId}/merge?with=${p.id}`}
                  className="flex flex-col gap-0.5 p-2 hover:bg-muted"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {[p.email, p.phone, p.chapter].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
