"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { inviteVolunteerAction } from "@/lib/actions/volunteer-invite";
import { createApprovedVolunteerAction } from "@/lib/actions/volunteer-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Two admin entry points into the registry, in one card: inviting someone
 * through the normal flow (creates the account if needed, emails a
 * registration link), or backfilling someone already approved outside the
 * portal (skips the invite/registration steps entirely — see
 * createApprovedVolunteerAction).
 */
export function InviteVolunteerForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"invite" | "backfill">("invite");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    const result = await inviteVolunteerAction({ email, name });
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(result.wasResend ? "Invite re-sent." : "Invite sent.");
    setEmail("");
    setName("");
    router.refresh();
  };

  const handleBackfill = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    const result = await createApprovedVolunteerAction({ email, firstName, lastName });
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/protected/admin/volunteers/${result.volunteerId}`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{mode === "invite" ? "Invite volunteer" : "Add approved volunteer"}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode(mode === "invite" ? "backfill" : "invite");
              setError(null);
              setSuccess(null);
            }}
          >
            {mode === "invite" ? "Backfill an already-approved volunteer instead" : "Invite someone instead"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {mode === "invite" ? (
          <form onSubmit={handleInvite} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Creates the volunteer record and emails a link to the registration form. Re-invite the
              same email any time — it won&apos;t duplicate the record.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite_email">Email</Label>
                <Input
                  id="invite_email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite_name">Name (optional)</Label>
                <Input id="invite_name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send invite"}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleBackfill} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              For someone already approved outside the portal — creates their record straight at
              &quot;Approved&quot;, skipping the invite and registration form. No email is sent.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="backfill_first">First name</Label>
                <Input id="backfill_first" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backfill_last">Last name</Label>
                <Input id="backfill_last" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backfill_email">Email</Label>
                <Input
                  id="backfill_email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Adding..." : "Add as approved volunteer"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
