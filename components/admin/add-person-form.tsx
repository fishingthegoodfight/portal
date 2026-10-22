"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, ShieldCheck } from "lucide-react";

import { invitePersonAction } from "@/lib/actions/person-invite";
import { inviteVolunteerAction } from "@/lib/actions/volunteer-invite";
import { ROLE_LABELS, SCREENING_FLAG_RULE, screeningFlagGrants, type Role } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** What they're joining as: the volunteer team, or a site role. */
type JoiningAs = "volunteer" | Role;

const JOINING_AS_HELP: Record<JoiningAs, string> = {
  volunteer:
    "They get an email to set up their sign-in and fill in the volunteer registration form. You approve their roles from their page afterwards.",
  participant:
    "An account and nothing more: they can RSVP and see their profile. For board members and anyone who needs to sign in without joining the volunteer team.",
  chapter_lead: "Can create and run events in the chapters picked below. Not a volunteer unless you invite them as one too.",
  admin: "Can do everything.",
};

/**
 * Members → "Add a person" (admins only): invites someone to the volunteer
 * team (inviteVolunteerAction), or gives them an account with a site role
 * and any sensitive-data access set up front (invitePersonAction). Someone
 * who already has an account is changed from their page instead.
 */
export function AddPersonForm({
  chapterOptions,
}: {
  /** The chapters a lead can be given: active chapters, then Virtual
   * (eventChapterNames). */
  chapterOptions: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [joiningAs, setJoiningAs] = useState<JoiningAs>("volunteer");
  const [chapters, setChapters] = useState<string[]>([]);
  const [screening, setScreening] = useState(false);
  const [healthHistory, setHealthHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setJoiningAs("volunteer");
    setChapters([]);
    setScreening(false);
    setHealthHistory(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    setSuccess(null);
    const result =
      joiningAs === "volunteer"
        ? await inviteVolunteerAction({ email, name })
        : await invitePersonAction({
            email,
            name,
            role: joiningAs,
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

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          Add a person
        </Button>
        {success && <p className="text-sm text-green-600">{success}</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a person</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Already has an account? Find them under Everyone and change their role, or invite them to volunteer, from
          their page.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
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
            <Label htmlFor="person_invite_role">Joining as</Label>
            <Select
              id="person_invite_role"
              value={joiningAs}
              onChange={(e) => setJoiningAs(e.target.value as JoiningAs)}
            >
              <option value="volunteer">Volunteer</option>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{JOINING_AS_HELP[joiningAs]}</p>
          </div>

          {joiningAs === "chapter_lead" && (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Chapters they lead</span>
              <div className="flex flex-wrap gap-4 text-sm">
                {chapterOptions.map((chapter) => (
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

          {joiningAs !== "volunteer" && (
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
                    {screening ? screeningFlagGrants(joiningAs, chapters) : SCREENING_FLAG_RULE}
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
          )}

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
      </CardContent>
    </Card>
  );
}
