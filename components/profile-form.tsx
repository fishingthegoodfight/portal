"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CHAPTERS, NOT_LOCAL_CHAPTER } from "@/lib/chapters";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import { US_STATES } from "@/lib/us-states";

type ProfileData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  chapter: string;
  emergency_contact: string;
  emergency_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
};

export function ProfileForm({
  userId,
  initialProfile,
  returnTo,
}: {
  userId: string;
  initialProfile: ProfileData;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData>(initialProfile);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateField = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile((prev) => ({ ...prev, [field]: e.target.value }));
      setSuccess(false);
    };

  const updatePhoneField = (field: "phone" | "emergency_phone") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile((prev) => ({
        ...prev,
        [field]: formatPhoneNumber(e.target.value),
      }));
      setSuccess(false);
    };

  const updateChapter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfile((prev) => ({ ...prev, chapter: e.target.value }));
    setSuccess(false);
  };

  const updateState = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfile((prev) => ({ ...prev, state: e.target.value }));
    setSuccess(false);
  };

  const updatePostalCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile((prev) => ({
      ...prev,
      postal_code: formatPostalCode(e.target.value),
    }));
    setSuccess(false);
  };

  // Address lines and city are free text — we don't force casing (too easy
  // to mangle things like "PO Box" or "McAllister St"), just clean up stray
  // whitespace once the user is done typing, not on every keystroke.
  const normalizeOnBlur = (field: "address_line1" | "address_line2" | "city") =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const normalized = e.target.value.trim().replace(/\s+/g, " ");
      if (normalized !== profile[field]) {
        setProfile((prev) => ({ ...prev, [field]: normalized }));
      }
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Plain UPDATE, not upsert: the profiles row is created for each user
      // by a signup trigger, and RLS only grants users UPDATE on their own
      // row (not INSERT), so an upsert's ON CONFLICT INSERT path gets
      // rejected. .select().maybeSingle() lets us detect "no row matched"
      // (e.g. the trigger hasn't run yet) instead of silently no-op'ing.
      const { data: updated, error } = await supabase
        .from("profiles")
        .update(profile)
        .eq("id", userId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!updated) {
        throw new Error(
          "No profile row exists for your account yet. Contact an admin, or try signing out and back in.",
        );
      }
      setSuccess(true);
      if (returnTo) {
        // Give the "Profile saved" message a beat on screen before leaving,
        // so the save doesn't look like it silently no-op'd.
        setTimeout(() => router.push(returnTo), 900);
      }
    } catch (error: unknown) {
      // Log the full error (message alone often hides the useful `hint`/`code`
      // for RLS and constraint failures) so it's visible in the browser console.
      console.error("Profile save failed:", error);
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "An error occurred";
      const hint =
        error && typeof error === "object" && "hint" in error
          ? (error as { hint?: string }).hint
          : undefined;
      setError(hint ? `${message} (${hint})` : message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact details</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                required
                value={profile.first_name}
                onChange={updateField("first_name")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                required
                value={profile.last_name}
                onChange={updateField("last_name")}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={profile.email}
              onChange={updateField("email")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              placeholder="(303) 555-0100"
              maxLength={14}
              value={profile.phone}
              onChange={updatePhoneField("phone")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="chapter">Chapter</Label>
            <Select id="chapter" value={profile.chapter} onChange={updateChapter}>
              <option value="">Select a chapter</option>
              {CHAPTERS.map((chapter) => (
                <option key={chapter.name} value={chapter.name}>
                  {chapter.name}, {chapter.state}
                </option>
              ))}
              <option value={NOT_LOCAL_CHAPTER}>{NOT_LOCAL_CHAPTER}</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address_line1">Address line 1</Label>
            <Input
              id="address_line1"
              value={profile.address_line1}
              onChange={updateField("address_line1")}
              onBlur={normalizeOnBlur("address_line1")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address_line2">Address line 2</Label>
            <Input
              id="address_line2"
              placeholder="Apt, suite, etc. (optional)"
              value={profile.address_line2}
              onChange={updateField("address_line2")}
              onBlur={normalizeOnBlur("address_line2")}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={profile.city}
                onChange={updateField("city")}
                onBlur={normalizeOnBlur("city")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Select id="state" value={profile.state} onChange={updateState}>
                <option value="">State</option>
                {US_STATES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="postal_code">ZIP code</Label>
              <Input
                id="postal_code"
                inputMode="numeric"
                placeholder="12345"
                maxLength={10}
                value={profile.postal_code}
                onChange={updatePostalCode}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="emergency_contact">Emergency contact</Label>
              <Input
                id="emergency_contact"
                value={profile.emergency_contact}
                onChange={updateField("emergency_contact")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emergency_phone">Emergency phone</Label>
              <Input
                id="emergency_phone"
                type="tel"
                inputMode="numeric"
                placeholder="(303) 555-0100"
                maxLength={14}
                value={profile.emergency_phone}
                onChange={updatePhoneField("emergency_phone")}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && (
            <p className="text-sm text-green-600">
              Profile saved.
              {returnTo ? " Returning to your RSVP..." : ""}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Saving..."
              : returnTo
                ? "Save & return to RSVP"
                : "Save profile"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
