"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HeartPulse, ShieldCheck } from "lucide-react";

import { invitePersonAction } from "@/lib/actions/person-invite";
import { ROLE_LABELS, SCREENING_FLAG_RULE, screeningFlagGrants, type Role } from "@/lib/roles";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const CHAPTER_OPTIONS = [...CHAPTERS.map((c) => c.name), VIRTUAL_CHAPTER];

/**
 * "Invite a person" — an account and a profile for someone who isn't
 * joining the volunteer team (staff, board members). Role and
 * sensitive-data access can be set up front. See invitePersonAction.
 */
export function InvitePersonForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("participant");
  const [chapters, setChapters] = useState<string[]>([]);
  const [screening, setScreening] = useState(false);
  const [healthHistory, setHealthHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setRole("participant");
    setChapters([]);
    setScreening(false);
    setHealthHistory(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    setSuccess(null);
    const result = await invitePersonAction({
      email,
      name,
      role,
      ledChapters: chapters,
      canViewScreening: screening,
      canViewHealthHistory: healthHistory,
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(result.wasResend ? `Invite re-sent to ${email.trim()}.` : `Invite sent to ${email.trim()}.`);
    reset();
    setOpen(false);
    router.refresh();
  };

  const toggleChapter = (chapter: string, checked: boolean) =>
    setChapters((prev) => (checked ? [...prev, chapter] : prev.filter((c) => c !== chapter)));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Invite a person</CardTitle>
          {!open && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              Invite someone
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          An account for someone who needs to sign in but isn&apos;t joining the volunteer team —
          staff, board members. They get an email to set a password, then land on their profile.
          No volunteer record is created; to invite a volunteer, use{" "}
          <Link href="/protected/admin/volunteers" className="underline underline-offset-4">
            Volunteers
          </Link>
          .
        </p>
        {success && !open && <p className="text-sm text-green-600">{success}</p>}

        {open && (
          <form onSubmit={submit} className="flex flex-col gap-4 border-t pt-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="person_invite_name">Name</Label>
                <Input
                  id="person_invite_name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="person_invite_email">Email</Label>
                <Input
                  id="person_invite_email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="person_invite_role">Role</Label>
              <Select
                id="person_invite_role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>

            {role === "chapter_lead" && (
              <div className="grid gap-2">
                <span className="text-sm font-medium">Chapters they lead</span>
                <div className="flex flex-wrap gap-4 text-sm">
                  {CHAPTER_OPTIONS.map((chapter) => (
                    <label key={chapter} className="flex items-center gap-2">
                      <Checkbox
                        checked={chapters.includes(chapter)}
                        onCheckedChange={(c) => toggleChapter(chapter, c === true)}
                      />
                      {chapter}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={screening}
                  onCheckedChange={(c) => setScreening(c === true)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
                    Volunteer screening
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {screening ? screeningFlagGrants(role, chapters) : SCREENING_FLAG_RULE}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-rose-500/40 p-2 text-sm">
                <Checkbox
                  className="mt-0.5 border-rose-600 data-[state=checked]:bg-rose-600 data-[state=checked]:text-white"
                  checked={healthHistory}
                  onCheckedChange={(c) => setHealthHistory(c === true)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-400">
                    <HeartPulse className="size-4" aria-hidden />
                    Health histories
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Only applies within the events this person already manages.
                  </span>
                </span>
              </label>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={sending}>
                {sending ? "Sending..." : "Send invite"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={sending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
