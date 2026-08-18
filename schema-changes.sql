-- schema-changes.sql
--
-- Running log of every schema change made to the Supabase database after the
-- initial Phase 0 schema (the 5 tables — profiles, events, rsvps,
-- volunteer_opportunities, volunteer_signups — plus their RLS policies and
-- the atomic capacity-check function). Entries are in chronological order,
-- each one exactly as run in the Supabase SQL editor, so the schema can be
-- rebuilt from scratch by applying Phase 0 followed by every entry below in
-- order.
--
-- When adding a new entry: append it at the end, dated the day it was run.

-- =============================================================================
-- 2026-08-18 — Add mailing address columns to profiles
-- =============================================================================
alter table public.profiles
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text;

-- =============================================================================
-- 2026-08-18 — Fix rsvp_to_event: upsert instead of plain insert
-- =============================================================================
-- Two bugs in the original version:
--   1. A plain INSERT into rsvps has no conflict handling. cancel_rsvp only
--      soft-cancels (sets status = 'cancelled', never deletes the row), so
--      re-RSVPing after a cancel hit the unique (event_id, user_id)
--      constraint.
--   2. Calling this again while already 'confirmed' or 'waitlisted' (e.g. the
--      portal's "Update RSVP" button, used to edit dietary notes) re-ran the
--      capacity check and incremented events.spots_taken a second time for a
--      spot the user already held.
-- Fix: short-circuit to a notes-only update when an active RSVP already
-- exists, and upsert (ON CONFLICT ... DO UPDATE) for the fresh/re-signup
-- case instead of a bare INSERT. cancel_rsvp is unchanged — it was correct.
create or replace function public.rsvp_to_event(p_event_id bigint, p_dietary text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_existing_status text;
begin
  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = auth.uid();

  if v_existing_status in ('confirmed', 'waitlisted') then
    -- Already holding a spot (or a place in line) — just update the
    -- dietary notes, don't touch capacity.
    update public.rsvps
       set dietary_notes = p_dietary, updated_at = now()
     where event_id = p_event_id and user_id = auth.uid();
    return v_existing_status;
  end if;

  -- No active RSVP yet (first-time signup, or re-signing up after a
  -- cancel): attempt the capacity-checked update; the row lock it takes is
  -- what makes simultaneous signups safe.
  update public.events
     set spots_taken = spots_taken + 1, updated_at = now()
   where id = p_event_id
     and is_published
     and spots_taken < capacity;

  v_status := case when found then 'confirmed' else 'waitlisted' end;

  insert into public.rsvps (event_id, user_id, status, dietary_notes)
  values (p_event_id, auth.uid(), v_status, p_dietary)
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                dietary_notes = excluded.dietary_notes,
                updated_at = now();

  return v_status;
end $function$;
