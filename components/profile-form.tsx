"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RegistrationFieldInput } from "@/components/registration-fields";
import { CHAPTERS, NOT_LOCAL_CHAPTER } from "@/lib/chapters";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import {
  isSectionAnswered,
  REGISTRATION_SECTIONS,
  type RegistrationSection,
} from "@/lib/registration-sections";
import { US_STATES } from "@/lib/us-states";
import { cn } from "@/lib/utils";

type ProfileData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  chapter: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
};

// Where the "Medical information" card links to. Deliberately not built yet —
// medical data is handled on its own page, separate from the rest of the
// profile. The card is just a signpost for now.
const MEDICAL_INFO_HREF = "/protected/profile/medical";

export function ProfileForm({
  userId,
  initialProfile,
  initialRegistrationFields,
  returnTo,
}: {
  userId: string;
  initialProfile: ProfileData;
  /** Every registration section field's current value, keyed by its profile
   * column (see lib/registration-sections.ts). Rendered generically below so
   * a future section needs no changes here. */
  initialRegistrationFields: Record<string, string>;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData>(initialProfile);
  const [registrationFields, setRegistrationFields] = useState<
    Record<string, string>
  >(initialRegistrationFields);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Next.js (Cache Components) preserves this page's React state via
  // Activity instead of unmounting it on navigation, so revisiting this page
  // (e.g. clicking "Edit on profile" again) can show the *previous* visit's
  // leftover "Profile saved" state before this visit has done anything. Only
  // reset it — never mid-edit — after a save actually completes and the user
  // navigates away, so an in-progress draft is never wiped.
  const shouldResetOnHideRef = useRef(false);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useLayoutEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
      if (shouldResetOnHideRef.current) {
        shouldResetOnHideRef.current = false;
        setSuccess(false);
      }
    };
  }, []);

  // Always-open at the top; every other section is a collapsible card. Only
  // sections the member has actually answered get a card — an untouched
  // optional section stays hidden until an RSVP collects it. Frozen to the
  // values as loaded so editing a field can't make its own card disappear
  // mid-edit.
  const alwaysOpenSections = REGISTRATION_SECTIONS.filter(
    (section) => section.alwaysRequired,
  );
  const [collapsibleSections] = useState(() =>
    REGISTRATION_SECTIONS.filter(
      (section) =>
        !section.alwaysRequired &&
        isSectionAnswered(section, initialRegistrationFields),
    ),
  );

  // Which collapsible cards are expanded. Seeded from the URL hash in an
  // effect (not initial state) so SSR and hydration agree — see the
  // hydration note on formatEventDateRange for the same reasoning.
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (!id) return;
      setOpenSectionIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // Scroll once the card has rendered in its open state — Next's own
      // hash-scroll fires before React re-renders it taller.
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ block: "start" }),
      );
    };
    openFromHash();
    // Covers landing on a #hash link while already on this page.
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  const toggleSection = (id: string) =>
    setOpenSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateField = (field: keyof ProfileData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setProfile((prev) => ({ ...prev, [field]: e.target.value }));
      setSuccess(false);
    };

  const updatePhoneField = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile((prev) => ({
      ...prev,
      phone: formatPhoneNumber(e.target.value),
    }));
    setSuccess(false);
  };

  const updateRegistrationField = (key: string, value: string) => {
    setRegistrationFields((prev) => ({ ...prev, [key]: value }));
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
        .update({ ...profile, ...registrationFields })
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
      shouldResetOnHideRef.current = true;
      if (returnTo) {
        // Give the "Profile saved" message a beat on screen before leaving,
        // so the save doesn't look like it silently no-op'd.
        redirectTimeoutRef.current = setTimeout(
          () => router.push(returnTo),
          900,
        );
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
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
              onChange={updatePhoneField}
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
        </CardContent>
      </Card>

      {alwaysOpenSections.map((section) => (
        <Card key={section.id} id={section.id}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionFields
              section={section}
              values={registrationFields}
              onChange={updateRegistrationField}
            />
          </CardContent>
        </Card>
      ))}

      {collapsibleSections.map((section) => (
        <CollapsibleSectionCard
          key={section.id}
          section={section}
          open={openSectionIds.has(section.id)}
          summary={section.summary(registrationFields)}
          onToggle={() => toggleSection(section.id)}
        >
          <SectionFields
            section={section}
            values={registrationFields}
            onChange={updateRegistrationField}
          />
        </CollapsibleSectionCard>
      ))}

      <Card id="medical">
        <CardHeader>
          <CardTitle>Medical information</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Allergies, conditions, and medications are kept on a separate,
            more private page.
          </p>
          <Link
            href={MEDICAL_INFO_HREF}
            className="text-sm underline underline-offset-4"
          >
            Manage medical information
          </Link>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">
            Profile saved.
            {returnTo ? " Returning to your RSVP..." : ""}
          </p>
        )}
        <div>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Saving..."
              : returnTo
                ? "Save & return to RSVP"
                : "Save profile"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A section's inputs, laid out generically from the catalog — shared by the
 * always-open cards and the collapsible ones. */
function SectionFields({
  section,
  values,
  onChange,
}: {
  section: RegistrationSection;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div
      className={
        section.fields.length > 1 ? "grid grid-cols-2 gap-4" : "grid gap-2"
      }
    >
      {section.fields.map((field) => (
        <RegistrationFieldInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

/** A registration section as a collapsible card: title + one-line summary when
 * closed, the edit form when open. The card carries `id={section.id}` so a
 * `/protected/profile#<id>` deep link scrolls to (and, via the effect above,
 * opens) it. */
function CollapsibleSectionCard({
  section,
  open,
  summary,
  onToggle,
  children,
}: {
  section: RegistrationSection;
  open: boolean;
  summary: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card id={section.id}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 p-6 text-left"
      >
        <span className="flex flex-col gap-1">
          <span className="font-semibold leading-none tracking-tight">
            {section.title}
          </span>
          {!open && (
            <span className="text-sm text-muted-foreground">
              {summary || "Not answered yet"}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
