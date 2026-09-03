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

-- =============================================================================
-- 2026-08-21 — Add per-event timezone
-- =============================================================================
-- starts_at/ends_at are timestamptz, so they already store a correct
-- absolute instant no matter who reads or writes them. But nothing recorded
-- which IANA zone that instant's wall-clock time belongs to for a given
-- event's venue, so the portal's date formatting had no choice but to fall
-- back to whatever timezone happened to be rendering it — wrong for an
-- in-person event, which should read the same venue-local time to every
-- viewer regardless of where they are, and it also caused an SSR/hydration
-- mismatch on the RSVP page whenever the server and browser disagreed.
--
-- Default of 'America/Denver' covers the org's Colorado chapters; the
-- update below corrects the Georgia chapters. Adjust the default and/or the
-- backfill if the actual chapter mix in the table differs from
-- lib/chapters.ts at the time this is run.
alter table public.events
  add column if not exists timezone text not null default 'America/Denver';

update public.events
   set timezone = 'America/New_York'
 where chapter in ('Atlanta', 'Rome');

-- =============================================================================
-- 2026-09-01 — Registration sections: per-event array + profile-backed fields
-- =============================================================================
-- Replaces a one-off per-section boolean column on events with a general
-- registration_sections array, so future sections (sizing, a waiver, etc.)
-- don't each need their own events column. See lib/registration-sections.ts
-- for the catalog of section ids and the profile columns backing each one.
alter table public.events
  add column if not exists registration_sections text[] not null default '{}'::text[];

-- The dietary section is profile-backed like emergency contact: collected
-- once on an RSVP, then reused on every future one instead of being asked
-- again.
alter table public.profiles
  add column if not exists dietary_notes text;

-- =============================================================================
-- 2026-09-03 — cancel_rsvp: delete the row instead of soft-cancelling
-- =============================================================================
-- Reported bug: after cancelling, submitting a new RSVP for the same event
-- left the "Submitting..." button stuck. Root cause: cancel_rsvp only ever
-- soft-cancelled (status = 'cancelled', row kept), which left a row sitting
-- on the (event_id, user_id) unique slot forever and never gave back the
-- capacity it held. That should have been harmless — rsvp_to_event's upsert
-- (below, re-created unchanged from the 2026-08-18 fix) is written to update
-- that row back to confirmed/waitlisted rather than conflict on it — but it
-- also meant a cancelled-then-never-reclaimed spot stayed counted against
-- capacity forever. Deleting on cancel fixes both: a fresh RSVP is a plain
-- insert with nothing to conflict against, and a freed confirmed spot goes
-- back into circulation immediately for the next signup or waitlist promotion.
--
-- rsvp_to_event is included here too (create-or-replace, safe to re-run) just
-- to guarantee the 2026-08-18 upsert fix is actually live — its ON CONFLICT
-- branch now mainly serves as a safety net for two concurrent RSVP submits,
-- since cancel_rsvp no longer leaves a row behind for a resubmit to find.
create or replace function public.cancel_rsvp(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  delete from public.rsvps
   where event_id = p_event_id and user_id = auth.uid()
  returning status into v_status;

  if v_status = 'confirmed' then
    update public.events
       set spots_taken = greatest(spots_taken - 1, 0), updated_at = now()
     where id = p_event_id;
  end if;
end $function$;

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
  -- cancel, which now deletes rather than leaves a row): attempt the
  -- capacity-checked update; the row lock it takes is what makes
  -- simultaneous signups safe.
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
