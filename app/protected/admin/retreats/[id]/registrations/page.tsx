import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateInZone, formatEventDateRange, formatEventInstant, todayInZone } from "@/lib/format-date";
import { getSiteUrl } from "@/lib/site-url";
import { formatPrice } from "@/lib/retreats";
import {
  formatDueDate,
  PRECHECK_LABELS,
  REGISTRATION_COLUMNS,
  ROOM_STATUS_LABELS,
  STATUS_LABELS,
  totalCents,
  type PrecheckState,
  type RegistrationRow,
  type RegistrationStatus,
} from "@/lib/retreat-registration";
import { CustomPriceLinks, RegistrationActions, type CustomPriceLink } from "@/components/admin/retreat-registrations";
import { RetreatAdminNav } from "@/components/admin/retreat-admin-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const money = (cents: number) => (cents === 0 ? "$0" : formatPrice(cents));

type Person = { name: string; email: string };
type Health = { has_form: boolean; precheck: PrecheckState };
type CustomPriceRow = {
  id: number;
  token: string;
  amount_cents: number;
  note: string;
  created_at: string;
  revoked_at: string | null;
  used_by_registration_id: number | null;
};

const SECTIONS: { status: RegistrationStatus[]; title: string; description: string; order: keyof RegistrationRow }[] = [
  { status: ["confirmed"], title: "Confirmed", description: "Their first payment went through, or their price is $0.", order: "confirmed_at" },
  {
    status: ["pending_payment"],
    title: "Pending payment",
    description: "Registered, not paid yet. Spots go to whoever pays first.",
    order: "registered_at",
  },
  { status: ["offered"], title: "Offered a spot", description: "Off the waitlist, with a deadline to accept.", order: "offered_at" },
  {
    status: ["waitlisted"],
    title: "Waitlist",
    description: "In the order they joined. Nobody is moved up automatically: offer a spot when one opens.",
    order: "joined_waitlist_at",
  },
  { status: ["expired", "cancelled"], title: "Expired and cancelled", description: "", order: "cancelled_at" },
];

/** Who has registered, where each one stands, and the actions on them. For
 * admins and the retreat's lead. */
async function RegistrationsLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) notFound();

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_event", { p_event_id: eventId });
  if (!allowed) notFound();

  const [{ data: retreat }, { data: regs }, { data: health }, { data: dates }, { data: prices }, { data: spotsLeft }] =
    await Promise.all([
      supabase
        .from("events")
        .select("id, name, starts_at, ends_at, timezone, capacity, status")
        .eq("id", eventId)
        .eq("kind", "retreat")
        .maybeSingle(),
      supabase.from("retreat_registrations").select(REGISTRATION_COLUMNS).eq("event_id", eventId),
      supabase.rpc("retreat_registration_health", { p_event_id: eventId }),
      supabase.rpc("retreat_precheck_dates", { p_event_id: eventId }),
      supabase
        .from("retreat_custom_prices")
        .select("id, token, amount_cents, note, created_at, revoked_at, used_by_registration_id")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
      supabase.rpc("retreat_spots_left", { p_event_id: eventId }),
    ]);
  if (!retreat) notFound();
  const timezone = retreat.timezone as string;
  const rows = (regs ?? []) as unknown as RegistrationRow[];

  // Names by id with the service role: the page is gated above, and a
  // retreat lead can't otherwise read the profile of someone who isn't on
  // one of their events yet.
  const ids = [...new Set(rows.map((r) => r.user_id).filter((u): u is string => Boolean(u)))];
  const people = new Map<string, Person>();
  if (ids.length > 0) {
    const { data: profiles } = await createAdminClient()
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("id", ids);
    for (const p of profiles ?? []) {
      const email = (p.email as string | null) ?? "";
      people.set(p.id as string, {
        name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || email || "Unnamed",
        email,
      });
    }
  }
  const healthBy = new Map(
    ((health ?? []) as ({ user_id: string } & Health)[]).map((h) => [h.user_id, { has_form: h.has_form, precheck: h.precheck }]),
  );
  const check = ((dates ?? []) as { opens_on: string; due_on: string }[])[0] ?? null;
  const today = todayInZone(timezone);
  const phase = !check ? "not_open" : today < check.opens_on ? "not_open" : today > check.due_on ? "overdue" : "open";

  const count = (s: RegistrationStatus) => rows.filter((r) => r.status === s).length;
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const donations = rows
    .filter((r) => r.status === "confirmed" || r.status === "pending_payment")
    .reduce((sum, r) => sum + r.donation_cents, 0);
  const overdue = phase === "overdue" ? confirmed.filter((r) => healthBy.get(r.user_id ?? "")?.precheck !== "done").length : 0;

  const regById = new Map(rows.map((r) => [r.id, r]));
  const links: CustomPriceLink[] = ((prices ?? []) as CustomPriceRow[]).map((p) => {
    const used = p.used_by_registration_id ? regById.get(p.used_by_registration_id) : null;
    return {
      id: p.id,
      url: `${getSiteUrl()}/protected/retreats/${eventId}/register?price=${p.token}`,
      amountLabel: money(p.amount_cents),
      note: p.note,
      createdLabel: formatDateInZone(p.created_at, timezone),
      usedBy: p.used_by_registration_id ? (used?.user_id ? people.get(used.user_id)?.name ?? "someone" : "someone") : null,
      revoked: Boolean(p.revoked_at),
    };
  });

  const healthCell = (r: RegistrationRow) => {
    const h = r.user_id ? healthBy.get(r.user_id) : undefined;
    if (!h) return <span className="text-muted-foreground">—</span>;
    if (r.status !== "confirmed" || phase === "not_open") {
      return h.has_form ? <span>On file</span> : <span className="text-amber-700 dark:text-amber-400">Missing</span>;
    }
    if (h.precheck === "done") return <span className="text-green-700 dark:text-green-400">Check done</span>;
    return (
      <span className={cn(phase === "overdue" ? "font-medium text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
        {phase === "overdue" ? "Overdue: " : ""}
        {PRECHECK_LABELS[h.precheck]}
      </span>
    );
  };

  const whenLine = (r: RegistrationRow) => {
    const at = (iso: string | null) => (iso ? formatEventInstant(iso, timezone) : "");
    switch (r.status) {
      case "confirmed":
        return `Confirmed ${at(r.confirmed_at)}`;
      case "pending_payment":
        return `Registered ${at(r.registered_at)}${
          // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request.
          r.hold_expires_at && new Date(r.hold_expires_at).getTime() > Date.now() ? ` · checking out now` : ""
        }`;
      case "offered":
        return `Offered ${at(r.offered_at)} · until ${at(r.offer_expires_at)}`;
      case "waitlisted":
        return `Joined ${at(r.joined_waitlist_at ?? r.registered_at)}`;
      case "expired":
        return `Offer ran out ${at(r.offer_expires_at)}`;
      case "cancelled":
        return `Cancelled ${at(r.cancelled_at)}${r.cancel_note ? ` · ${r.cancel_note}` : ""}`;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{retreat.name as string}: registrations</h1>
          {retreat.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatEventDateRange(retreat.starts_at as string, retreat.ends_at as string | null, timezone)}
        </p>
        <RetreatAdminNav eventId={eventId} current="registrations" />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-6 text-sm sm:grid-cols-4">
          <Stat label="Confirmed" value={`${count("confirmed")}${retreat.capacity != null ? ` of ${retreat.capacity}` : ""}`} />
          <Stat label="Pending payment" value={String(count("pending_payment"))} />
          <Stat label="Offered / waitlist" value={`${count("offered")} / ${count("waitlisted")}`} />
          <Stat label="Spots open" value={typeof spotsLeft === "number" ? String(spotsLeft) : "No limit"} />
          <Stat label="Extra donations pledged" value={money(donations)} />
          <Stat
            label="Pre-retreat check"
            value={check ? `Opens ${formatDueDate(check.opens_on)} · due ${formatDueDate(check.due_on)}` : "—"}
            wide
          />
          {overdue > 0 && (
            <p className="col-span-2 font-medium text-red-700 sm:col-span-4 dark:text-red-400">
              {overdue} confirmed {overdue === 1 ? "person hasn't" : "people haven't"} done the pre-retreat check, and it&apos;s
              past due. They&apos;re emailed, but nothing cancels automatically: follow up with them.
            </p>
          )}
          <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">
            Paid and balance fill in once online payment is switched on.
          </p>
        </CardContent>
      </Card>

      {SECTIONS.map((section) => {
        const list = rows
          .filter((r) => section.status.includes(r.status))
          .sort((a, b) => {
            const av = String(a[section.order] ?? a.registered_at);
            const bv = String(b[section.order] ?? b.registered_at);
            // Ended ones newest first; everything else first come, first served.
            return section.order === "cancelled_at" ? bv.localeCompare(av) : av.localeCompare(bv);
          });
        if (list.length === 0 && section.status[0] !== "confirmed") return null;
        return (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>
                {section.title} ({list.length})
              </CardTitle>
              {section.description && <CardDescription>{section.description}</CardDescription>}
            </CardHeader>
            <CardContent>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        {section.status[0] === "waitlisted" && <th className="py-2 pr-3 font-medium">#</th>}
                        <th className="py-2 pr-3 font-medium">Person</th>
                        <th className="py-2 pr-3 font-medium">Price</th>
                        <th className="py-2 pr-3 font-medium">Donation</th>
                        <th className="py-2 pr-3 font-medium">Paid</th>
                        <th className="py-2 pr-3 font-medium">Balance</th>
                        <th className="py-2 pr-3 font-medium">Own room</th>
                        <th className="py-2 pr-3 font-medium">Health form</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r, i) => {
                        const person = r.user_id ? people.get(r.user_id) : undefined;
                        const total = totalCents(r);
                        const settled = r.status === "confirmed" && total === 0;
                        return (
                          <tr key={r.id} className="border-b align-top last:border-0">
                            {section.status[0] === "waitlisted" && <td className="py-2 pr-3">{i + 1}</td>}
                            <td className="py-2 pr-3">
                              <div className="font-medium">{person?.name ?? "Account removed"}</div>
                              {person?.email && <div className="text-xs text-muted-foreground">{person.email}</div>}
                              <div className="text-xs text-muted-foreground">
                                {section.status.length > 1 && `${STATUS_LABELS[r.status]} · `}
                                {whenLine(r)}
                              </div>
                            </td>
                            <td className="py-2 pr-3">
                              {r.price_label}
                              {r.custom_price_id != null && (
                                <Badge variant="outline" className="ml-1">
                                  Private link
                                </Badge>
                              )}
                              <div className="text-xs text-muted-foreground">{money(r.price_cents)}</div>
                            </td>
                            <td className="py-2 pr-3">{r.donation_cents > 0 ? money(r.donation_cents) : "—"}</td>
                            <td className="py-2 pr-3">{settled ? "$0" : "—"}</td>
                            <td className="py-2 pr-3">{settled ? "$0" : money(total)}</td>
                            <td className="py-2 pr-3">
                              {r.room_request ? ROOM_STATUS_LABELS[r.room_request_status ?? "pending"] : "—"}
                            </td>
                            <td className="py-2 pr-3">{healthCell(r)}</td>
                            <td className="py-2">
                              <RegistrationActions registrationId={r.id} status={r.status} name={person?.name ?? "this person"} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Private price links</CardTitle>
          <CardDescription>
            A different price for one person, $0 included. They register through the link and get that price instead
            of the usual options; at $0 they&apos;re confirmed straight away, with no checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomPriceLinks eventId={eventId} links={links} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col", wide && "col-span-2 sm:col-span-3")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function RetreatRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RegistrationsLoader params={params} />
      </Suspense>
    </div>
  );
}
