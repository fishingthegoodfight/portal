import { redirect } from "next/navigation";

/**
 * The header's "Admin" link needs a destination at the bare /protected/admin
 * segment — admin actions themselves live per-event (the "Manage" link on
 * each event card), so this just forwards to the events list where those
 * links are.
 */
export default function AdminIndexPage() {
  redirect("/protected/events");
}
