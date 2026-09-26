"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendPortalInvitesAction } from "@/lib/actions/volunteer-invite";
import { Button } from "@/components/ui/button";

/** "Send portal invite" for one volunteer on their page — the list's
 * action, for someone who has never signed in. */
export function SendPortalInviteButton({ volunteerId, resend }: { volunteerId: string; resend: boolean }) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setIsSending(true);
    setMessage(null);
    const result = await sendPortalInvitesAction([volunteerId]);
    setIsSending(false);
    const outcome = result.ok ? result.outcomes[0] : null;
    setMessage(!result.ok ? result.error : outcome?.ok ? "Invite sent." : (outcome?.error ?? "Failed"));
    if (outcome?.ok) router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      <Button type="button" variant="outline" size="sm" disabled={isSending} onClick={handleClick}>
        {isSending ? "Sending..." : resend ? "Re-send invite" : "Send portal invite"}
      </Button>
    </div>
  );
}
