"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createWaiverVersionAction } from "@/lib/actions/waiver";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WAIVER_STATES } from "@/lib/waivers";

/**
 * Adds a new waiver version. Existing versions are never edited — the form
 * can prefill from the latest text as a starting point, but saving always
 * creates a new row that supersedes the older ones for that state + year.
 */
export function NewWaiverForm({
  latestByState,
}: {
  latestByState: Record<string, { title: string; bodyMarkdown: string }>;
}) {
  const router = useRouter();
  const [state, setState] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const latest = state ? latestByState[state] : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createWaiverVersionAction({
        state,
        year: Number(year),
        title,
        bodyMarkdown: body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Added version ${result.version}.`);
      setTitle("");
      setBody("");
      router.refresh();
    } catch (err) {
      console.error("Add waiver failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Add a waiver version</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="waiver_state">State</Label>
              <Select
                id="waiver_state"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">Choose a state</option>
                {Object.entries(WAIVER_STATES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="waiver_year">Year</Label>
              <Input
                id="waiver_year"
                type="number"
                inputMode="numeric"
                required
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="waiver_title">Title</Label>
            <Input
              id="waiver_title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="waiver_body">Waiver text (Markdown)</Label>
              {latest && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBody(latest.bodyMarkdown);
                    if (!title) setTitle(latest.title);
                  }}
                >
                  Start from latest {state} text
                </Button>
              )}
            </div>
            <Textarea
              id="waiver_body"
              required
              className="min-h-64 font-mono text-xs"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This becomes the current waiver for that state and year. Everyone who signed an earlier
            version will be asked to sign this one at their next RSVP. It can&apos;t be edited
            afterwards.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
          {message && <p className="text-sm text-green-600">{message}</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Adding..." : "Add version"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
