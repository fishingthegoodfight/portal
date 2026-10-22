import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadEventAdminAccess } from "@/lib/admin/require-admin";
import { AdminNav, type AdminNavItem } from "@/components/admin/admin-nav";

async function AdminGate({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const access = await loadEventAdminAccess(supabase);
  if (!access) redirect("/auth/login");
  if (!access.hasAccess) redirect("/protected/events");

  const leads = access.isAdmin || access.role === "chapter_lead";
  const items: AdminNavItem[] = [
    { href: "/protected/admin", label: "Events", also: ["/protected/admin/events"] },
    ...(leads ? [{ href: "/protected/admin/applications", label: "Applications" }] : []),
    ...(access.isAdmin
      ? [
          { href: "/protected/admin/certifications", label: "Certifications" },
          { href: "/protected/admin/waivers", label: "Waivers" },
          { href: "/protected/admin/marketing", label: "Marketing" },
        ]
      : []),
    ...(leads ? [{ href: "/bulletin", label: "Weekly bulletin" }] : []),
    ...(access.isAdmin
      ? [
          {
            href: "/protected/admin/setup",
            label: "Setup",
            also: [
              "/protected/admin/event-types",
              "/protected/admin/event-templates",
              "/protected/admin/venues",
              "/protected/admin/role-types",
            ],
          },
        ]
      : []),
  ];

  return (
    <div className="flex w-full flex-col gap-8">
      {/* An event's own lead has only Events: no bar for one item. */}
      {items.length > 1 && <AdminNav items={items} />}
      {children}
    </div>
  );
}

/**
 * Single choke point for every /protected/admin/* route: admins, chapter
 * leads, and anyone who leads an event (has_event_admin_access) get past
 * here; everyone else is bounced back to the events list. It also draws the
 * admin menu bar (components/admin/admin-nav.tsx), limited to what each
 * person can reach. Admin-only
 * sections (setup, certifications, role types, waivers) add their own AdminOnlyGate
 * layout, and each event's pages check can_manage_event — all of it backed
 * by RLS, so this is about sending people somewhere sensible, not security.
 * The check is cookie-based (dynamic), so it's wrapped in its own Suspense
 * boundary rather than left bare in the layout — same reasoning as the
 * per-page loaders under app/protected/*.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
