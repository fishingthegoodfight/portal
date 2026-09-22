import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { EventCreateWizard } from "@/components/admin/event-create-wizard";
import type { EventTypeOption } from "@/lib/event-types";
import type { EventTemplateWithRoles } from "@/lib/event-templates";

const TEMPLATE_COLUMNS =
  "id, name, event_type, chapter, description, default_capacity, default_registration_sections, default_virtual_link, default_virtual_access_notes, active, roles:event_template_roles(id, role_type_id, description, what_to_bring, shift_start_offset, shift_end_offset, number_needed, sort_order)";

async function NewEventLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }
  const userId = data.claims.sub as string;

  const [{ data: profile }, { data: roleTypes }, { data: eventTypes }, { data: templates }] =
    await Promise.all([
      supabase.from("profiles").select("first_name, last_name, email, phone").eq("id", userId).maybeSingle(),
      supabase
        .from("volunteer_role_types")
        .select("id, name")
        .eq("for_chapter_events", true)
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("event_types")
        .select("id, key, name, default_registration_sections, sort_order, active")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase.from("event_templates").select(TEMPLATE_COLUMNS).eq("active", true).order("name", { ascending: true }),
    ]);

  const leadName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  return (
    <EventCreateWizard
      adminPrefill={{
        leadName,
        leadEmail: profile?.email ?? (data.claims.email as string | undefined) ?? "",
        leadPhone: profile?.phone ?? "",
      }}
      roleTypes={roleTypes ?? []}
      eventTypes={(eventTypes ?? []) as EventTypeOption[]}
      templates={(templates ?? []) as unknown as EventTemplateWithRoles[]}
    />
  );
}

export default function NewEventPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">New event</h1>
        <p className="text-sm text-muted-foreground">
          A few steps, then review everything before it&apos;s created.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <NewEventLoader />
      </Suspense>
    </div>
  );
}
