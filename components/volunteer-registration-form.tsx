"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  loadVolunteerWaiverInfoAction,
  submitVolunteerRegistrationAction,
  type SubmitVolunteerRegistrationInput,
} from "@/lib/actions/volunteer-register";
import { HomeChapterField } from "@/components/chapter-select";
import { US_STATES } from "@/lib/us-states";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import { PROGRAM_INTERESTS, SKILL_INTERESTS, TSHIRT_SIZES } from "@/lib/volunteers";
import { WaiverSigning, EMPTY_WAIVER_SIGN, waiverNeedsInput, type WaiverSignState } from "@/components/waiver-signing";
import type { WaiverInfo } from "@/lib/waivers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type ProfileData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  emergency_contact: string;
  emergency_phone: string;
  chapter: string;
  tshirt_size: string;
  favorite_snack: string;
  favorite_na_beverage: string;
  skill_interests: string[];
  skill_interests_other: string;
  program_interests: string[];
};

export function VolunteerRegistrationForm({
  userId,
  alreadyRegistered,
  initialProfile,
}: {
  userId: string;
  /** True once status has moved past 'invited' — the form still works (a
   * resubmit just updates answers), but the framing changes slightly. */
  alreadyRegistered: boolean;
  initialProfile: ProfileData;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData>(initialProfile);
  const [is18Plus, setIs18Plus] = useState(false);
  const [waiverSign, setWaiverSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  const [waiverInfo, setWaiverInfo] = useState<WaiverInfo | null>(null);
  const [waiverLoading, setWaiverLoading] = useState(false);

  const [certFile, setCertFile] = useState<File | null>(null);
  const [certIssuedOn, setCertIssuedOn] = useState("");
  const [certExpiresOn, setCertExpiresOn] = useState("");
  const [certUploading, setCertUploading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-resolve the waiver whenever the home chapter changes — it depends on
  // the chapter's state, chosen live on this form (there's no event to
  // derive it from, unlike the RSVP form).
  useEffect(() => {
    if (!profile.chapter) {
      setWaiverInfo(null);
      return;
    }
    let cancelled = false;
    setWaiverLoading(true);
    loadVolunteerWaiverInfoAction(profile.chapter).then((result) => {
      if (cancelled) return;
      setWaiverLoading(false);
      if (result.ok) setWaiverInfo(result.info);
    });
    return () => {
      cancelled = true;
    };
  }, [profile.chapter]);

  const updateField = <K extends keyof ProfileData>(field: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setProfile((prev) => ({ ...prev, [field]: e.target.value }));

  const toggleSkill = (skill: string, checked: boolean) =>
    setProfile((prev) => ({
      ...prev,
      skill_interests: checked
        ? [...prev.skill_interests, skill]
        : prev.skill_interests.filter((s) => s !== skill),
    }));

  const toggleProgram = (program: string, checked: boolean) =>
    setProfile((prev) => ({
      ...prev,
      program_interests: checked
        ? [...prev.program_interests, program]
        : prev.program_interests.filter((p) => p !== program),
    }));

  const wantsRetreats = profile.program_interests.includes("Retreats");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCertError(null);

    if (waiverNeedsInput(waiverInfo, waiverSign)) {
      setError("You must agree to and sign the volunteer waiver.");
      return;
    }

    setIsSubmitting(true);

    let certification: SubmitVolunteerRegistrationInput["certification"];
    if (wantsRetreats && certFile) {
      setCertUploading(true);
      try {
        const supabase = createClient();
        const ext = certFile.name.split(".").pop() || "dat";
        const path = `${userId}/first_aid_cpr_aed_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("volunteer-certifications")
          .upload(path, certFile);
        if (uploadError) throw uploadError;
        certification = { filePath: path, issuedOn: certIssuedOn, expiresOn: certExpiresOn };
      } catch (err) {
        setCertUploading(false);
        setIsSubmitting(false);
        setCertError(err instanceof Error ? err.message : "Certification upload failed");
        return;
      }
      setCertUploading(false);
    }

    const result = await submitVolunteerRegistrationAction({
      firstName: profile.first_name,
      lastName: profile.last_name,
      cellPhone: profile.phone,
      email: profile.email,
      addressLine1: profile.address_line1,
      addressLine2: profile.address_line2,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postal_code,
      emergencyContactName: profile.emergency_contact,
      emergencyContactPhone: profile.emergency_phone,
      homeChapter: profile.chapter,
      tshirtSize: profile.tshirt_size,
      favoriteSnack: profile.favorite_snack,
      favoriteNaBeverage: profile.favorite_na_beverage,
      is18Plus,
      skillInterests: profile.skill_interests,
      skillInterestsOther: profile.skill_interests_other,
      programInterests: profile.program_interests,
      waiverAgreed: waiverSign.agreed || waiverInfo?.status === "signed",
      waiverSignedName: waiverSign.name,
      certification,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Don't leave the person on the form — send them to the volunteer home
    // page, which shows the success message (it reads ?saved=1) along with
    // their status, roles, and what's still outstanding.
    router.push("/protected/volunteer?saved=1");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your info</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="v_first_name">First name</Label>
              <Input id="v_first_name" required value={profile.first_name} onChange={updateField("first_name")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_last_name">Last name</Label>
              <Input id="v_last_name" required value={profile.last_name} onChange={updateField("last_name")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v_phone">Cell phone</Label>
            <Input
              id="v_phone"
              type="tel"
              inputMode="numeric"
              required
              placeholder="(303) 555-0100"
              maxLength={14}
              value={profile.phone}
              onChange={(e) => setProfile((prev) => ({ ...prev, phone: formatPhoneNumber(e.target.value) }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v_email">Email</Label>
            <Input id="v_email" type="email" required value={profile.email} onChange={updateField("email")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v_address1">Address</Label>
            <Input id="v_address1" required value={profile.address_line1} onChange={updateField("address_line1")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v_address2">Address line 2</Label>
            <Input
              id="v_address2"
              placeholder="Apt, suite, etc. (optional)"
              value={profile.address_line2}
              onChange={updateField("address_line2")}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="v_city">City</Label>
              <Input id="v_city" required value={profile.city} onChange={updateField("city")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_state">State</Label>
              <Select
                id="v_state"
                required
                value={profile.state}
                onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))}
              >
                <option value="">State</option>
                {US_STATES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_zip">ZIP code</Label>
              <Input
                id="v_zip"
                inputMode="numeric"
                required
                maxLength={10}
                value={profile.postal_code}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, postal_code: formatPostalCode(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="v_ec_name">Emergency contact name</Label>
              <Input id="v_ec_name" required value={profile.emergency_contact} onChange={updateField("emergency_contact")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_ec_phone">Emergency contact phone</Label>
              <Input
                id="v_ec_phone"
                type="tel"
                inputMode="numeric"
                required
                maxLength={14}
                value={profile.emergency_phone}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, emergency_phone: formatPhoneNumber(e.target.value) }))
                }
              />
            </div>
          </div>
          <HomeChapterField
            idPrefix="v"
            value={profile.chapter}
            onChange={(value) => setProfile((prev) => ({ ...prev, chapter: value }))}
          />
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="v_tshirt">T-shirt size</Label>
              <Select
                id="v_tshirt"
                required
                value={profile.tshirt_size}
                onChange={(e) => setProfile((prev) => ({ ...prev, tshirt_size: e.target.value }))}
              >
                <option value="">Select…</option>
                {TSHIRT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_snack">Favorite snack</Label>
              <Input id="v_snack" required value={profile.favorite_snack} onChange={updateField("favorite_snack")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v_beverage">Favorite N/A beverage</Label>
              <Input
                id="v_beverage"
                required
                value={profile.favorite_na_beverage}
                onChange={updateField("favorite_na_beverage")}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={is18Plus}
              onChange={(e) => setIs18Plus(e.target.checked)}
            />
            I am 18 years of age or older.
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills &amp; interest areas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {SKILL_INTERESTS.map((skill) => (
            <label key={skill} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={profile.skill_interests.includes(skill)}
                onChange={(e) => toggleSkill(skill, e.target.checked)}
              />
              {skill}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.skill_interests.includes("Other")}
              onChange={(e) => toggleSkill("Other", e.target.checked)}
            />
            Other
          </label>
          {profile.skill_interests.includes("Other") && (
            <Input
              placeholder="Describe your other skill or interest"
              required
              value={profile.skill_interests_other}
              onChange={updateField("skill_interests_other")}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Programs you&apos;re interested in supporting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {PROGRAM_INTERESTS.map((program) => (
            <label key={program} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={profile.program_interests.includes(program)}
                onChange={(e) => toggleProgram(program, e.target.checked)}
              />
              {program}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Volunteer liability waiver</CardTitle>
        </CardHeader>
        <CardContent>
          {waiverLoading && <p className="text-sm text-muted-foreground">Loading waiver...</p>}
          {!waiverLoading && !profile.chapter && (
            <p className="text-sm text-muted-foreground">Choose your home chapter above to load the waiver.</p>
          )}
          {!waiverLoading && waiverInfo && (
            <WaiverSigning info={waiverInfo} value={waiverSign} onChange={setWaiverSign} idPrefix="volunteer" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Health history</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-600">
            A full health history is required for all volunteers and is coming soon. You&apos;ll be
            contacted separately to complete it — nothing to do here yet.
          </p>
        </CardContent>
      </Card>

      {wantsRetreats && (
        <Card>
          <CardHeader>
            <CardTitle>First Aid/CPR/AED certification (optional)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Since you&apos;re interested in Retreats, you can upload a current certification now, or
              add it later.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="v_cert_file">Certification file</Label>
              <Input
                id="v_cert_file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="v_cert_issued">Issue date</Label>
                <Input
                  id="v_cert_issued"
                  type="date"
                  value={certIssuedOn}
                  onChange={(e) => setCertIssuedOn(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="v_cert_expires">Expiry date</Label>
                <Input
                  id="v_cert_expires"
                  type="date"
                  value={certExpiresOn}
                  onChange={(e) => setCertExpiresOn(e.target.value)}
                />
              </div>
            </div>
            {certError && <p className="text-sm text-red-500">{certError}</p>}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <Button type="submit" disabled={isSubmitting || certUploading}>
            {isSubmitting || certUploading
              ? "Submitting..."
              : alreadyRegistered
                ? "Save changes"
                : "Submit registration"}
          </Button>
        </div>
      </div>
    </form>
  );
}
