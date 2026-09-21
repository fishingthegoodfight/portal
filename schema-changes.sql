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

-- =============================================================================
-- 2026-09-18 — Add RSVP email lead contact + custom note to events
-- =============================================================================
-- Backs the RSVP confirmation/cancellation emails (Resend): lead_name and
-- lead_phone give attendees a day-of contact, custom_email_note is optional
-- per-event copy appended to the confirmation email. All nullable — the
-- email omits a section entirely when its column is unset.
alter table public.events
  add column if not exists lead_name text,
  add column if not exists lead_phone text,
  add column if not exists custom_email_note text;

-- =============================================================================
-- 2026-09-18 — Admin event page: is_admin, check-in, walk-up capacity helper
-- =============================================================================
-- Backs the new /protected/admin/events/[id] roster/check-in page.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.rsvps
  add column if not exists checked_in_at timestamptz;

-- SECURITY DEFINER so the RLS policies below can call it from a `profiles`
-- policy without recursing into `profiles` under RLS — it reads the row
-- directly, the same way rsvp_to_event/cancel_rsvp already bypass RLS to
-- update `events`.
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select is_admin from public.profiles where id = p_user_id),
    false
  );
$function$;

-- Extracted out of rsvp_to_event so the admin walk-up flow (below) claims
-- capacity through the exact same atomic check-and-increment instead of a
-- second copy of this logic that could drift out of sync.
create or replace function public.try_claim_event_spot(p_event_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.events
     set spots_taken = spots_taken + 1, updated_at = now()
   where id = p_event_id
     and is_published
     and spots_taken < capacity;
  return found;
end $function$;

-- Same behavior as before, now calling try_claim_event_spot instead of
-- inlining its own copy of the UPDATE ... WHERE spots_taken < capacity check.
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
    update public.rsvps
       set dietary_notes = p_dietary, updated_at = now()
     where event_id = p_event_id and user_id = auth.uid();
    return v_existing_status;
  end if;

  v_status := case when public.try_claim_event_spot(p_event_id) then 'confirmed' else 'waitlisted' end;

  insert into public.rsvps (event_id, user_id, status, dietary_notes)
  values (p_event_id, auth.uid(), v_status, p_dietary)
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                dietary_notes = excluded.dietary_notes,
                updated_at = now();

  return v_status;
end $function$;

-- Called by the "Add walk-up" server action (lib/actions/admin-walkup.ts)
-- after it has already resolved p_profile_id to an existing or
-- freshly-created profile — profile creation needs the Supabase Admin API
-- (to create the backing auth user), which plain SQL/RLS can't do, so that
-- step happens in JS before this function runs.
--
-- p_force lets an admin confirm past capacity: called with p_force false
-- against a full event, this returns 'capacity_exceeded' and changes
-- nothing, so the UI can ask "add anyway?" before a second call with
-- p_force true forces spots_taken over capacity and confirms them.
create or replace function public.admin_upsert_walkup_rsvp(
  p_event_id bigint,
  p_profile_id uuid,
  p_force boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_status text;
  v_claimed boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add walk-up RSVPs';
  end if;

  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = p_profile_id;

  if v_existing_status in ('confirmed', 'waitlisted') then
    -- Already RSVP'd (e.g. pre-registered, or a retry after a capacity
    -- confirmation) — just check them in, don't touch capacity again.
    update public.rsvps
       set status = 'confirmed', checked_in_at = now(), updated_at = now()
     where event_id = p_event_id and user_id = p_profile_id;
    return 'confirmed';
  end if;

  v_claimed := public.try_claim_event_spot(p_event_id);

  if not v_claimed and not p_force then
    return 'capacity_exceeded';
  end if;

  if not v_claimed and p_force then
    update public.events
       set spots_taken = spots_taken + 1, updated_at = now()
     where id = p_event_id;
  end if;

  insert into public.rsvps (event_id, user_id, status, checked_in_at)
  values (p_event_id, p_profile_id, 'confirmed', now())
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                checked_in_at = excluded.checked_in_at,
                updated_at = now();

  return 'confirmed';
end $function$;

-- Admin read access for the roster page: everyone's rsvps and profiles for
-- any event, not just the caller's own row. Additive (permissive) policies —
-- Postgres ORs multiple permissive policies together, so these don't replace
-- each table's existing "read your own row" policy, just add a second way to
-- satisfy SELECT.
create policy admin_select_all_profiles on public.profiles
  for select
  using (public.is_admin());

create policy admin_select_all_rsvps on public.rsvps
  for select
  using (public.is_admin());

-- Lets the check-in toggle update checked_in_at directly from the browser
-- client (RLS-protected), without a server round trip, so it feels instant.
create policy admin_update_rsvps on public.rsvps
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- 2026-09-18 — Event edit/cancel: status, cancellation, .ics sequence tracking
-- =============================================================================
-- Backs admin event editing and cancellation (/protected/admin/events/[id]/edit,
-- the "Cancel event" flow) and RFC 5546-correct calendar updates for both.
alter table public.events
  add column if not exists status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled')),
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  -- The iCalendar SEQUENCE for this event's VEVENT (see lib/email/ics.ts).
  -- Bumped whenever the calendar entry itself changes — date, time,
  -- location, or a cancellation — so a calendar client that's already seen
  -- an earlier SEQUENCE for this UID accepts the update instead of ignoring
  -- it as stale. A plain new RSVP confirmation reads this as-is, unbumped.
  add column if not exists ics_sequence integer not null default 0;

-- A cancelled event can no longer take RSVPs (regular signups or admin
-- walk-ups both go through this), on top of the existing is_published gate.
create or replace function public.try_claim_event_spot(p_event_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.events
     set spots_taken = spots_taken + 1, updated_at = now()
   where id = p_event_id
     and is_published
     and status = 'scheduled'
     and spots_taken < capacity;
  return found;
end $function$;

-- Admin write access for the edit/cancel flows — both go through a plain
-- UPDATE on events (see lib/actions/admin-event.ts), not a RPC, so this is
-- needed the same way admin_update_rsvps already is for check-in.
create policy admin_update_events on public.events
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- 2026-09-18 — Add lead_email to events
-- =============================================================================
-- Alongside lead_name/lead_phone — shown in the confirmation email's day-of
-- contact block and editable from the admin event editor.
alter table public.events
  add column if not exists lead_email text;

-- =============================================================================
-- 2026-09-18 — admin_upsert_walkup_rsvp: block walk-ups on a cancelled event
-- =============================================================================
-- p_force is meant to bypass capacity only — it never should have been able
-- to add someone to an event that's actually cancelled. try_claim_event_spot
-- already refuses non-scheduled events, but the p_force branch skips that
-- function entirely, so it needs its own check.
create or replace function public.admin_upsert_walkup_rsvp(
  p_event_id bigint,
  p_profile_id uuid,
  p_force boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_status text;
  v_claimed boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add walk-up RSVPs';
  end if;

  if not exists (
    select 1 from public.events where id = p_event_id and status = 'scheduled'
  ) then
    raise exception 'Event is not scheduled';
  end if;

  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = p_profile_id;

  if v_existing_status in ('confirmed', 'waitlisted') then
    update public.rsvps
       set status = 'confirmed', checked_in_at = now(), updated_at = now()
     where event_id = p_event_id and user_id = p_profile_id;
    return 'confirmed';
  end if;

  v_claimed := public.try_claim_event_spot(p_event_id);

  if not v_claimed and not p_force then
    return 'capacity_exceeded';
  end if;

  if not v_claimed and p_force then
    update public.events
       set spots_taken = spots_taken + 1, updated_at = now()
     where id = p_event_id;
  end if;

  insert into public.rsvps (event_id, user_id, status, checked_in_at)
  values (p_event_id, p_profile_id, 'confirmed', now())
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                checked_in_at = excluded.checked_in_at,
                updated_at = now();

  return 'confirmed';
end $function$;

-- =============================================================================
-- 2026-09-18 — Admin event creation: location fields, recurrence, volunteers
-- =============================================================================
-- Backs /protected/admin/events/new. event_type already existed (free text,
-- read since Phase 1) — left unconstrained rather than adding a CHECK, since
-- existing rows' values aren't known here; the create/edit forms are the
-- only things that need to agree on the catalog (lib/event-types.ts).
--
-- marketing_tier: added per request but intentionally left unwired — no
-- form field sets it, no code reads it. Nullable so that's safe.
alter table public.events
  add column if not exists venue_name text,
  add column if not exists street_address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists marketing_tier text,
  -- Shared across every row generated from one "repeat weekly/biweekly/
  -- monthly" submission, null for a one-off event — lets a future edit
  -- offer "this event" vs. "this and all future". recurrence_frequency and
  -- recurrence_end_date describe the pattern that produced the series;
  -- stored on every row in it (simple, if redundant) rather than a separate
  -- series table, since nothing here needs to edit the pattern itself yet.
  add column if not exists series_id uuid,
  add column if not exists recurrence_frequency text
    check (recurrence_frequency in ('weekly', 'biweekly', 'monthly')),
  add column if not exists recurrence_end_date date;

create policy admin_insert_events on public.events
  for insert
  with check (public.is_admin());

-- New registration sections (lib/registration-sections.ts): "sizing" for
-- Fish A-Long gear/shirt sizing, "waiver" as a lightweight typed-signature
-- liability acknowledgment. Profile-backed like the existing sections.
alter table public.profiles
  add column if not exists sizing_notes text,
  add column if not exists waiver_signature text;

-- shift_start/shift_end/what_to_bring didn't exist on the Phase 0 table —
-- role, description, slots, is_published, created_at already did.
alter table public.volunteer_opportunities
  add column if not exists shift_start timestamptz,
  add column if not exists shift_end timestamptz,
  add column if not exists what_to_bring text;

create policy admin_insert_volunteer_opportunities on public.volunteer_opportunities
  for insert
  with check (public.is_admin());

create policy admin_select_volunteer_opportunities on public.volunteer_opportunities
  for select
  using (public.is_admin());

-- Directory participation (lib/registration-sections.ts "directory" section).
-- Opt-in, so existing and new members default to not listed.
alter table public.profiles
  add column if not exists directory_opt_in boolean not null default false;

-- handle_new_user now also copies the sign-up form's directory choice
-- (auth user_metadata.directory_opt_in, a JSON boolean) onto the new profile.
-- Missing/null (e.g. admin-created walk-up users) falls back to false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, directory_opt_in)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data->>'directory_opt_in')::boolean, false)
  );
  return new;
end;
$$;

-- =============================================================================
-- Pre-event reminder emails (/api/cron/reminders)
-- =============================================================================
-- Set when the 1-week / 1-day reminder goes out, so it never sends twice.
alter table public.rsvps
  add column if not exists sent_1week_at timestamptz,
  add column if not exists sent_1day_at timestamptz;

-- =============================================================================
-- 2026-09-21 — Participant waitlist: ordering, 24-hour offers, expiry
-- =============================================================================
-- Status lifecycle for rsvps.status:
--   waitlisted -> offered (spot opened; offer_expires_at = +24h)
--   offered    -> confirmed (claim_offered_spot) | expired (lapsed, cron)
--                 | row deleted (participant declines / admin removes)
--   expired    -> waitlisted again only by re-joining via rsvp_to_event
--
-- Capacity model: events.spots_taken still counts CONFIRMED rsvps only. An
-- open offer holds a spot without touching spots_taken; every capacity check
-- (try_claim_event_spot, offer_waitlisted_spots) subtracts the number of
-- rows in status 'offered'. Claiming an offer moves the row to 'confirmed'
-- and bumps spots_taken through try_claim_event_spot, so it is the single
-- capacity gate and can never overbook.
--
-- Concurrency rule used by every function below: lock the events row FIRST
-- (a separate statement, so the next statement gets a fresh snapshot that
-- sees other transactions' committed offers), and only then touch rsvps.
-- Same lock order everywhere avoids deadlocks.

alter table public.rsvps
  add column if not exists joined_at timestamptz,
  add column if not exists offer_expires_at timestamptz;

-- Existing waitlisted rows: order by when they last changed, the best
-- approximation available.
update public.rsvps
   set joined_at = coalesce(updated_at, now())
 where status = 'waitlisted' and joined_at is null;

-- Allow the two new statuses. Drops whatever CHECK on rsvps mentions
-- "status" (its name isn't known here) and re-adds one with the full set.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.rsvps'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.rsvps drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rsvps
  add constraint rsvps_status_check
  check (status in ('confirmed', 'waitlisted', 'offered', 'expired', 'cancelled'));

create index if not exists rsvps_waitlist_order_idx
  on public.rsvps (event_id, joined_at, id)
  where status in ('waitlisted', 'offered');

create index if not exists rsvps_offer_expiry_idx
  on public.rsvps (offer_expires_at)
  where status = 'offered';

-- The existing capacity function, now (a) locking the event row up front so
-- it sees committed offers, and (b) subtracting open offers held by anyone
-- other than p_holder. p_holder is the offered person claiming their own
-- spot, whose offer must not count against themselves. Replaces the
-- one-argument version (dropped first: a new default parameter would
-- otherwise create an ambiguous overload).
drop function if exists public.try_claim_event_spot(bigint);

create or replace function public.try_claim_event_spot(
  p_event_id bigint,
  p_holder uuid default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform 1 from public.events where id = p_event_id for update;

  update public.events e
     set spots_taken = e.spots_taken + 1, updated_at = now()
   where e.id = p_event_id
     and e.is_published
     and e.status = 'scheduled'
     and e.spots_taken + (
           select count(*)
             from public.rsvps r
            where r.event_id = e.id
              and r.status = 'offered'
              and r.user_id is distinct from p_holder
         ) < e.capacity;
  return found;
end $function$;

-- rsvp_to_event: 'offered' counts as an existing active RSVP (notes-only
-- update — claiming goes through claim_offered_spot), waitlisting stamps
-- joined_at, and re-joining after a lapsed offer resets it (back of the
-- line) and clears the old expiry.
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

  if v_existing_status in ('confirmed', 'waitlisted', 'offered') then
    update public.rsvps
       set dietary_notes = p_dietary, updated_at = now()
     where event_id = p_event_id and user_id = auth.uid();
    return v_existing_status;
  end if;

  v_status := case when public.try_claim_event_spot(p_event_id) then 'confirmed' else 'waitlisted' end;

  insert into public.rsvps (event_id, user_id, status, dietary_notes, joined_at)
  values (
    p_event_id, auth.uid(), v_status, p_dietary,
    case when v_status = 'waitlisted' then now() end
  )
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                dietary_notes = excluded.dietary_notes,
                joined_at = excluded.joined_at,
                offer_expires_at = null,
                updated_at = now();

  return v_status;
end $function$;

-- Offers every open spot on an event to the next waitlisted people, oldest
-- joined_at first. Returns who was offered and when it expires. Offers as
-- many people as there are free spots (capacity - confirmed - open offers),
-- so it is also safe to call after a capacity increase. Does nothing for an
-- unpublished/cancelled/already-started event or one with no capacity limit.
-- p_now exists so the expiry cron can be tested with a fake clock.
--
-- Internal: not callable from the client (see the grants below). Everything
-- user-facing reaches it through cancel_rsvp / admin_remove_rsvp /
-- process_waitlist_expiry, which decide when an offer is appropriate.
create or replace function public.offer_waitlisted_spots(
  p_event_id bigint,
  p_now timestamptz default now()
)
returns table (o_user_id uuid, o_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_free integer;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into v_event from public.events where id = p_event_id;

  if not found
     or not v_event.is_published
     or v_event.status <> 'scheduled'
     or v_event.capacity is null
     or v_event.starts_at <= p_now then
    return;
  end if;

  v_free := v_event.capacity - v_event.spots_taken - (
    select count(*) from public.rsvps
     where event_id = p_event_id and status = 'offered'
  );
  if v_free <= 0 then
    return;
  end if;

  return query
  with next_up as (
    select r.id
      from public.rsvps r
     where r.event_id = p_event_id and r.status = 'waitlisted'
     order by coalesce(r.joined_at, 'infinity'::timestamptz), r.id
     limit v_free
       for update
  )
  update public.rsvps r
     set status = 'offered',
         offer_expires_at = p_now + interval '24 hours',
         updated_at = now()
    from next_up
   where r.id = next_up.id
  returning r.user_id, r.offer_expires_at;
end $function$;

revoke all on function public.offer_waitlisted_spots(bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.offer_waitlisted_spots(bigint, timestamptz) to service_role;

-- cancel_rsvp: same behavior (delete the caller's row, give back a confirmed
-- spot) plus: cancelling a confirmed RSVP or declining an offer immediately
-- offers the freed spot to the next waitlisted person. Now returns jsonb
-- (was void) so the server action knows who to email:
--   { previous_status: text|null, offered: [{ user_id, expires_at }] }
-- previous_status is null when the caller had no RSVP (nothing happened).
drop function if exists public.cancel_rsvp(bigint);

create or replace function public.cancel_rsvp(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_offered jsonb := '[]'::jsonb;
begin
  perform 1 from public.events where id = p_event_id for update;

  delete from public.rsvps
   where event_id = p_event_id and user_id = auth.uid()
  returning status into v_status;

  if v_status is null then
    return jsonb_build_object('previous_status', null, 'offered', v_offered);
  end if;

  if v_status = 'confirmed' then
    update public.events
       set spots_taken = greatest(spots_taken - 1, 0), updated_at = now()
     where id = p_event_id;
  end if;

  if v_status in ('confirmed', 'offered') then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', o_user_id, 'expires_at', o_expires_at)), '[]'::jsonb)
      into v_offered
      from public.offer_waitlisted_spots(p_event_id);
  end if;

  return jsonb_build_object('previous_status', v_status, 'offered', v_offered);
end $function$;

-- The offered person's "Claim your spot" button. Goes through
-- try_claim_event_spot (the one capacity gate), excluding their own offer
-- from the count. Returns 'confirmed', 'not_offered', 'expired' (offer
-- lapsed; the cron will process it) or 'capacity_exceeded' (e.g. the event
-- was cancelled or its capacity lowered since the offer).
create or replace function public.claim_offered_spot(p_event_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rsvp public.rsvps%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform 1 from public.events where id = p_event_id for update;

  select * into v_rsvp
    from public.rsvps
   where event_id = p_event_id and user_id = v_uid
     for update;

  if not found or v_rsvp.status <> 'offered' then
    return 'not_offered';
  end if;
  if v_rsvp.offer_expires_at is null or v_rsvp.offer_expires_at <= now() then
    return 'expired';
  end if;

  if not public.try_claim_event_spot(p_event_id, v_uid) then
    return 'capacity_exceeded';
  end if;

  update public.rsvps
     set status = 'confirmed', offer_expires_at = null, updated_at = now()
   where id = v_rsvp.id;

  return 'confirmed';
end $function$;

-- 1-based place in line among currently 'waitlisted' rsvps (offered people
-- are ahead of the line, not in it), or null if the caller isn't waitlisted.
-- SECURITY DEFINER because RLS only lets a participant see their own row.
create or replace function public.waitlist_position(p_event_id bigint)
returns integer
language sql
security definer
stable
set search_path to 'public'
as $function$
  select nullif(count(*), 0)::integer
    from public.rsvps me
    join public.rsvps r
      on r.event_id = me.event_id
     and r.status = 'waitlisted'
     and (coalesce(r.joined_at, 'infinity'::timestamptz), r.id)
         <= (coalesce(me.joined_at, 'infinity'::timestamptz), me.id)
   where me.event_id = p_event_id
     and me.user_id = auth.uid()
     and me.status = 'waitlisted';
$function$;

-- Open offers per event, so pages can show "full" when confirmed + offered
-- has reached capacity. SECURITY DEFINER for the same RLS reason.
create or replace function public.event_offered_counts(p_event_ids bigint[])
returns table (event_id bigint, offered_count integer)
language sql
security definer
stable
set search_path to 'public'
as $function$
  select r.event_id, count(*)::integer
    from public.rsvps r
   where r.event_id = any(p_event_ids) and r.status = 'offered'
   group by r.event_id;
$function$;

-- Admin: offer a spot to one specific waitlisted (or lapsed) person right
-- now, out of order if the admin chooses. Only when a spot is genuinely free
-- (capacity - confirmed - open offers > 0) — otherwise the offer could never
-- be claimed. Returns jsonb: { ok, reason?, event_id, user_id, expires_at }.
create or replace function public.admin_offer_spot(p_rsvp_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id bigint;
  v_rsvp public.rsvps%rowtype;
  v_event public.events%rowtype;
  v_free integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can offer spots';
  end if;

  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform 1 from public.events where id = v_event_id for update;
  select * into v_event from public.events where id = v_event_id;
  select * into v_rsvp from public.rsvps where id = p_rsvp_id for update;

  if not found or v_rsvp.status not in ('waitlisted', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_waitlisted');
  end if;
  if v_event.status <> 'scheduled' or not v_event.is_published or v_event.capacity is null then
    return jsonb_build_object('ok', false, 'reason', 'event_unavailable');
  end if;

  v_free := v_event.capacity - v_event.spots_taken - (
    select count(*) from public.rsvps where event_id = v_event_id and status = 'offered'
  );
  if v_free <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_capacity');
  end if;

  update public.rsvps
     set status = 'offered',
         offer_expires_at = now() + interval '24 hours',
         updated_at = now()
   where id = p_rsvp_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'user_id', v_rsvp.user_id,
    'expires_at', now() + interval '24 hours'
  );
end $function$;

-- Admin: remove anyone from an event, whatever their status. Frees a
-- confirmed spot (and offers it to the next person, like a cancellation), and
-- voids an open offer (same). Returns jsonb:
--   { removed, previous_status, user_id, offered: [{ user_id, expires_at }] }
create or replace function public.admin_remove_rsvp(p_rsvp_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id bigint;
  v_user_id uuid;
  v_status text;
  v_offered jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove RSVPs';
  end if;

  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    return jsonb_build_object('removed', false, 'offered', v_offered);
  end if;

  perform 1 from public.events where id = v_event_id for update;

  delete from public.rsvps
   where id = p_rsvp_id
  returning status, user_id into v_status, v_user_id;

  if v_status is null then
    return jsonb_build_object('removed', false, 'offered', v_offered);
  end if;

  if v_status = 'confirmed' then
    update public.events
       set spots_taken = greatest(spots_taken - 1, 0), updated_at = now()
     where id = v_event_id;
  end if;

  if v_status in ('confirmed', 'offered') then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', o_user_id, 'expires_at', o_expires_at)), '[]'::jsonb)
      into v_offered
      from public.offer_waitlisted_spots(v_event_id);
  end if;

  return jsonb_build_object(
    'removed', true,
    'previous_status', v_status,
    'user_id', v_user_id,
    'offered', v_offered
  );
end $function$;

-- The hourly expiry job's workhorse (called by /api/cron/waitlist with the
-- service-role key). For every event with a lapsed offer or a waiting line:
-- lock the event, mark lapsed offers 'expired', then offer any free spots to
-- the next waitlisted people. Idempotent: a second run finds nothing lapsed
-- and (with the spots now held by open offers) nothing free, so it changes
-- nothing and returns empty lists. Concurrent runs serialize on the event
-- lock, and the loser re-reads committed state. Sweeping events that merely
-- have a line + a free spot also self-heals anything that slipped past the
-- immediate offer (e.g. a capacity increase). Returns jsonb:
--   { expired: [{ event_id, user_id }], offered: [{ event_id, user_id, expires_at }] }
-- p_now is the fake-clock hook for testing.
create or replace function public.process_waitlist_expiry(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id bigint;
  v_expired jsonb := '[]'::jsonb;
  v_offered jsonb := '[]'::jsonb;
  v_chunk jsonb;
begin
  for v_event_id in
    select event_id from public.rsvps
     where status = 'offered' and offer_expires_at <= p_now
    union
    select event_id from public.rsvps
     where status = 'waitlisted'
    order by 1
  loop
    perform 1 from public.events where id = v_event_id for update;

    with lapsed as (
      update public.rsvps
         set status = 'expired', updated_at = now()
       where event_id = v_event_id
         and status = 'offered'
         and offer_expires_at <= p_now
      returning user_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('event_id', v_event_id, 'user_id', user_id)), '[]'::jsonb)
      into v_chunk
      from lapsed;
    v_expired := v_expired || v_chunk;

    select coalesce(jsonb_agg(jsonb_build_object('event_id', v_event_id, 'user_id', o_user_id, 'expires_at', o_expires_at)), '[]'::jsonb)
      into v_chunk
      from public.offer_waitlisted_spots(v_event_id, p_now);
    v_offered := v_offered || v_chunk;
  end loop;

  return jsonb_build_object('expired', v_expired, 'offered', v_offered);
end $function$;

revoke all on function public.process_waitlist_expiry(timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_waitlist_expiry(timestamptz) to service_role;

-- Admin walk-up: a waitlisted or offered person walking up is confirmed and
-- checked in, and now actually takes a spot. The previous version flipped
-- their status to 'confirmed' WITHOUT incrementing spots_taken (only
-- already-confirmed people should skip the capacity claim). Waitlisted/offered
-- people now claim capacity (their own offer excluded), or need p_force to go
-- over capacity, same as a brand-new walk-up.
create or replace function public.admin_upsert_walkup_rsvp(
  p_event_id bigint,
  p_profile_id uuid,
  p_force boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_status text;
  v_claimed boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add walk-up RSVPs';
  end if;

  if not exists (
    select 1 from public.events where id = p_event_id and status = 'scheduled'
  ) then
    raise exception 'Event is not scheduled';
  end if;

  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = p_profile_id;

  if v_existing_status = 'confirmed' then
    update public.rsvps
       set checked_in_at = now(), updated_at = now()
     where event_id = p_event_id and user_id = p_profile_id;
    return 'confirmed';
  end if;

  v_claimed := public.try_claim_event_spot(p_event_id, p_profile_id);

  if not v_claimed and not p_force then
    return 'capacity_exceeded';
  end if;

  if not v_claimed and p_force then
    update public.events
       set spots_taken = spots_taken + 1, updated_at = now()
     where id = p_event_id;
  end if;

  insert into public.rsvps (event_id, user_id, status, checked_in_at)
  values (p_event_id, p_profile_id, 'confirmed', now())
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                checked_in_at = excluded.checked_in_at,
                offer_expires_at = null,
                updated_at = now();

  return 'confirmed';
end $function$;

-- -----------------------------------------------------------------------------
-- Hourly expiry job: pg_cron + pg_net -> /api/cron/waitlist, secret in Vault
-- -----------------------------------------------------------------------------
-- Run these steps in order in the Supabase SQL editor.
--
-- Step 1 — enable the extensions (or Dashboard > Database > Extensions):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Step 2 — store the shared secret in Vault. It must be EXACTLY the same
-- value as the CRON_SECRET env var in Vercel (Project > Settings >
-- Environment Variables), which is what the route checks. Run this ONCE with
-- the real value pasted in, and do not commit the real value anywhere:
--
--   select vault.create_secret(
--     'PASTE-THE-CRON_SECRET-VALUE-HERE',
--     'cron_secret',
--     'Bearer secret for /api/cron/* routes'
--   );
--
-- To rotate it later (after changing CRON_SECRET in Vercel and redeploying):
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'cron_secret'),
--     'NEW-VALUE'
--   );
--
-- Check it's stored (shows the name, never prints the value here):
--
--   select name, created_at from vault.secrets where name = 'cron_secret';

-- Step 3 — schedule it hourly, on the hour. The secret is read from Vault at
-- each run; nothing sensitive is stored in the job definition. Re-running
-- this statement replaces the job of the same name rather than duplicating.
select cron.schedule(
  'waitlist-expiry-hourly',
  '0 * * * *',
  $$
  select net.http_get(
    url := 'https://portal-ftgf.vercel.app/api/cron/waitlist',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'cron_secret'
      )
    ),
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify (after the top of the next hour, or trigger one immediately with the
-- select below):
--   select * from cron.job where jobname = 'waitlist-expiry-hourly';
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select id, status_code, content, created
--     from net._http_response order by created desc limit 5;   -- expect 200
--
-- Run it once right now without waiting for the schedule:
--   select net.http_get(
--     url := 'https://portal-ftgf.vercel.app/api/cron/waitlist',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || (
--       select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
--   );
--
-- Turn it off:
--   select cron.unschedule('waitlist-expiry-hourly');

-- =============================================================================
-- 2026-09-21 — Unlimited events (capacity null) never waitlist anyone
-- =============================================================================
-- try_claim_event_spot compared spots_taken + offers < capacity, which is
-- NULL (not true) when capacity is null, so every RSVP to an "Unlimited"
-- event was waitlisted. Null capacity now means no limit: a claim always
-- succeeds (still counting spots_taken, still requiring a published,
-- scheduled event). The offer functions treat null the same way, so any
-- people already stuck on an unlimited event's waitlist are offered a spot on
-- the next cron run (or immediately when an admin switches an event to
-- unlimited).
create or replace function public.try_claim_event_spot(
  p_event_id bigint,
  p_holder uuid default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform 1 from public.events where id = p_event_id for update;

  update public.events e
     set spots_taken = e.spots_taken + 1, updated_at = now()
   where e.id = p_event_id
     and e.is_published
     and e.status = 'scheduled'
     and (
       e.capacity is null
       or e.spots_taken + (
            select count(*)
              from public.rsvps r
             where r.event_id = e.id
               and r.status = 'offered'
               and r.user_id is distinct from p_holder
          ) < e.capacity
     );
  return found;
end $function$;

-- Same as before except null capacity = unlimited (v_free stays null, and
-- LIMIT NULL means no limit, so everyone waiting is offered).
create or replace function public.offer_waitlisted_spots(
  p_event_id bigint,
  p_now timestamptz default now()
)
returns table (o_user_id uuid, o_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_free integer;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into v_event from public.events where id = p_event_id;

  if not found
     or not v_event.is_published
     or v_event.status <> 'scheduled'
     or v_event.starts_at <= p_now then
    return;
  end if;

  if v_event.capacity is not null then
    v_free := v_event.capacity - v_event.spots_taken - (
      select count(*) from public.rsvps
       where event_id = p_event_id and status = 'offered'
    );
    if v_free <= 0 then
      return;
    end if;
  end if;

  return query
  with next_up as (
    select r.id
      from public.rsvps r
     where r.event_id = p_event_id and r.status = 'waitlisted'
     order by coalesce(r.joined_at, 'infinity'::timestamptz), r.id
     limit v_free
       for update
  )
  update public.rsvps r
     set status = 'offered',
         offer_expires_at = p_now + interval '24 hours',
         updated_at = now()
    from next_up
   where r.id = next_up.id
  returning r.user_id, r.offer_expires_at;
end $function$;

-- Same as before except an unlimited event always has a free spot to offer.
create or replace function public.admin_offer_spot(p_rsvp_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id bigint;
  v_rsvp public.rsvps%rowtype;
  v_event public.events%rowtype;
  v_free integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can offer spots';
  end if;

  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform 1 from public.events where id = v_event_id for update;
  select * into v_event from public.events where id = v_event_id;
  select * into v_rsvp from public.rsvps where id = p_rsvp_id for update;

  if not found or v_rsvp.status not in ('waitlisted', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_waitlisted');
  end if;
  if v_event.status <> 'scheduled' or not v_event.is_published then
    return jsonb_build_object('ok', false, 'reason', 'event_unavailable');
  end if;

  if v_event.capacity is not null then
    v_free := v_event.capacity - v_event.spots_taken - (
      select count(*) from public.rsvps where event_id = v_event_id and status = 'offered'
    );
    if v_free <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_capacity');
    end if;
  end if;

  update public.rsvps
     set status = 'offered',
         offer_expires_at = now() + interval '24 hours',
         updated_at = now()
   where id = p_rsvp_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'user_id', v_rsvp.user_id,
    'expires_at', now() + interval '24 hours'
  );
end $function$;

-- =============================================================================
-- 2026-09-21 — Null-safe capacity checks + spots_taken reconciliation
-- =============================================================================
-- Events created by hand in the Table Editor (before the creation form) can
-- carry NULL or stale values in the columns the waitlist functions check.
-- SQL three-valued logic makes that dangerous in both directions: a NULL
-- is_published/spots_taken made try_claim_event_spot's UPDATE match nothing
-- (so everyone was waitlisted), while the same NULLs made offer_waitlisted_spots
-- and admin_offer_spot's "unavailable" guards evaluate to NULL, i.e. NOT
-- return — offering spots on an unpublished event. Every check below is now
-- explicit: NULL is_published = unpublished, NULL status = 'scheduled', NULL
-- spots_taken = 0, NULL starts_at = not started, NULL capacity = unlimited.

create or replace function public.try_claim_event_spot(
  p_event_id bigint,
  p_holder uuid default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform 1 from public.events where id = p_event_id for update;

  update public.events e
     set spots_taken = coalesce(e.spots_taken, 0) + 1, updated_at = now()
   where e.id = p_event_id
     and coalesce(e.is_published, false)
     and coalesce(e.status, 'scheduled') = 'scheduled'
     and (
       e.capacity is null
       or coalesce(e.spots_taken, 0) + (
            select count(*)
              from public.rsvps r
             where r.event_id = e.id
               and r.status = 'offered'
               and r.user_id is distinct from p_holder
          ) < e.capacity
     );
  return found;
end $function$;

create or replace function public.offer_waitlisted_spots(
  p_event_id bigint,
  p_now timestamptz default now()
)
returns table (o_user_id uuid, o_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_free integer;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into v_event from public.events where id = p_event_id;

  if not found
     or not coalesce(v_event.is_published, false)
     or coalesce(v_event.status, 'scheduled') <> 'scheduled'
     or not coalesce(v_event.starts_at > p_now, true) then
    return;
  end if;

  if v_event.capacity is not null then
    v_free := v_event.capacity - coalesce(v_event.spots_taken, 0) - (
      select count(*) from public.rsvps
       where event_id = p_event_id and status = 'offered'
    );
    if v_free <= 0 then
      return;
    end if;
  end if;

  return query
  with next_up as (
    select r.id
      from public.rsvps r
     where r.event_id = p_event_id and r.status = 'waitlisted'
     order by coalesce(r.joined_at, 'infinity'::timestamptz), r.id
     limit v_free
       for update
  )
  update public.rsvps r
     set status = 'offered',
         offer_expires_at = p_now + interval '24 hours',
         updated_at = now()
    from next_up
   where r.id = next_up.id
  returning r.user_id, r.offer_expires_at;
end $function$;

create or replace function public.admin_offer_spot(p_rsvp_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id bigint;
  v_rsvp public.rsvps%rowtype;
  v_event public.events%rowtype;
  v_free integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can offer spots';
  end if;

  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform 1 from public.events where id = v_event_id for update;
  select * into v_event from public.events where id = v_event_id;
  select * into v_rsvp from public.rsvps where id = p_rsvp_id for update;

  if not found or v_rsvp.status not in ('waitlisted', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_waitlisted');
  end if;
  if coalesce(v_event.status, 'scheduled') <> 'scheduled'
     or not coalesce(v_event.is_published, false) then
    return jsonb_build_object('ok', false, 'reason', 'event_unavailable');
  end if;

  if v_event.capacity is not null then
    v_free := v_event.capacity - coalesce(v_event.spots_taken, 0) - (
      select count(*) from public.rsvps where event_id = v_event_id and status = 'offered'
    );
    if v_free <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_capacity');
    end if;
  end if;

  update public.rsvps
     set status = 'offered',
         offer_expires_at = now() + interval '24 hours',
         updated_at = now()
   where id = p_rsvp_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'user_id', v_rsvp.user_id,
    'expires_at', now() + interval '24 hours'
  );
end $function$;

-- One-time correction of the counter itself. spots_taken is meant to equal
-- the number of 'confirmed' rsvps, but hand-made and older events drifted
-- (e.g. one event showed capacity 1, spots_taken 3, with a single confirmed
-- RSVP — from earlier forced walk-ups and the walk-up/waitlist bug fixed
-- above). Recomputes it for every event where it's wrong or NULL; safe to
-- re-run. Admin-forced walk-ups over capacity are still 'confirmed' rows, so
-- they stay counted.
update public.events e
   set spots_taken = c.n
  from (
    select ev.id, count(r.id) filter (where r.status = 'confirmed')::integer as n
      from public.events ev
      left join public.rsvps r on r.event_id = ev.id
     group by ev.id
  ) c
 where e.id = c.id
   and e.spots_taken is distinct from c.n;
