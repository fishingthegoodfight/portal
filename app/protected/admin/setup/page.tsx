import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SETUP_LINKS = [
  {
    href: "/protected/admin/event-types",
    title: "Event types",
    description: "Add, rename, reorder, and deactivate the types offered when creating an event.",
  },
  {
    href: "/protected/admin/event-templates",
    title: "Event templates",
    description: "Reusable starting points for the create wizard — description, capacity, and volunteer roles.",
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
