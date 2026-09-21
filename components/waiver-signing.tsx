"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WaiverText } from "@/components/waiver-text";
import type { WaiverInfo } from "@/lib/waivers";

export type WaiverSignState = { agreed: boolean; name: string };
export const EMPTY_WAIVER_SIGN: WaiverSignState = { agreed: false, name: "" };

/** True when the waiver still needs this person's agreement + typed name. */
export function waiverNeedsInput(info: WaiverInfo | null, sign: WaiverSignState): boolean {
  if (!info) return false;
  if (info.status === "unavailable") return true;
  if (info.status === "signed") return false;
  return !sign.agreed || !sign.name.trim();
}

/**
 * The waiver as shown on the RSVP form and the admin walk-up form: the full
 * text in a scrollable box, an "I have read and agree" checkbox, and a typed
 * full name. Once a valid signature exists it shows only the "Signed for …"
 * line — deliberately no edit link, since a signature can't be changed.
 */
export function WaiverSigning({
  info,
  value,
  onChange,
  idPrefix,
}: {
  info: WaiverInfo;
  value: WaiverSignState;
  onChange: (next: WaiverSignState) => void;
  idPrefix: string;
}) {
  if (info.status === "signed") {
    return <p className="text-sm text-muted-foreground">{info.label}.</p>;
  }

  if (info.status === "unavailable") {
    return <p className="text-sm text-amber-600">{info.message}</p>;
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm font-medium">{info.heading}</p>
      <div
        tabIndex={0}
        role="region"
        aria-label={info.title}
        className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3"
      >
        <p className="mb-2 font-semibold">{info.title}</p>
        <WaiverText markdown={info.bodyMarkdown} />
      </div>
      <label className="flex items-start gap-2 text-sm font-medium">
        <input
          id={`${idPrefix}_waiver_agree`}
          type="checkbox"
          className="mt-1"
          checked={value.agreed}
          onChange={(e) => onChange({ ...value, agreed: e.target.checked })}
        />
        I have read and agree to the waiver above
      </label>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_waiver_name`}>Type your full name to sign</Label>
        <Input
          id={`${idPrefix}_waiver_name`}
          autoComplete="off"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>
    </div>
  );
}
