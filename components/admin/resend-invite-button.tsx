"use client";

import { useState } from "react";

import { inviteVolunteerAction } from "@/lib/actions/volunteer-invite";
import { Button } from "@/components/ui/button";

export function ResendInviteButton({ email }: { email: string }) {
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setIsSending(true);
    setMessage(null);
    const result = await inviteVolunteerAction({ email });
    setIsSending(false);
    setMessage(result.ok ? "Invite re-sent." : result.error);
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={isSending} onClick={handleClick}>
        {isSending ? "Sending..." : "Resend invite"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
