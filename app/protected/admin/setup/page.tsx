import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SETUP_LINKS = [
  {
    href: "/protected/admin/roles",
    title: "People & roles",
    description: "Make someone an admin or a chapter lead, and pick which chapters a lead covers.",
  },
  {
    href: "/protected/admin/event-types",
    title: "Event types",
    description: "Add, rename, reorder, and deactivate the types offered when creating an event.",
  },
  {
    href: "/protected/admin/event-templates",
    title: "Event templates",
    description: "Reusable starting points for the create wizard — title, description, location, capacity, and volunteer roles.",
  },
  {
    href: "/protected/admin/venues",
    title: "Venues",
    description: "Saved places the event forms can pick from to fill in the address. Retire old ones without touching past events.",
  },
  {
    href: "/protected/admin/setup/applications",
    title: "Volunteer applications",
    description: "How many events someone attends before a screening call, and the link applicants use to book one.",
  },
  {
    href: "/protected/admin/setup/interest-areas",
    title: "Interest areas",
    description: "The plain-language “What are you interested in helping with?” choices on the volunteer application. Separate from role types.",
  },
  {
    href: "/protected/admin/volunteers/roles",
    title: "Volunteer role types",
    description: "The catalog of roles volunteers can be approved for and events can ask for.",
  },
];

export default function AdminSetupPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Setup</h1>
        <p className="text-sm text-muted-foreground">Configuration shared across events and volunteers.</p>
      </div>
      <div className="flex flex-col gap-4">
        {SETUP_LINKS.map((link) => (
          <Card key={link.href}>
            <CardHeader>
              <CardTitle>{link.title}</CardTitle>
              <CardDescription>{link.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={link.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
