import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadTherapist } from "@/lib/therapy-access";
import { formatDateInZone, todayInZone } from "@/lib/format-date";
import { formatCents, formatPlainDate, PAYMENT_METHOD_LABELS } from "@/lib/therapy-support";
import {
  TherapistPaymentForm,
  TherapistRecordForm,
  VoidPaymentButton,
  W9Checkbox,
} from "@/components/admin/therapy-therapist-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ZONE = "America/Denver";

/** One therapist: record, W-9, what's owed (participants named, to match
 * the invoice), payments and yearly totals. Loading it is logged ("list"). */
async function TherapistLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  const result = await loadTherapist(supabase, id);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load this therapist: {result.error}</p>;
  const t = result.data;
  if (!t) notFound();

  const today = todayInZone(ZONE);
  const thisYear = Number(today.slice(0, 4));
  const paidThisYear = t.years.find((y) => y.year === thisYear)?.paid_cents ?? 0;
  const needsW9 = !t.w9_received && t.years.some((y) => y.paid_cents >= t.w9_threshold_cents);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/protected/admin/therapy/therapists" className="text-sm text-muted-foreground hover:underline">
          ← All therapists
        </Link>
        <h1 className="text-2xl font-bold">{t.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t.participants} participant{t.participants === 1 ? "" : "s"} approved with them
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            {(
              [
                ["Practice", t.practice],
                ["Email", t.email],
                ["Phone", t.phone],
                ["License", [t.license_type, t.license_state].filter(Boolean).join(", ")],
              ] as [string, string | null][]
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="[overflow-wrap:anywhere]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <W9Checkbox therapistId={t.id} received={t.w9_received} />
          {t.w9_received && t.w9_received_at && (
            <p className="text-xs text-muted-foreground">Ticked {formatDateInZone(t.w9_received_at, ZONE)}</p>
          )}
          {needsW9 && (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
              Paid {formatCents(t.w9_threshold_cents)} or more in a year with no W-9 on file. Ask them for one.
            </p>
          )}
          <TherapistRecordForm
            id={t.id}
            buttonLabel="Edit details"
            initial={{
              name: t.name,
              practice: t.practice ?? "",
              email: t.email ?? "",
              phone: t.phone ?? "",
              licenseType: t.license_type ?? "",
              licenseState: t.license_state ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owed</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Keyed on what's unpaid, so the ticks start fresh after a payment. */}
          <TherapistPaymentForm
            key={t.unpaid.map((s) => s.id).join(",")}
            therapistId={t.id}
            unpaid={t.unpaid}
            today={today}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            <span className="font-medium">Paid in {thisYear}:</span> {formatCents(paidThisYear)}
            {t.years
              .filter((y) => y.year !== thisYear)
              .map((y) => (
                <span key={y.year} className="text-muted-foreground">
                  {" "}
                  · {y.year}: {formatCents(y.paid_cents)}
                </span>
              ))}
          </p>
          {t.payments.length === 0 ? (
            <p className="text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {t.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {formatPlainDate(p.paid_on)} · {formatCents(p.amount_cents)} · {p.sessions} session
                    {p.sessions === 1 ? "" : "s"}
                    <span className="text-muted-foreground">
                      {" "}
                      · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference && ` ${p.reference}`}
                    </span>
                  </span>
                  <VoidPaymentButton paymentId={p.id} label={`${formatPlainDate(p.paid_on)} ${formatCents(p.amount_cents)}`} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TherapistPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <TherapistLoader params={params} />
      </Suspense>
    </div>
  );
}
