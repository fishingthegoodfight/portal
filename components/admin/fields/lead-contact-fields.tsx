"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneNumber } from "@/lib/phone";

/**
 * The lead-contact block (name/phone/email) shared by the admin event
 * create and edit forms, so the two never drift apart in field order,
 * labels, or the phone mask.
 */
export function LeadContactFields({
  idPrefix,
  name,
  phone,
  email,
  onChangeName,
  onChangePhone,
  onChangeEmail,
}: {
  idPrefix: string;
  name: string;
  phone: string;
  email: string;
  onChangeName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeEmail: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_lead_name`}>Lead name</Label>
        <Input
          id={`${idPrefix}_lead_name`}
          placeholder="Day-of contact"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_lead_phone`}>Lead phone</Label>
        <Input
          id={`${idPrefix}_lead_phone`}
          type="tel"
          inputMode="numeric"
          placeholder="(303) 555-0100"
          maxLength={14}
          value={phone}
          onChange={(e) => onChangePhone(formatPhoneNumber(e.target.value))}
        />
      </div>
      <div className="grid gap-2 col-span-2">
        <Label htmlFor={`${idPrefix}_lead_email`}>Lead email</Label>
        <Input
          id={`${idPrefix}_lead_email`}
          type="email"
          value={email}
          onChange={(e) => onChangeEmail(e.target.value)}
        />
      </div>
    </div>
  );
}
