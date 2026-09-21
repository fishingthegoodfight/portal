-- =============================================================================
-- 2026-09-21 — Dietary copy: "answered No" is stored, distinct from "never answered"
-- =============================================================================
-- rsvps.dietary_notes now has three distinct states instead of two:
--   NULL      never answered (the roster shows a "not answered" marker)
--   'None'    answered "No" — no restrictions (the roster shows "No restrictions")
--   any text  the restrictions
-- Before, "No" was dropped to NULL, so it looked the same as never answering.
-- The sync trigger already calls dietary_note_from_profile for the value, so
-- changing that one function changes the trigger too: a profile answer of
-- 'None' now lands on the RSVP row as 'None'. A blank/NULL profile answer stays
-- NULL. (The app's RSVP form, "Update my registration" and the walk-up path
-- send the same three-state value.)
create or replace function public.dietary_note_from_profile(p_value text)
returns text
language sql
immutable
as $function$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else btrim(p_value)
  end;
$function$;

-- Repair: bring every active RSVP for an upcoming, scheduled event that
-- collects dietary in line with its person's profile — this is what turns the
-- earlier "answered No" rows (stored as NULL) into 'None'. "Is distinct from"
-- compares NULLs correctly, so a NULL copy IS filled when the profile has an
-- answer, and a NULL copy for someone who never answered stays NULL.
update public.rsvps r
   set dietary_notes = public.dietary_note_from_profile(p.dietary_notes),
       updated_at = now()
  from public.profiles p, public.events e
 where p.id = r.user_id
   and e.id = r.event_id
   and r.status in ('confirmed', 'waitlisted', 'offered')
   and 'dietary' = any(e.registration_sections)
   and e.status = 'scheduled'
   and e.starts_at > now()
   and r.dietary_notes is distinct from public.dietary_note_from_profile(p.dietary_notes);
