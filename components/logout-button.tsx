"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // A hard navigation, not router.push/refresh: every server component in
    // the tree (header included) has to be rendered from scratch against the
    // new (empty) session, with nothing served from the client router cache.
    // router.refresh() only clears the cache for the route it's called from
    // and races the still-in-flight signOut — it isn't reliably enough to
    // guarantee a previous user's data can never flash on screen.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Deliberately a full page load, not router navigation: the client router cache would otherwise keep serving the previous user's header/profile after sign-out (see the comment above).
    window.location.href = "/auth/login";
  };

  return <Button onClick={logout}>Logout</Button>;
}
