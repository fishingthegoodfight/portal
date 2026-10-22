"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { inviteVolunteerAction } from "@/lib/actions/volunteer-invite";
import { Button } from "@/components/ui/button";

/** Invites someone to the volunteer team, or re-sends their invite, from
 * their profile: whatever state their account is in (see
 * inviteVolunteerAction). */
export function VolunteerInviteButton({ email, name, label }: { email: string; name: string; label: string }) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setIsSending(true);
    setMessage(null);
    const result = await inviteVolunteerAction({ email, name });
    setIsSending(false);
    setMessage(result.ok ? (result.wasResend ? "Invite re-sent." : "Invite sent.") : result.error);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={isSending} onClick={handleClick}>
        {isSending ? "Sending..." : label}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
