"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { addOwnCertificationAction } from "@/lib/actions/certifications";
import { createClient } from "@/lib/supabase/client";
import { CERT_ACCEPT, CERT_MAX_BYTES } from "@/lib/certifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Upload a certification" on the Volunteer page: a First Aid/CPR/AED
 * certificate, its issue and expiry dates, without going back through the
 * registration form. The file goes straight from the browser into the
 * volunteer's own folder of the private bucket, then
 * addOwnCertificationAction records it.
 */
export function OwnCertificationUpload({ userId, label }: { userId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {saved && <p className="text-sm text-green-700">Certification added, thank you.</p>}
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setOpen(true);
            setSaved(false);
          }}
        >
          {label}
        </Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose the certificate file (a photo or PDF).");
    if (file.size > CERT_MAX_BYTES) return setError("That file is over 10 MB. Try a smaller photo or a PDF.");
    if (!expiresOn) return setError("Give the expiry date on the certificate.");
    setSaving(true);
    const ext = file.name.split(".").pop() || "dat";
    const path = `${userId}/first_aid_cpr_aed_${Date.now()}.${ext}`;
    const { error: uploadError } = await createClient().storage.from("volunteer-certifications").upload(path, file);
    if (uploadError) {
      setSaving(false);
      return setError(`The upload didn't go through: ${uploadError.message}`);
    }
    const result = await addOwnCertificationAction({ filePath: path, issuedOn, expiresOn });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
    setSaved(true);
    setFile(null);
    setIssuedOn("");
    setExpiresOn("");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">First Aid/CPR/AED certification</p>
      <div className="grid gap-2">
        <Label htmlFor="own_cert_file">Certificate (photo or PDF, up to 10 MB)</Label>
        <Input id="own_cert_file" type="file" accept={CERT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="own_cert_issued">Issue date (optional)</Label>
          <Input id="own_cert_issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="own_cert_expires">Expiry date</Label>
          <Input
            id="own_cert_expires"
            type="date"
            required
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Uploading..." : "Add certification"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
