import Link from "next/link";

import { Button } from "@/components/ui/button";

const PAGES = [
  { key: "setup", label: "Setup", path: "" },
  { key: "registrations", label: "Registrations", path: "/registrations" },
  { key: "rooms", label: "Room requests", path: "/rooms" },
] as const;
const ROSTER_LABEL = "Roster and check-in";

/** Links between a retreat's admin pages, plus the ordinary roster. */
export function RetreatAdminNav({
  eventId,
  current,
  extra,
}: {
  eventId: number;
  current: (typeof PAGES)[number]["key"] | "roster";
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PAGES.map((p) => (
        <Button key={p.key} asChild size="sm" variant={p.key === current ? "default" : "outline"}>
          <Link href={`/protected/admin/retreats/${eventId}${p.path}`} aria-current={p.key === current ? "page" : undefined}>
            {p.label}
          </Link>
        </Button>
      ))}
      <Button asChild size="sm" variant={current === "roster" ? "default" : "outline"}>
        <Link href={`/protected/admin/events/${eventId}`} aria-current={current === "roster" ? "page" : undefined}>
          {ROSTER_LABEL}
        </Link>
      </Button>
      {extra}
    </div>
  );
}
