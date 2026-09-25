import {
  abilityLabel,
  conditionLabel,
  CONSENT_EMERGENCY_TREATMENT,
  CONSENT_SHARE_WITH_EMS,
  swimmingLabel,
  type HealthHistoryRecord,
} from "@/lib/health-history";
import { cn } from "@/lib/utils";

/**
 * One health form, read-only. Only ever rendered with a record returned by
 * lib/health-access.ts — which checked access and logged the read — so
 * nothing here fetches or decides who may see it.
 *
 * "print" is the roster-wide print: large type, the things someone needs in
 * an emergency first (who to call, blood thinners, EpiPen, allergies,
 * medications), then the rest.
 */
export function HealthHistoryView({
  record,
  personName,
  variant = "screen",
}: {
  record: HealthHistoryRecord;
  /** Shown as the heading on staff and print views. */
  personName?: string;
  variant?: "screen" | "print";
}) {
  const print = variant === "print";
  const yesNo = (v: boolean | null) => (v == null ? "—" : v ? "Yes" : "No");
  // Same deliberate Colorado default as the waivers (lib/waivers.ts).
  const signed = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(record.signed_at));
  const dob = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${record.date_of_birth}T00:00:00Z`));

  const mobilityConcerns = [
    record.walk_uneven_ground !== "yes" && `Walking 30 min on rough ground: ${abilityLabel(record.walk_uneven_ground)}`,
    record.stand_in_moving_water !== "yes" && `Standing in moving water: ${abilityLabel(record.stand_in_moving_water)}`,
    record.recover_footing !== "yes" && `Getting back up after a fall in the river: ${abilityLabel(record.recover_footing)}`,
    record.swimming === "cannot_swim" && "Cannot swim",
  ].filter((line): line is string => Boolean(line));

  return (
    <article className={cn("flex flex-col", print ? "gap-4 text-base" : "gap-5 text-sm")}>
      {personName && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
          <h2 className={cn("font-bold", print ? "text-3xl" : "text-xl")}>{personName}</h2>
          <span className={cn(print ? "text-base" : "text-sm text-muted-foreground")}>
            DOB {dob} · {record.year} form, signed {signed}
          </span>
        </header>
      )}

      <Section title="Emergency contacts" print={print}>
        <Row label={`1. ${record.emergency_contact_name}`} value={`${record.emergency_contact_phone} · ${record.emergency_contact_relationship}`} print={print} />
        <Row label={`2. ${record.emergency_contact_2_name}`} value={`${record.emergency_contact_2_phone} · ${record.emergency_contact_2_relationship}`} print={print} />
      </Section>

      <Section title="Critical" print={print} emphasis>
        <Row label="Blood thinners" value={yesNo(record.on_blood_thinners)} print={print} strong={record.on_blood_thinners} />
        <Row
          label="EpiPen / rescue inhaler"
          value={
            record.carries_epipen_or_inhaler
              ? `Carries one — ${record.will_bring_epipen_or_inhaler ? "will have it at the event" : "will NOT have it at the event"}`
              : "No"
          }
          print={print}
          strong={record.carries_epipen_or_inhaler}
        />
        <Row label="Medical allergies" value={record.medical_allergies} print={print} />
        <Row label="Medications" value={record.medications} print={print} />
        {record.medication_storage_needed && (
          <Row label="Needs refrigeration / secure storage" value={record.medication_storage_details ?? "Yes"} print={print} />
        )}
      </Section>

      <Section title="Conditions" print={print}>
        {record.no_conditions ? (
          <p>None of the listed conditions</p>
        ) : (
          <ul className="list-disc pl-5">
            {record.conditions.map((key) => (
              <li key={key}>{conditionLabel(key)}</li>
            ))}
            {record.conditions_other && <li>Other: {record.conditions_other}</li>}
          </ul>
        )}
        {record.cardiac_physician_cleared != null && (
          <Row label="Cleared for moderate activity" value={yesNo(record.cardiac_physician_cleared)} print={print} />
        )}
        {record.cardiac_details && <Row label="Heart / circulation" value={record.cardiac_details} print={print} />}
        {record.seizure_most_recent && <Row label="Most recent seizure" value={record.seizure_most_recent} print={print} />}
        {record.diabetes_uses_insulin != null && <Row label="Uses insulin" value={yesNo(record.diabetes_uses_insulin)} print={print} />}
        {record.diabetes_low_plan && <Row label="Handling a low" value={record.diabetes_low_plan} print={print} />}
        {record.surgery_details && <Row label="Recent surgery / injury" value={record.surgery_details} print={print} />}
        {record.surgery_physician_cleared != null && (
          <Row label="Cleared after surgery / injury" value={yesNo(record.surgery_physician_cleared)} print={print} />
        )}
        {record.sleep_apnea_travels_with_cpap != null && (
          <Row label="Travels with CPAP" value={yesNo(record.sleep_apnea_travels_with_cpap)} print={print} />
        )}
        {record.conditions_explanation && <Row label="Explanation" value={record.conditions_explanation} print={print} />}
      </Section>

      <Section title="On the water" print={print}>
        {mobilityConcerns.length > 0 && (
          <ul className="list-disc pl-5 font-semibold">
            {mobilityConcerns.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <Row label="Walk 30 min over rough ground with gear" value={abilityLabel(record.walk_uneven_ground)} print={print} />
        <Row label="Stand in knee-to-thigh moving water" value={abilityLabel(record.stand_in_moving_water)} print={print} />
        <Row label="Get back up after losing footing" value={abilityLabel(record.recover_footing)} print={print} />
        <Row
          label="Mobility aid or fall in past year"
          value={record.mobility_aid_or_fall ? `Yes — ${record.mobility_aid_details ?? ""}` : "No"}
          print={print}
        />
        <Row label="Swimming" value={swimmingLabel(record.swimming)} print={print} />
      </Section>

      {record.anything_else && (
        <Section title="Anything else" print={print}>
          <p className="whitespace-pre-line">{record.anything_else}</p>
        </Section>
      )}

      <Section title="Insurance" print={print}>
        <Row label="Carrier" value={record.insurance_carrier} print={print} />
        <Row label="Policy number" value={record.insurance_policy_number} print={print} />
      </Section>

      <Section title="Consent" print={print}>
        <p>✓ {CONSENT_EMERGENCY_TREATMENT}</p>
        <p>✓ {CONSENT_SHARE_WITH_EMS}</p>
        <p>
          Signed &ldquo;{record.signed_name}&rdquo; on {signed}.
        </p>
      </Section>
    </article>
  );
}

function Section({
  title,
  print,
  emphasis = false,
  children,
}: {
  title: string;
  print: boolean;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-1.5 break-inside-avoid",
        emphasis && "rounded-md border-2 border-foreground p-3",
      )}
    >
      <h3 className={cn("font-semibold uppercase tracking-wide", print ? "text-lg" : "text-xs text-muted-foreground")}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  print,
  strong = false,
}: {
  label: string;
  value: string;
  print: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn("grid gap-x-3", print ? "grid-cols-[14rem_1fr]" : "sm:grid-cols-[14rem_1fr]")}>
      <span className="font-medium">{label}</span>
      <span className={cn("whitespace-pre-line", strong && "font-bold")}>{value}</span>
    </div>
  );
}
