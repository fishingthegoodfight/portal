import Link from "next/link";
import { ChevronRight } from "lucide-react";

type SetupLink = { href: string; title: string; description: string };

/** Setup, grouped by what it configures. */
const SETUP_GROUPS: { title: string; links: SetupLink[] }[] = [
  {
    title: "Chapters & people",
    links: [
      {
        href: "/protected/admin/setup/chapters",
        title: "Regions & chapters",
        description: "Add, rename, reorder and deactivate chapters, and the regions they're grouped into.",
      },
      {
        href: "/protected/admin/setup/members",
        title: "Members settings",
        description: "When someone counts as new, quiet or dropped, when they need outreach, and the weekly outreach email.",
      },
      {
        href: "/protected/admin/setup/duplicates",
        title: "Duplicate profiles",
        description: "People with two profiles from signing in with two emails: find likely pairs and merge them.",
      },
    ],
  },
  {
    title: "Events",
    links: [
      {
        href: "/protected/admin/event-types",
        title: "Event types",
        description: "The types offered when creating an event, and the sections each asks for by default.",
      },
      {
        href: "/protected/admin/event-templates",
        title: "Event templates",
        description: "Starting points for New event: title, description, location, capacity and volunteer roles.",
      },
      {
        href: "/protected/admin/venues",
        title: "Venues",
        description: "Saved places the event forms can pick from. Retire old ones without touching past events.",
      },
    ],
  },
  {
    title: "Volunteers",
    links: [
      {
        href: "/protected/admin/role-types",
        title: "Volunteer role types",
        description: "The roles volunteers are approved for and events ask for.",
      },
      {
        href: "/protected/admin/setup/interest-areas",
        title: "Interest areas",
        description: "The “What are you interested in helping with?” choices on the volunteer application.",
      },
      {
        href: "/protected/admin/setup/applications",
        title: "Application settings",
        description: "How many events someone attends before a screening call, and the booking link for it.",
      },
      {
        href: "/protected/admin/setup/opportunities-email",
        title: "Opportunities email",
        description: "The every-other-week email of open volunteer roles: on or off, and which day.",
      },
    ],
  },
  {
    title: "Messages",
    links: [
      {
        href: "/protected/admin/setup/texting",
        title: "Texting",
        description: "Send yourself a test text, and see the latest texts and whether they were delivered.",
      },
      {
        href: "/protected/admin/setup/walkup-welcome",
        title: "Walk-up welcome emails",
        description: "Who made an account at a walk-up and hasn't had the welcome email yet.",
      },
    ],
  },
];

export default function AdminSetupPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Setup</h1>
        <p className="text-sm text-muted-foreground">
          Configuration shared across events and volunteers. People and roles are on Members.
        </p>
      </div>
      {SETUP_GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          <ul className="flex flex-col divide-y rounded-md border">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex items-center gap-3 p-3 hover:bg-accent/50">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">{link.title}</span>
                    <span className="text-sm text-muted-foreground">{link.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
