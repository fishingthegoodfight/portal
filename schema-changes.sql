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

-- =============================================================================
-- 2026-09-21 — Fly fishing sizing + liability waivers (per state, per year)
-- =============================================================================

-- ---- Fly fishing sizing (registration section "fly_fishing_sizing") ---------
-- Profile-backed like the other sections: asked once, then pre-filled. The
-- needs_* booleans are NULL until answered (that's how the form tells "not
-- answered yet" from "No"). boot_size / wader_size only apply when the
-- matching needs_* is true, and the app clears them when it flips to false.
-- Replaces the old free-text "sizing" section (profiles.sizing_notes stays in
-- place, untouched, just no longer collected).
alter table public.profiles
  add column if not exists fly_fishing_experience text
    check (fly_fishing_experience in ('None', 'Beginner', 'Intermediate', 'Advanced')),
  add column if not exists needs_boots boolean,
  add column if not exists boot_size text,
  add column if not exists needs_waders boolean,
  add column if not exists wader_size text
    check (wader_size in ('S', 'M', 'L', 'XL', 'XXL')),
  add column if not exists needs_rod_reel boolean;

-- Events that had the old "sizing" section now get the new one.
update public.events
   set registration_sections = array_replace(registration_sections, 'sizing', 'fly_fishing_sizing')
 where 'sizing' = any(registration_sections);

-- ---- Waivers ------------------------------------------------------------
create table public.waivers (
  id bigserial primary key,
  state text not null,              -- 'CO' or 'GA'
  year int not null,
  version int not null,
  title text not null,
  body_markdown text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (state, version)
);

create table public.waiver_signatures (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  waiver_id bigint not null references public.waivers(id),
  signed_name text not null,
  signed_at timestamptz not null default now(),
  unique (user_id, waiver_id)
);

-- "The active waiver" for a state + year is the highest-version row with
-- is_active = true. Adding a version never edits or deactivates an older row
-- (people have signed it) — the newer version simply supersedes it, and
-- everyone re-signs at their next RSVP.
create index waivers_state_year_idx
  on public.waivers (state, year, version desc)
  where is_active;

create index waiver_signatures_waiver_idx
  on public.waiver_signatures (waiver_id);

alter table public.waivers enable row level security;
alter table public.waiver_signatures enable row level security;

-- Anyone signed in can read active waivers; admins can also see inactive ones
-- and are the only ones who can add a version.
create policy waivers_read_active on public.waivers
  for select to authenticated
  using (is_active);

create policy waivers_admin_read_all on public.waivers
  for select to authenticated
  using (public.is_admin());

create policy waivers_admin_insert on public.waivers
  for insert to authenticated
  with check (public.is_admin());

-- A user reads and inserts only their own signatures; admins read all.
create policy waiver_signatures_read_own on public.waiver_signatures
  for select to authenticated
  using (user_id = auth.uid());

create policy waiver_signatures_admin_read_all on public.waiver_signatures
  for select to authenticated
  using (public.is_admin());

create policy waiver_signatures_insert_own on public.waiver_signatures
  for insert to authenticated
  with check (user_id = auth.uid() and length(btrim(signed_name)) > 0);

-- Immutability: no UPDATE or DELETE policies exist, and the privileges are
-- revoked too so a future permissive policy can't reopen it by accident.
-- (Deleting an auth user still cascades to their signatures, by design.)
revoke all on public.waivers, public.waiver_signatures from anon;
revoke update, delete, truncate on public.waivers, public.waiver_signatures from authenticated;
grant select, insert on public.waivers, public.waiver_signatures to authenticated;
grant usage, select on sequence public.waivers_id_seq, public.waiver_signatures_id_seq to authenticated;
grant all on public.waivers, public.waiver_signatures to service_role;
grant usage, select on sequence public.waivers_id_seq, public.waiver_signatures_id_seq to service_role;

-- ---- Which waiver an event uses ---------------------------------------------
-- 'CO' or 'GA', defaulted from the chapter and overridable on the event forms.
alter table public.events
  add column if not exists waiver_state text
    check (waiver_state in ('CO', 'GA'));

create or replace function public.default_event_waiver_state()
returns trigger
language plpgsql
as $function$
begin
  if new.waiver_state is null then
    new.waiver_state := case
      when new.chapter in ('Denver', 'CO Springs', 'Colorado Springs') then 'CO'
      when new.chapter in ('Atlanta', 'Rome') then 'GA'
    end;
  end if;
  return new;
end $function$;

create trigger events_default_waiver_state
  before insert or update on public.events
  for each row execute function public.default_event_waiver_state();

-- Backfill existing events (the trigger only covers writes from now on).
update public.events
   set waiver_state = case
     when chapter in ('Denver', 'CO Springs', 'Colorado Springs') then 'CO'
     when chapter in ('Atlanta', 'Rome') then 'GA'
   end
 where waiver_state is null;

-- =============================================================================
-- 2026-09-21 — Waiver state always follows the chapter; directory is not an event section
-- =============================================================================
-- Waiver state is no longer a per-event choice. The trigger now derives it
-- from the chapter on every insert and update (Denver, CO Springs → CO;
-- Atlanta, Rome → GA), overriding whatever was passed. A chapter it doesn't
-- recognise leaves the column as it was.
create or replace function public.default_event_waiver_state()
returns trigger
language plpgsql
as $function$
declare
  v_state text;
begin
  v_state := case
    when new.chapter in ('Denver', 'CO Springs', 'Colorado Springs') then 'CO'
    when new.chapter in ('Atlanta', 'Rome') then 'GA'
  end;
  if v_state is not null then
    new.waiver_state := v_state;
  end if;
  return new;
end $function$;

-- Correct any event where an earlier per-event override no longer matches.
update public.events
   set waiver_state = case
     when chapter in ('Denver', 'CO Springs', 'Colorado Springs') then 'CO'
     when chapter in ('Atlanta', 'Rome') then 'GA'
   end
 where chapter in ('Denver', 'CO Springs', 'Colorado Springs', 'Atlanta', 'Rome')
   and waiver_state is distinct from case
     when chapter in ('Denver', 'CO Springs', 'Colorado Springs') then 'CO'
     when chapter in ('Atlanta', 'Rome') then 'GA'
   end;

-- Participant directory opt-in is a standing preference on the profile and
-- sign-up flow (profiles.directory_opt_in, untouched), not something an event
-- asks for. Remove it from every event's registration_sections.
update public.events
   set registration_sections = array_remove(registration_sections, 'directory')
 where 'directory' = any(registration_sections);

-- =============================================================================
-- 2026-09-21 — Waiver is universal: every event requires it
-- =============================================================================
-- The waiver is no longer a per-event registration section (like the
-- emergency contact, it applies to every event), so remove the id from every
-- event's registration_sections.
update public.events
   set registration_sections = array_remove(registration_sections, 'waiver')
 where 'waiver' = any(registration_sections);

-- Since every event needs a waiver, waiver_state can never be blank. The
-- trigger from the previous entry fills it from the chapter on every write
-- (BEFORE triggers run ahead of NOT NULL checks), so this only rejects an
-- event whose chapter isn't one of Denver, CO Springs, Atlanta, Rome. If any
-- existing event is still NULL this stops first and names them — fix their
-- chapter (or set waiver_state by hand) and re-run.
do $$
declare
  v_ids text;
begin
  select string_agg(id::text, ', ' order by id)
    into v_ids
    from public.events
   where waiver_state is null;
  if v_ids is not null then
    raise exception 'events with no waiver_state (unrecognised chapter?): %', v_ids;
  end if;
end $$;

alter table public.events
  alter column waiver_state set not null;

-- =============================================================================
-- 2026-09-21 — Lowering capacity expires offers that no longer fit; update-my-registration
-- =============================================================================

-- When an admin lowers an event's capacity, open waitlist offers can end up
-- holding more spots than exist (spots_taken + open offers > capacity), and
-- those people would hit "spot no longer available" on Claim. This expires the
-- offers that no longer fit — the people who joined the waitlist LAST lose
-- theirs first, so earlier joiners keep theirs — and returns who was expired
-- so the app can send the usual "offer lapsed" email. Changes nothing when
-- everything still fits or the event is unlimited (capacity null).
-- Internal: service-role only, like offer_waitlisted_spots.
create or replace function public.expire_excess_offers(p_event_id bigint)
returns table (o_user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_room integer;
  v_offered integer;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into v_event from public.events where id = p_event_id;

  if not found or v_event.capacity is null then
    return;
  end if;

  v_room := greatest(v_event.capacity - coalesce(v_event.spots_taken, 0), 0);
  select count(*) into v_offered
    from public.rsvps
   where event_id = p_event_id and status = 'offered';

  if v_offered <= v_room then
    return;
  end if;

  return query
  with excess as (
    select r.id
      from public.rsvps r
     where r.event_id = p_event_id and r.status = 'offered'
     order by coalesce(r.joined_at, 'infinity'::timestamptz) desc, r.id desc
     limit v_offered - v_room
       for update
  )
  update public.rsvps r
     set status = 'expired', updated_at = now()
    from excess
   where r.id = excess.id
  returning r.user_id;
end $function$;

revoke all on function public.expire_excess_offers(bigint) from public, anon, authenticated;
grant execute on function public.expire_excess_offers(bigint) to service_role;

-- "Update my registration": saves a participant's answers to an RSVP they
-- already hold. Unlike rsvp_to_event it can never create a row or touch
-- capacity — if the caller has no active RSVP (say they cancelled in another
-- tab) it does nothing and returns NULL, instead of quietly re-registering
-- them. p_update_dietary says whether this event collects the dietary answer
-- (if not, the existing note is left alone). Returns their unchanged status.
create or replace function public.update_rsvp_answers(
  p_event_id bigint,
  p_dietary text default null,
  p_update_dietary boolean default false
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  update public.rsvps
     set dietary_notes = case when p_update_dietary then p_dietary else dietary_notes end,
         updated_at = now()
   where event_id = p_event_id
     and user_id = auth.uid()
     and status in ('confirmed', 'waitlisted', 'offered')
  returning status into v_status;

  return v_status;
end $function$;

-- =============================================================================
-- 2026-09-21 — Capacity-displaced offers go back on the waitlist, not "expired"
-- =============================================================================
-- Replaces the body of expire_excess_offers (name kept so existing callers
-- keep working). When an admin lowers capacity and an open offer no longer
-- fits, the person hasn't done anything wrong — the spot just doesn't exist —
-- so instead of marking the offer 'expired' (which drops them off the list)
-- it returns them to 'waitlisted' with their ORIGINAL joined_at, i.e. their
-- old place in line. Same choice of who: the latest joiners lose their offer
-- first. Still never offers a spot to anyone: with no room, the next person
-- in line stays waiting. Cron-lapsed offers are unchanged (still 'expired').
create or replace function public.expire_excess_offers(p_event_id bigint)
returns table (o_user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_room integer;
  v_offered integer;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into v_event from public.events where id = p_event_id;

  if not found or v_event.capacity is null then
    return;
  end if;

  v_room := greatest(v_event.capacity - coalesce(v_event.spots_taken, 0), 0);
  select count(*) into v_offered
    from public.rsvps
   where event_id = p_event_id and status = 'offered';

  if v_offered <= v_room then
    return;
  end if;

  return query
  with excess as (
    select r.id
      from public.rsvps r
     where r.event_id = p_event_id and r.status = 'offered'
     order by coalesce(r.joined_at, 'infinity'::timestamptz) desc, r.id desc
     limit v_offered - v_room
       for update
  )
  update public.rsvps r
     set status = 'waitlisted', offer_expires_at = null, updated_at = now()
    from excess
   where r.id = excess.id
  returning r.user_id;
end $function$;

-- =============================================================================
-- 2026-09-21 — Keep the roster's dietary note in sync with the profile answer
-- =============================================================================
-- rsvps.dietary_notes is a copy of the person's profiles.dietary_notes for
-- events that collect dietary (the roster and print sheet read the copy). The
-- copy used to be written only by the RSVP form, from the form's own state —
-- so if the profile changed elsewhere first (profile page, another event, an
-- earlier "Update my registration"), the form could write the OLD answer over
-- it and the roster showed a stale value. The app now sends the profile's
-- value, and this makes the copy correct by construction: whenever a profile's
-- dietary answer changes, every active RSVP of theirs for an upcoming,
-- scheduled event that collects dietary is updated to match. "No" / blank
-- become no note, same as the RSVP form.
create or replace function public.dietary_note_from_profile(p_value text)
returns text
language sql
immutable
as $function$
  select case
    when p_value is null or btrim(p_value) = '' or btrim(p_value) = 'None' then null
    else btrim(p_value)
  end;
$function$;

create or replace function public.sync_profile_dietary_to_rsvps()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.rsvps r
     set dietary_notes = public.dietary_note_from_profile(new.dietary_notes),
         updated_at = now()
    from public.events e
   where r.user_id = new.id
     and e.id = r.event_id
     and r.status in ('confirmed', 'waitlisted', 'offered')
     and 'dietary' = any(e.registration_sections)
     and e.status = 'scheduled'
     and e.starts_at > now()
     and r.dietary_notes is distinct from public.dietary_note_from_profile(new.dietary_notes);
  return new;
end $function$;

drop trigger if exists profiles_sync_dietary_to_rsvps on public.profiles;
create trigger profiles_sync_dietary_to_rsvps
  after update of dietary_notes on public.profiles
  for each row
  when (old.dietary_notes is distinct from new.dietary_notes)
  execute function public.sync_profile_dietary_to_rsvps();

-- One-time repair of copies that are already stale (same rule as the trigger).
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

-- =============================================================================
-- 2026-09-22 — Volunteer registry: role types, approvals, registration
-- =============================================================================
-- Builds the volunteer registry (volunteers, volunteer_role_types,
-- volunteer_role_approvals, volunteer_certifications), the invite +
-- registration flow, and the admin screens for all of it. Does NOT build
-- event volunteer signups (the existing volunteer_opportunities /
-- volunteer_signups tables are untouched beyond a new role_type_id column)
-- or the health history form (volunteers.health_history_outstanding is set
-- true at registration as a placeholder; the form itself is a future entry).
--
-- Design note on admin_notes: the brief calls for an `admin_notes` column on
-- `volunteers`, readable/writable only by admins with
-- profiles.can_view_volunteer_screening, "enforced in RLS, not just the UI".
-- Postgres RLS policies are row-scoped, not column-scoped — a SELECT policy
-- either returns a whole row or none of it, so a flag-gated column can't be
-- hidden from *some* admins on the same row via a table-level policy (and
-- Supabase's shared `authenticated` role rules out column GRANTs, which are
-- role-scoped, not per-user). admin_notes is therefore split into its own
-- one-row-per-volunteer table, `volunteer_screening_notes`, with its own RLS
-- policy gated on can_view_volunteer_screening() — the only way this is
-- actually enforced at the database layer rather than trusted to the UI.

-- ---- Waivers: participant vs. volunteer -------------------------------------
-- Existing rows default to 'participant' (unchanged behavior). The prior
-- unique (state, version) constraint is replaced with (state, audience,
-- version) so a state can have independent version sequences per audience —
-- e.g. CO participant v3 and CO volunteer v1 coexisting.
alter table public.waivers
  add column if not exists audience text not null default 'participant'
    check (audience in ('participant', 'volunteer'));

alter table public.waivers drop constraint if exists waivers_state_version_key;
alter table public.waivers
  add constraint waivers_state_audience_version_key unique (state, audience, version);

drop index if exists waivers_state_year_idx;
create index waivers_state_year_idx
  on public.waivers (state, audience, year, version desc)
  where is_active;

-- ---- Profile columns for the volunteer registration form --------------------
alter table public.profiles
  add column if not exists tshirt_size text,
  add column if not exists favorite_snack text,
  add column if not exists favorite_na_beverage text,
  add column if not exists skill_interests text[] not null default '{}'::text[],
  add column if not exists skill_interests_other text,
  add column if not exists program_interests text[] not null default '{}'::text[],
  add column if not exists can_view_volunteer_screening boolean not null default false;

-- Mirrors is_admin(): SECURITY DEFINER so RLS policies (below) can call it
-- from a `volunteer_screening_notes` policy without recursing into
-- `profiles` under RLS.
create or replace function public.can_view_volunteer_screening(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select can_view_volunteer_screening from public.profiles where id = p_user_id),
    false
  );
$function$;

-- ---- Role types ---------------------------------------------------------
create table public.volunteer_role_types (
  id bigserial primary key,
  key text not null unique,
  name text not null,
  description text,
  for_retreats boolean not null default false,
  for_chapter_events boolean not null default false,
  requires_cert boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.volunteer_role_types
  (key, name, for_retreats, for_chapter_events, requires_cert, sort_order)
values
  ('retreat_lead', 'Retreat Lead', true, false, true, 10),
  ('logistics_coordinator', 'Logistics Coordinator', true, false, true, 20),
  ('lead_fly_fishing_instructor', 'Lead Fly Fishing Instructor', true, false, true, 30),
  ('fishing_instructor', 'Fishing Instructor', true, true, false, 40),
  ('mens_night_lead', 'Men''s Night Lead', false, true, false, 50),
  ('fish_a_long_lead', 'Fish A-Long Lead', false, true, false, 60),
  ('fly_tying_lead', 'Fly Tying Lead', false, true, false, 70),
  ('community_engagement_event_lead', 'Community Engagement Event Lead', false, true, false, 80),
  ('other_chapter_program_lead', 'Other Chapter Program Lead', false, true, false, 90),
  ('program_community_engagement_support', 'Program/Community Engagement Support', false, true, false, 100)
on conflict (key) do nothing;

alter table public.volunteer_role_types enable row level security;

-- Reference data used by the event builder and the registry — readable and
-- writable by any admin (deactivating/reordering isn't screening-sensitive).
-- No DELETE policy or grant anywhere: the admin UI only ever offers
-- add/edit/reorder/deactivate, never delete, since a role type with
-- approvals or opportunities attached must never lose its row.
create policy volunteer_role_types_admin_all on public.volunteer_role_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.volunteer_role_types from anon;
grant select, insert, update on public.volunteer_role_types to authenticated;
grant usage, select on sequence public.volunteer_role_types_id_seq to authenticated;
grant all on public.volunteer_role_types to service_role;
grant usage, select on sequence public.volunteer_role_types_id_seq to service_role;

-- ---- Volunteers -----------------------------------------------------------
create table public.volunteers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'registered', 'approved', 'inactive', 'declined')),
  invited_at timestamptz,
  registered_at timestamptz,
  approved_at timestamptz,
  health_history_outstanding boolean not null default false,
  is_18_plus boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.volunteers enable row level security;

create policy volunteers_select_own on public.volunteers
  for select to authenticated
  using (user_id = auth.uid());

create policy volunteers_select_admin on public.volunteers
  for select to authenticated
  using (public.is_admin());

-- Deliberately NO "volunteer can update their own row" policy: status,
-- approved_at etc. carry meaning (an approval) that must never be settable
-- by a direct client UPDATE on an arbitrary column — RLS is row-scoped, so a
-- blanket "own row" UPDATE policy would let a volunteer PATCH their own
-- status straight to 'approved'. The registration form's own transition
-- (invited/registered -> registered) instead goes through the
-- SECURITY DEFINER function below, the same reasoning rsvp_to_event /
-- cancel_rsvp already apply to rsvps. Any admin can still update any row
-- directly (status changes, backfill) — that data isn't screening-sensitive.
create policy volunteers_update_admin on public.volunteers
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy volunteers_insert_admin on public.volunteers
  for insert to authenticated
  with check (public.is_admin());

revoke all on public.volunteers from anon;
grant select, insert, update on public.volunteers to authenticated;
grant all on public.volunteers to service_role;

-- The volunteer registration form's only write to `volunteers`: moves an
-- invited (or already-registered, for a resubmit) row to 'registered'.
-- Refuses if p_is_18_plus is false or the row isn't in a state that should
-- transition (e.g. 'approved', 'inactive', 'declined') — the caller's own
-- validation should never let either happen, this is the DB-enforced
-- backstop.
create or replace function public.complete_volunteer_registration(p_is_18_plus boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not p_is_18_plus then
    raise exception 'Must confirm 18 years of age or older';
  end if;

  update public.volunteers
     set status = 'registered',
         registered_at = coalesce(registered_at, now()),
         is_18_plus = true,
         health_history_outstanding = true,
         updated_at = now()
   where user_id = auth.uid()
     and status in ('invited', 'registered');

  if not found then
    raise exception 'No volunteer invitation found for this account';
  end if;
end $function$;

revoke all on function public.complete_volunteer_registration(boolean) from public, anon;
grant execute on function public.complete_volunteer_registration(boolean) to authenticated;

-- ---- Screening-only notes (see the design note at the top of this entry) ----
create table public.volunteer_screening_notes (
  volunteer_id uuid primary key references public.volunteers(user_id) on delete cascade,
  admin_notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.volunteer_screening_notes enable row level security;

create policy volunteer_screening_notes_admin on public.volunteer_screening_notes
  for all to authenticated
  using (public.is_admin() and public.can_view_volunteer_screening())
  with check (public.is_admin() and public.can_view_volunteer_screening());

revoke all on public.volunteer_screening_notes from anon;
grant select, insert, update on public.volunteer_screening_notes to authenticated;
grant all on public.volunteer_screening_notes to service_role;

-- ---- Role approvals -------------------------------------------------------
create table public.volunteer_role_approvals (
  id bigserial primary key,
  volunteer_id uuid not null references public.volunteers(user_id) on delete cascade,
  role_type_id bigint not null references public.volunteer_role_types(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz
);

-- At most one ACTIVE (unrevoked) approval per (volunteer, role type) — a
-- revoke-then-reapprove is a fresh row, which this partial index allows
-- since the earlier row's revoked_at is no longer null.
create unique index volunteer_role_approvals_active_idx
  on public.volunteer_role_approvals (volunteer_id, role_type_id)
  where revoked_at is null;

create index volunteer_role_approvals_volunteer_idx
  on public.volunteer_role_approvals (volunteer_id);

alter table public.volunteer_role_approvals enable row level security;

-- Admin-only both ways — revoking sets revoked_by/revoked_at (UPDATE), the
-- row itself is never deleted (no DELETE policy or grant).
create policy volunteer_role_approvals_admin_select on public.volunteer_role_approvals
  for select to authenticated
  using (public.is_admin());

create policy volunteer_role_approvals_admin_insert on public.volunteer_role_approvals
  for insert to authenticated
  with check (public.is_admin());

create policy volunteer_role_approvals_admin_update on public.volunteer_role_approvals
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.volunteer_role_approvals from anon;
grant select, insert, update on public.volunteer_role_approvals to authenticated;
grant usage, select on sequence public.volunteer_role_approvals_id_seq to authenticated;
grant all on public.volunteer_role_approvals to service_role;
grant usage, select on sequence public.volunteer_role_approvals_id_seq to service_role;

-- ---- Certifications -------------------------------------------------------
create table public.volunteer_certifications (
  id bigserial primary key,
  volunteer_id uuid not null references public.volunteers(user_id) on delete cascade,
  kind text not null default 'first_aid_cpr_aed',
  file_path text,
  issued_on date,
  expires_on date,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index volunteer_certifications_volunteer_idx
  on public.volunteer_certifications (volunteer_id);

alter table public.volunteer_certifications enable row level security;

create policy volunteer_certifications_select_own on public.volunteer_certifications
  for select to authenticated
  using (volunteer_id = auth.uid());

create policy volunteer_certifications_select_admin on public.volunteer_certifications
  for select to authenticated
  using (public.is_admin());

-- verified_by/verified_at must stay null on a volunteer's own insert — those
-- are only ever set by an admin (the separate admin policy below has no such
-- restriction), so a volunteer can never self-verify their own upload.
create policy volunteer_certifications_insert_own on public.volunteer_certifications
  for insert to authenticated
  with check (volunteer_id = auth.uid() and verified_by is null and verified_at is null);

create policy volunteer_certifications_insert_admin on public.volunteer_certifications
  for insert to authenticated
  with check (public.is_admin());

-- Own UPDATE lets a volunteer fix a typo before it's verified; admin UPDATE
-- is how verified_by/verified_at get set.
-- Same guard as the insert policy above: a volunteer's own update can never
-- leave verified_by/verified_at set (so they can't self-verify by editing an
-- existing row either); the admin policy below is the only path that sets them.
create policy volunteer_certifications_update_own on public.volunteer_certifications
  for update to authenticated
  using (volunteer_id = auth.uid())
  with check (volunteer_id = auth.uid() and verified_by is null and verified_at is null);

create policy volunteer_certifications_update_admin on public.volunteer_certifications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.volunteer_certifications from anon;
grant select, insert, update on public.volunteer_certifications to authenticated;
grant usage, select on sequence public.volunteer_certifications_id_seq to authenticated;
grant all on public.volunteer_certifications to service_role;
grant usage, select on sequence public.volunteer_certifications_id_seq to service_role;

-- Private bucket: a volunteer can upload/read only their own files (path
-- convention `${volunteer_id}/...`), admins can read all. No update/delete
-- policy — re-uploading is a new object/row, matching "optional at
-- registration" rather than an editable one.
insert into storage.buckets (id, name, public)
values ('volunteer-certifications', 'volunteer-certifications', false)
on conflict (id) do nothing;

create policy volunteer_certifications_storage_own_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'volunteer-certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy volunteer_certifications_storage_own_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'volunteer-certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy volunteer_certifications_storage_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'volunteer-certifications'
    and public.is_admin()
  );

-- ---- Event volunteer roles: link to a role type ------------------------
-- Nullable, and existing free-text rows are left alone — the event builder's
-- volunteer step now also offers picking a role type (filtered to
-- for_chapter_events + active), but a role can still be pure free text.
alter table public.volunteer_opportunities
  add column if not exists role_type_id bigint references public.volunteer_role_types(id);

-- =============================================================================
-- 2026-09-22 — Virtual events, no-local-chapter rename, event Zoom details,
-- Outreach -> Community Engagement rename
-- =============================================================================
-- Four small, independent changes bundled together since they touched the
-- same review pass:
--  - events.virtual_link / events.virtual_access_notes: per-event Zoom/
--    meeting details, shown on the event page only to someone with a
--    confirmed RSVP and included in the confirmation/reminder emails and the
--    .ics (see lib/email/ics.ts, lib/email/send.ts). Kept as plain columns
--    on `events` rather than a new table — see the comment on IcsEventInput
--    in lib/email/ics.ts for where a reusable per-event-type default would
--    plug in later without reworking this.
--  - The "Virtual" event chapter and "No local chapter" participant chapter
--    both resolve to the Colorado waiver by app-level default (the
--    deliberate-default comment on waiverStateForChapter in lib/waivers.ts
--    explains why) — the trigger below is the matching DB-level backstop for
--    a direct/bulk insert that skips the app.
--  - profiles.chapter's existing "not local to any chapter" sentinel is
--    renamed from 'Not local to a chapter' to 'No local chapter' (same
--    column, same concept — just a clearer label going forward).
--  - "Outreach Events" (a volunteer program-interest value) and any
--    'Outreach' events.event_type rows are renamed to their "Community
--    Engagement" equivalents, matching the event-type rename already in
--    lib/event-types.ts.

alter table public.events
  add column if not exists virtual_link text,
  add column if not exists virtual_access_notes text;

-- Matches waiverStateForChapter's deliberate CO default in lib/waivers.ts —
-- keep the two in sync if that default ever changes.
create or replace function public.default_event_waiver_state()
returns trigger
language plpgsql
as $function$
begin
  if new.waiver_state is null then
    new.waiver_state := case
      when new.chapter in ('Denver', 'CO Springs', 'Colorado Springs', 'Virtual') then 'CO'
      when new.chapter in ('Atlanta', 'Rome') then 'GA'
    end;
  end if;
  return new;
end $function$;

update public.profiles
  set chapter = 'No local chapter'
  where chapter = 'Not local to a chapter';

update public.events
  set event_type = 'Community Engagement'
  where event_type = 'Outreach';

update public.profiles
  set program_interests = array_replace(program_interests, 'Outreach Events', 'Community Engagement Events')
  where 'Outreach Events' = any(program_interests);

-- =============================================================================
-- 2026-09-22 — Event types as data, event templates, per-occurrence note
-- =============================================================================
-- Three independent additions:
--  - event_types replaces the hardcoded EVENT_TYPES list (lib/event-types.ts)
--    as the single source of truth for the "Event type" picker, with its own
--    admin screen (add/rename/reorder/deactivate) at /protected/admin/event-types.
--    events.event_type stays a plain text column, exactly like events.chapter
--    stays plain text against the hardcoded CHAPTERS list — no FK, so a type
--    that's later renamed or deactivated never breaks an event that already
--    used it. Deactivating only removes it from new events' picker (still
--    shown, unselectable-as-new, on an existing event that already has it);
--    there is deliberately no DELETE policy or grant on this table, mirroring
--    volunteer_role_types below it, so "a type in use can't be deleted" is
--    true by construction rather than a check the app has to enforce.
--  - event_templates / event_template_roles: a reusable starting point for
--    the create wizard (description, capacity, registration sections,
--    virtual details, and a set of volunteer roles with shift times stored
--    as minute offsets from the event's start, so they move with whatever
--    time is entered). Applying a template only ever copies values onto a
--    new event at creation time — there is no link stored back from events
--    to the template that seeded them, so editing or deactivating a template
--    can never change an event already created from it.
--  - events.occurrence_note: a short public note for one specific occurrence
--    (e.g. "Tonight we're tying a Pat's Rubber Legs"), distinct from the
--    existing custom_email_note (email-only, never shown on the site) and
--    never pre-filled by a template.

-- ---- Event types -----------------------------------------------------------
create table public.event_types (
  id bigserial primary key,
  key text not null unique,
  name text not null unique,
  default_registration_sections text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.event_types (key, name, default_registration_sections, sort_order)
values
  ('community_engagement', 'Community Engagement', '{}', 10),
  ('fly_tying', 'Fly Tying', '{}', 20),
  ('fish_a_long', 'Fish A-Long', '{fly_fishing_sizing}', 30),
  ('fly_fishing_education', 'Fly Fishing Education', '{}', 40),
  ('mens_night', 'Men''s Night', '{}', 50),
  ('virtual_mens_night', 'Virtual Men''s Night', '{}', 60),
  ('off_the_water', 'Off the Water', '{}', 70),
  ('social_event', 'Social Event', '{dietary}', 80),
  ('other', 'Other', '{}', 90)
on conflict (key) do nothing;

alter table public.event_types enable row level security;

create policy event_types_admin_all on public.event_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.event_types from anon;
grant select, insert, update on public.event_types to authenticated;
grant usage, select on sequence public.event_types_id_seq to authenticated;
grant all on public.event_types to service_role;
grant usage, select on sequence public.event_types_id_seq to service_role;

-- ---- Event templates --------------------------------------------------------
create table public.event_templates (
  id bigserial primary key,
  name text not null,
  -- Free text, matching events.event_type — not an FK, same reasoning as
  -- event_types above (a renamed/deactivated type never breaks a template
  -- that referenced it; applying it just carries the text over).
  event_type text not null,
  -- Null = available to every chapter's create wizard; set = only shown when
  -- that chapter is selected.
  chapter text,
  description text,
  default_capacity integer,
  default_registration_sections text[] not null default '{}'::text[],
  default_virtual_link text,
  default_virtual_access_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.event_templates enable row level security;

create policy event_templates_admin_all on public.event_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.event_templates from anon;
grant select, insert, update on public.event_templates to authenticated;
grant usage, select on sequence public.event_templates_id_seq to authenticated;
grant all on public.event_templates to service_role;
grant usage, select on sequence public.event_templates_id_seq to service_role;

create table public.event_template_roles (
  id bigserial primary key,
  template_id bigint not null references public.event_templates(id) on delete cascade,
  -- The title comes from the catalog (role_type_id); description and
  -- what_to_bring are the parts that are standard per PROGRAM rather than
  -- per role type (e.g. what to bring to a Fly Tying Night applies to every
  -- role at it, not to "Fly Tying Lead" as a role type in general), so they
  -- live on the template role, not on volunteer_role_types.
  role_type_id bigint not null references public.volunteer_role_types(id),
  description text,
  what_to_bring text,
  -- Minutes relative to the event's start (can be negative, e.g. a setup
  -- role starting 60 minutes before the event itself) — applying the
  -- template computes actual HH:MM shift times from these once the create
  -- wizard has a date and time to apply them to.
  shift_start_offset integer not null,
  shift_end_offset integer not null,
  number_needed integer not null default 1,
  sort_order integer not null default 0
);

create index event_template_roles_template_idx on public.event_template_roles (template_id);

alter table public.event_template_roles enable row level security;

create policy event_template_roles_admin_all on public.event_template_roles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.event_template_roles from anon;
grant select, insert, update, delete on public.event_template_roles to authenticated;
grant usage, select on sequence public.event_template_roles_id_seq to authenticated;
grant all on public.event_template_roles to service_role;
grant usage, select on sequence public.event_template_roles_id_seq to service_role;

-- ---- Per-occurrence note -----------------------------------------------------
alter table public.events
  add column if not exists occurrence_note text;

-- =============================================================================
-- 2026-09-22 — Template role shift times: independent start/end anchors
-- =============================================================================
-- event_template_roles.shift_start_offset / shift_end_offset (see the
-- "event templates" entry above) were both minutes relative to the event's
-- START, which made an end-of-event role (e.g. cleanup) drift whenever the
-- event's own length changed. Each boundary now anchors independently to
-- either the event's start or its end:
--   shift_start_anchor / shift_end_anchor: 'event_start' | 'event_end'
-- defaulting to start-anchored/end-anchored respectively — setup begins
-- before doors (event_start), cleanup ends after the event (event_end),
-- which is the common case. The offset columns are unchanged in shape, just
-- now read relative to their own anchor instead of always the start.
--
-- No real template rows exist yet (confirmed with the user before writing
-- this), so there's no value-preserving conversion to do — the reset below
-- is defensive only, in case a row was created between then and now.

alter table public.event_template_roles
  add column if not exists shift_start_anchor text not null default 'event_start'
    check (shift_start_anchor in ('event_start', 'event_end')),
  add column if not exists shift_end_anchor text not null default 'event_end'
    check (shift_end_anchor in ('event_start', 'event_end'));

update public.event_template_roles
  set shift_end_offset = 0
  where shift_end_anchor = 'event_end';

-- =============================================================================
-- 2026-09-22 — Volunteer signups for events
-- =============================================================================
-- volunteer_signups was one of the 5 Phase 0 tables, but had 0 rows and a
-- shape ('pending' status, notes, no cancelled_at/checked_in_at) nothing in
-- the app ever wrote to — confirmed empty before dropping and recreating it
-- to the shape this feature actually needs. volunteer_opportunities has real
-- rows, so it's altered in place, not recreated; capacity uses its existing
-- slots / slots_taken columns (not a new "number needed" column), following
-- the exact same atomic claim pattern as try_claim_event_spot for RSVPs.
--
-- No volunteer waitlist or shift swaps yet — a full shift is just "full",
-- same message either way, no queue.
--
-- Eligibility (volunteers.status = 'approved', an active
-- volunteer_role_approvals row for the role's role_type_id — or, for a
-- role_type_id-less "Custom / other" opportunity, any approved volunteer —
-- and a signed volunteer waiver for the EVENT's state/year) is enforced in
-- the server action layer (lib/actions/volunteer-signup.ts), the same way
-- the RSVP waiver check already is — see confirmRsvpAction in
-- lib/actions/rsvp.ts. The RPCs below only own the atomic capacity claim,
-- same division of responsibility as rsvp_to_event / try_claim_event_spot.
--
-- volunteer_opportunities.is_published is never set true by any code path
-- (confirmed unused before writing this) — deliberately NOT gated on here,
-- same as the rest of the app already treats it.

drop table if exists public.volunteer_signups;

create table public.volunteer_signups (
  id bigserial primary key,
  opportunity_id bigint not null references public.volunteer_opportunities(id) on delete cascade,
  -- References profiles(id), not auth.users(id) — matches the rest of the
  -- volunteer registry (volunteers.user_id, volunteer_role_approvals.volunteer_id).
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  signed_up_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  -- Reminder dedup, same purpose as rsvps.sent_1week_at/sent_1day_at — a
  -- volunteer reminder rides the same cron pass and event-level day-out
  -- window as the participant one, just with the shift's own content.
  sent_1week_at timestamptz,
  sent_1day_at timestamptz,
  unique (opportunity_id, user_id)
);

create index volunteer_signups_opportunity_idx on public.volunteer_signups (opportunity_id);
create index volunteer_signups_user_idx on public.volunteer_signups (user_id);

alter table public.volunteer_signups enable row level security;

create policy volunteer_signups_select_own on public.volunteer_signups
  for select to authenticated
  using (user_id = auth.uid());

create policy volunteer_signups_select_admin on public.volunteer_signups
  for select to authenticated
  using (public.is_admin());

-- Lets the check-in toggle update checked_in_at directly from the browser
-- client, same instant-feeling pattern as admin_update_rsvps.
create policy volunteer_signups_update_admin on public.volunteer_signups
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.volunteer_signups from anon;
grant select, update on public.volunteer_signups to authenticated;
grant usage, select on sequence public.volunteer_signups_id_seq to authenticated;
grant all on public.volunteer_signups to service_role;
grant usage, select on sequence public.volunteer_signups_id_seq to service_role;

-- Atomic capacity claim on volunteer_opportunities.slots_taken — same shape
-- as try_claim_event_spot on events.spots_taken. Internal only (called from
-- the two functions below, not directly by the client).
create or replace function public.try_claim_volunteer_slot(p_opportunity_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.volunteer_opportunities vo
     set slots_taken = vo.slots_taken + 1
    from public.events e
   where vo.id = p_opportunity_id
     and vo.event_id = e.id
     and coalesce(e.is_published, false)
     and coalesce(e.status, 'scheduled') = 'scheduled'
     and vo.slots_taken < vo.slots;
  return found;
end $function$;

revoke all on function public.try_claim_volunteer_slot(bigint) from public, anon, authenticated;
grant execute on function public.try_claim_volunteer_slot(bigint) to service_role;

-- The "Sign up" button on the event page. Eligibility is already checked by
-- the caller (see lib/actions/volunteer-signup.ts) — this only owns the
-- atomic capacity claim and the upsert, same shape as rsvp_to_event.
-- Re-signing up after cancelling reclaims a slot and clears checked_in_at
-- (a fresh signup, not still checked in from before).
create or replace function public.sign_up_for_volunteer_shift(p_opportunity_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select status into v_existing_status
    from public.volunteer_signups
   where opportunity_id = p_opportunity_id and user_id = v_uid;

  if v_existing_status = 'confirmed' then
    return 'confirmed';
  end if;

  if not public.try_claim_volunteer_slot(p_opportunity_id) then
    return 'full';
  end if;

  insert into public.volunteer_signups (opportunity_id, user_id, status, signed_up_at, cancelled_at, checked_in_at)
  values (p_opportunity_id, v_uid, 'confirmed', now(), null, null)
  on conflict (opportunity_id, user_id)
  do update set status = 'confirmed',
                signed_up_at = now(),
                cancelled_at = null,
                checked_in_at = null;

  return 'confirmed';
end $function$;

revoke all on function public.sign_up_for_volunteer_shift(bigint) from public, anon;
grant execute on function public.sign_up_for_volunteer_shift(bigint) to authenticated;

-- The "Cancel" button — frees the slot back. Returns 'cancelled' or
-- 'not_signed_up' (nothing to cancel, e.g. a double-click).
create or replace function public.cancel_volunteer_signup(p_opportunity_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select status into v_status
    from public.volunteer_signups
   where opportunity_id = p_opportunity_id and user_id = v_uid;

  if v_status is distinct from 'confirmed' then
    return 'not_signed_up';
  end if;

  update public.volunteer_signups
     set status = 'cancelled', cancelled_at = now()
   where opportunity_id = p_opportunity_id and user_id = v_uid;

  update public.volunteer_opportunities
     set slots_taken = greatest(slots_taken - 1, 0)
   where id = p_opportunity_id;

  return 'cancelled';
end $function$;

revoke all on function public.cancel_volunteer_signup(bigint) from public, anon;
grant execute on function public.cancel_volunteer_signup(bigint) to authenticated;

-- Admin "add a volunteer" (the walk-up equivalent) — approval eligibility is
-- checked by the caller, same as the participant path; p_force overrides
-- capacity only (mirrors admin_upsert_walkup_rsvp's p_force), returning
-- 'capacity_exceeded' without writing anything until the admin confirms.
create or replace function public.admin_add_volunteer_signup(
  p_opportunity_id bigint,
  p_user_id uuid,
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
    raise exception 'Only admins can add a volunteer signup';
  end if;

  select status into v_existing_status
    from public.volunteer_signups
   where opportunity_id = p_opportunity_id and user_id = p_user_id;

  if v_existing_status = 'confirmed' then
    return 'confirmed';
  end if;

  v_claimed := public.try_claim_volunteer_slot(p_opportunity_id);

  if not v_claimed and not p_force then
    return 'capacity_exceeded';
  end if;

  if not v_claimed and p_force then
    update public.volunteer_opportunities
       set slots_taken = slots_taken + 1
     where id = p_opportunity_id;
  end if;

  insert into public.volunteer_signups (opportunity_id, user_id, status, signed_up_at, cancelled_at, checked_in_at)
  values (p_opportunity_id, p_user_id, 'confirmed', now(), null, null)
  on conflict (opportunity_id, user_id)
  do update set status = 'confirmed',
                signed_up_at = now(),
                cancelled_at = null,
                checked_in_at = null;

  return 'confirmed';
end $function$;

revoke all on function public.admin_add_volunteer_signup(bigint, uuid, boolean) from public, anon;
grant execute on function public.admin_add_volunteer_signup(bigint, uuid, boolean) to authenticated;

-- =============================================================================
-- 2026-09-22 — Volunteers can read their own role approvals (+ role types,
-- + opportunities for published events / their own shifts)
-- =============================================================================
-- volunteer_role_approvals and volunteer_role_types were admin-only for
-- SELECT, so every volunteer-facing read of them through the user's own
-- (RLS-bound) client came back empty: the /protected/volunteer "Approved
-- roles" card, the event page's eligible-roles filter (approvedRoleTypeIds),
-- and — because eligibility is checked in the server action with that same
-- client, not inside the SECURITY DEFINER RPC — the signup action itself,
-- which rejected every role-typed shift with "not approved for this role".
--
-- Additive SELECT policies only; the admin policies are unchanged and still
-- the only INSERT/UPDATE path. No recursion: the role-types policy reads
-- volunteer_role_approvals, whose policies never read volunteer_role_types.

create policy volunteer_role_approvals_select_own on public.volunteer_role_approvals
  for select to authenticated
  using (volunteer_id = auth.uid());

-- Only the role types this volunteer holds (or held) an approval for — the
-- rest of the catalog stays admin-only.
create policy volunteer_role_types_select_own_approved on public.volunteer_role_types
  for select to authenticated
  using (
    exists (
      select 1 from public.volunteer_role_approvals a
       where a.role_type_id = volunteer_role_types.id
         and a.volunteer_id = auth.uid()
    )
  );

-- volunteer_opportunities' only SELECT policy added after Phase 0 is
-- admin_select_volunteer_opportunities; the Phase 0 one isn't in this log.
-- The event page's Volunteer section, the signup/cancel actions, and the
-- volunteer home page's "Your shifts" join all read this table with the
-- user's client. Any signed-in user may see the roles on a published event
-- (the event page shows them the section either way), and a volunteer can
-- always see an opportunity they've signed up for, even after its event is
-- unpublished. Permissive, so harmless if Phase 0 already allows this.
create policy volunteer_opportunities_select_published_or_own on public.volunteer_opportunities
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
       where e.id = volunteer_opportunities.event_id
         and coalesce(e.is_published, false)
    )
    or exists (
      select 1 from public.volunteer_signups s
       where s.opportunity_id = volunteer_opportunities.id
         and s.user_id = auth.uid()
    )
  );

-- =============================================================================
-- 2026-09-22 — Editable volunteer roles, cancelled roles, series trimming
-- =============================================================================
-- 1. Volunteer roles are now editable after an event is created (admin event
--    edit form). Until now volunteer_opportunities only had admin INSERT and
--    SELECT policies — editing a role's text/shift/slots is a plain admin
--    UPDATE, so it gets the same is_admin() policy as events. Deleting and
--    cancelling a role go through the SECURITY DEFINER functions below
--    instead, so the "no signups" check and the write can't race a signup.
--
-- 2. A role with signups is never deleted — it's CANCELLED: cancelled_at is
--    set, its confirmed signups move to 'cancelled' (row kept, like a
--    volunteer's own cancel), and slots_taken drops to 0. A cancelled role
--    stays on the event for history but is hidden from signup, the roster,
--    and reminders, and try_claim_volunteer_slot refuses it.
--
-- 3. Deleting events (series trimming): only occurrences nobody is on. "On"
--    means an ACTIVE rsvp (confirmed / waitlisted / offered) or a confirmed
--    volunteer signup. Inactive history rows (cancelled/expired RSVPs,
--    cancelled volunteer signups) go with the event — there's nothing left
--    for them to point at. Anything with people goes through Cancel instead.

alter table public.volunteer_opportunities
  add column if not exists cancelled_at timestamptz;

create policy admin_update_volunteer_opportunities on public.volunteer_opportunities
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update on public.volunteer_opportunities to authenticated;

-- Same as the 2026-09-22 version plus "and vo.cancelled_at is null".
create or replace function public.try_claim_volunteer_slot(p_opportunity_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.volunteer_opportunities vo
     set slots_taken = vo.slots_taken + 1
    from public.events e
   where vo.id = p_opportunity_id
     and vo.event_id = e.id
     and vo.cancelled_at is null
     and coalesce(e.is_published, false)
     and coalesce(e.status, 'scheduled') = 'scheduled'
     and vo.slots_taken < vo.slots;
  return found;
end $function$;

revoke all on function public.try_claim_volunteer_slot(bigint) from public, anon, authenticated;
grant execute on function public.try_claim_volunteer_slot(bigint) to service_role;

-- Deletes a role only if nobody is signed up. The row lock serializes this
-- against a concurrent sign_up_for_volunteer_shift (which updates the same
-- row via try_claim_volunteer_slot). Returns 'deleted', 'has_signups', or
-- 'not_found'. Cancelled signup rows go with it (on delete cascade).
create or replace function public.admin_delete_volunteer_opportunity(p_opportunity_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete a volunteer role';
  end if;

  perform 1 from public.volunteer_opportunities where id = p_opportunity_id for update;
  if not found then
    return 'not_found';
  end if;

  if exists (
    select 1 from public.volunteer_signups
     where opportunity_id = p_opportunity_id and status = 'confirmed'
  ) then
    return 'has_signups';
  end if;

  delete from public.volunteer_opportunities where id = p_opportunity_id;
  return 'deleted';
end $function$;

revoke all on function public.admin_delete_volunteer_opportunity(bigint) from public, anon;
grant execute on function public.admin_delete_volunteer_opportunity(bigint) to authenticated;

-- Cancels a role: every confirmed signup -> 'cancelled', slots_taken -> 0,
-- cancelled_at set. Returns the user_ids whose signup it cancelled, so the
-- caller can email exactly those people. Idempotent: an already-cancelled
-- role returns no rows.
create or replace function public.admin_cancel_volunteer_opportunity(p_opportunity_id bigint)
returns table (user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Only admins can cancel a volunteer role';
  end if;

  perform 1 from public.volunteer_opportunities
   where id = p_opportunity_id and cancelled_at is null
   for update;
  if not found then
    return;
  end if;

  return query
    with cancelled as (
      update public.volunteer_signups s
         set status = 'cancelled', cancelled_at = now()
       where s.opportunity_id = p_opportunity_id and s.status = 'confirmed'
      returning s.user_id as cancelled_user_id
    )
    select c.cancelled_user_id from cancelled c;

  update public.volunteer_opportunities
     set cancelled_at = now(), slots_taken = 0
   where id = p_opportunity_id;
end $function$;

revoke all on function public.admin_cancel_volunteer_opportunity(bigint) from public, anon;
grant execute on function public.admin_cancel_volunteer_opportunity(bigint) to authenticated;

-- Deletes whichever of p_event_ids nobody is on (see 3. above) and returns
-- the ids it actually deleted; any with people are skipped, not errored, so
-- "delete all future empty occurrences" can pass the whole candidate list.
-- Locks each event row first so an RSVP arriving mid-delete (rsvp_to_event
-- updates events.spots_taken) waits and then fails on the missing row
-- rather than being silently deleted with it.
create or replace function public.admin_delete_empty_events(p_event_ids bigint[])
returns setof bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete events';
  end if;

  for v_id in
    select id from public.events where id = any(p_event_ids) order by id for update
  loop
    if exists (
      select 1 from public.rsvps
       where event_id = v_id and status in ('confirmed', 'waitlisted', 'offered')
    ) or exists (
      select 1 from public.volunteer_signups s
        join public.volunteer_opportunities vo on vo.id = s.opportunity_id
       where vo.event_id = v_id and s.status = 'confirmed'
    ) then
      continue;
    end if;

    delete from public.rsvps where event_id = v_id;
    delete from public.volunteer_opportunities where event_id = v_id;
    delete from public.events where id = v_id;
    return next v_id;
  end loop;
end $function$;

revoke all on function public.admin_delete_empty_events(bigint[]) from public, anon;
grant execute on function public.admin_delete_empty_events(bigint[]) to authenticated;

-- =============================================================================
-- 2026-09-23 — Volunteer signup gates in the database; attend OR volunteer,
-- never both; one-step switching between the two
-- =============================================================================
-- 1. sign_up_for_volunteer_shift is granted to every signed-in user and, until
--    now, trusted its caller to have checked eligibility (approved volunteer,
--    approved for the role, signed volunteer waiver for the event's state and
--    year). The app always did, but calling the RPC directly skipped all
--    three. It now checks them itself via volunteer_signup_blocker, a SQL
--    mirror of checkVolunteerSignupEligibility (lib/volunteer-signups.ts) —
--    keep the two in sync. The server action still checks first, for the
--    friendly messages and the inline waiver step.
--
-- 2. A person is either a participant or a volunteer at an event, not both.
--    "Participant" = an ACTIVE rsvp (confirmed / waitlisted / offered);
--    "volunteer" = a confirmed volunteer_signups row on any of the event's
--    roles. rsvp_to_event returns 'is_volunteer' and
--    sign_up_for_volunteer_shift returns 'has_rsvp' instead of writing. Both
--    lock the event row first (same lock order as everything else: events,
--    then rsvps / volunteer_opportunities), so two tabs can't slip past each
--    other's check. Admin paths (walk-up, "Add volunteer") are NOT blocked —
--    the app warns and the admin decides.
--
-- 3. switch_rsvp_to_volunteer / switch_volunteer_to_rsvp do the cancel and
--    the new signup in one transaction, in that order. If the target is full
--    (the shift has no slot / the event would only waitlist them) the whole
--    switch is rolled back and 'full' is returned — nobody loses what they
--    had. Cancelling an RSVP goes through cancel_rsvp, so a freed spot is
--    offered to the waitlist exactly as a normal cancellation would.
--
-- Existing rows aren't touched: anyone already both an attendee and a
-- volunteer at an event stays that way. To find them:
--
--   select r.event_id, r.user_id, r.status as rsvp_status, vo.role
--     from public.rsvps r
--     join public.volunteer_opportunities vo on vo.event_id = r.event_id
--     join public.volunteer_signups s
--       on s.opportunity_id = vo.id and s.user_id = r.user_id and s.status = 'confirmed'
--    where r.status in ('confirmed', 'waitlisted', 'offered');

-- Why this person can't sign up for this shift, or null if they can.
-- Internal (called by the functions below, not by the client).
create or replace function public.volunteer_signup_blocker(p_user_id uuid, p_opportunity_id bigint)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role_type_id bigint;
  v_state text;
  v_year int;
  v_waiver_id bigint;
begin
  if not exists (
    select 1 from public.volunteers where user_id = p_user_id and status = 'approved'
  ) then
    return 'not_approved';
  end if;

  -- Waiver state: events.waiver_state, falling back to the chapter's state
  -- like waiverStateForEvent (same mapping as default_event_waiver_state).
  -- Year: the event's calendar year in its own timezone, like eventYear.
  select vo.role_type_id,
         coalesce(
           e.waiver_state,
           case
             when e.chapter in ('Denver', 'CO Springs', 'Colorado Springs', 'Virtual') then 'CO'
             when e.chapter in ('Atlanta', 'Rome') then 'GA'
           end
         ),
         extract(year from (e.starts_at at time zone e.timezone))::int
    into v_role_type_id, v_state, v_year
    from public.volunteer_opportunities vo
    join public.events e on e.id = vo.event_id
   where vo.id = p_opportunity_id;

  if not found then
    return 'not_found';
  end if;

  -- A role with no role_type_id ("Custom / other") is open to any approved
  -- volunteer, same as isRoleEligible.
  if v_role_type_id is not null and not exists (
    select 1 from public.volunteer_role_approvals
     where volunteer_id = p_user_id
       and role_type_id = v_role_type_id
       and revoked_at is null
  ) then
    return 'role_not_approved';
  end if;

  select id into v_waiver_id
    from public.waivers
   where state = v_state
     and year = v_year
     and audience = 'volunteer'
     and is_active
   order by version desc
   limit 1;

  if v_waiver_id is null or not exists (
    select 1 from public.waiver_signatures
     where user_id = p_user_id and waiver_id = v_waiver_id
  ) then
    return 'waiver_unsigned';
  end if;

  return null;
end $function$;

revoke all on function public.volunteer_signup_blocker(uuid, bigint) from public, anon, authenticated;
grant execute on function public.volunteer_signup_blocker(uuid, bigint) to service_role;

-- Same as the 2026-09-22 version plus: the eligibility gate (returns the
-- volunteer_signup_blocker code), and 'has_rsvp' when the caller is
-- registered to attend this event. Returns 'confirmed', 'full', 'has_rsvp',
-- 'not_found', 'not_approved', 'role_not_approved' or 'waiver_unsigned'.
create or replace function public.sign_up_for_volunteer_shift(p_opportunity_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event_id bigint;
  v_existing_status text;
  v_blocker text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select event_id into v_event_id
    from public.volunteer_opportunities
   where id = p_opportunity_id;
  if not found then
    return 'not_found';
  end if;

  perform 1 from public.events where id = v_event_id for update;

  select status into v_existing_status
    from public.volunteer_signups
   where opportunity_id = p_opportunity_id and user_id = v_uid;

  if v_existing_status = 'confirmed' then
    return 'confirmed';
  end if;

  v_blocker := public.volunteer_signup_blocker(v_uid, p_opportunity_id);
  if v_blocker is not null then
    return v_blocker;
  end if;

  if exists (
    select 1 from public.rsvps
     where event_id = v_event_id
       and user_id = v_uid
       and status in ('confirmed', 'waitlisted', 'offered')
  ) then
    return 'has_rsvp';
  end if;

  if not public.try_claim_volunteer_slot(p_opportunity_id) then
    return 'full';
  end if;

  insert into public.volunteer_signups (opportunity_id, user_id, status, signed_up_at, cancelled_at, checked_in_at)
  values (p_opportunity_id, v_uid, 'confirmed', now(), null, null)
  on conflict (opportunity_id, user_id)
  do update set status = 'confirmed',
                signed_up_at = now(),
                cancelled_at = null,
                checked_in_at = null;

  return 'confirmed';
end $function$;

revoke all on function public.sign_up_for_volunteer_shift(bigint) from public, anon;
grant execute on function public.sign_up_for_volunteer_shift(bigint) to authenticated;

-- Same as the 2026-09-21 (waitlist) version plus: locks the event row up front, and
-- returns 'is_volunteer' (writing nothing) when the caller has a confirmed
-- volunteer shift at this event and no RSVP yet. Someone who already holds
-- an RSVP can still update its notes, as before.
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
  perform 1 from public.events where id = p_event_id for update;

  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = auth.uid();

  if v_existing_status in ('confirmed', 'waitlisted', 'offered') then
    update public.rsvps
       set dietary_notes = p_dietary, updated_at = now()
     where event_id = p_event_id and user_id = auth.uid();
    return v_existing_status;
  end if;

  if exists (
    select 1
      from public.volunteer_signups s
      join public.volunteer_opportunities vo on vo.id = s.opportunity_id
     where vo.event_id = p_event_id
       and s.user_id = auth.uid()
       and s.status = 'confirmed'
  ) then
    return 'is_volunteer';
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

-- "Switch to volunteering": cancels the caller's RSVP at the shift's event
-- (through cancel_rsvp, so the freed spot is offered to the waitlist), then
-- signs them up for the shift. Returns jsonb:
--   { status, previous_status, offered: [{ user_id, expires_at }] }
-- status is 'confirmed', or 'full' (shift had no slot — nothing changed), or
-- a volunteer_signup_blocker code (nothing changed). previous_status is the
-- RSVP status that was cancelled, or null if there was none.
create or replace function public.switch_rsvp_to_volunteer(p_opportunity_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_event_id bigint;
  v_blocker text;
  v_cancel jsonb := jsonb_build_object('previous_status', null, 'offered', '[]'::jsonb);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select event_id into v_event_id
    from public.volunteer_opportunities
   where id = p_opportunity_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform 1 from public.events where id = v_event_id for update;

  v_blocker := public.volunteer_signup_blocker(v_uid, p_opportunity_id);
  if v_blocker is not null then
    return jsonb_build_object('status', v_blocker);
  end if;

  -- An exception raised inside this block rolls back everything done in it
  -- (the RSVP cancel and any waitlist offers it made) before the handler runs.
  begin
    if exists (
      select 1 from public.rsvps
       where event_id = v_event_id
         and user_id = v_uid
         and status in ('confirmed', 'waitlisted', 'offered')
    ) then
      v_cancel := public.cancel_rsvp(v_event_id);
    end if;

    if not exists (
      select 1 from public.volunteer_signups
       where opportunity_id = p_opportunity_id and user_id = v_uid and status = 'confirmed'
    ) then
      if not public.try_claim_volunteer_slot(p_opportunity_id) then
        raise exception 'shift full' using errcode = 'FTGF1';
      end if;

      insert into public.volunteer_signups (opportunity_id, user_id, status, signed_up_at, cancelled_at, checked_in_at)
      values (p_opportunity_id, v_uid, 'confirmed', now(), null, null)
      on conflict (opportunity_id, user_id)
      do update set status = 'confirmed',
                    signed_up_at = now(),
                    cancelled_at = null,
                    checked_in_at = null;
    end if;
  exception when sqlstate 'FTGF1' then
    return jsonb_build_object('status', 'full');
  end;

  return jsonb_build_object(
    'status', 'confirmed',
    'previous_status', v_cancel->'previous_status',
    'offered', v_cancel->'offered'
  );
end $function$;

revoke all on function public.switch_rsvp_to_volunteer(bigint) from public, anon;
grant execute on function public.switch_rsvp_to_volunteer(bigint) to authenticated;

-- "Switch to attending": cancels every confirmed volunteer shift the caller
-- has at this event (freeing each slot), then RSVPs them through
-- rsvp_to_event. Only a CONFIRMED spot counts as a switch — if the event
-- would only waitlist them, everything is rolled back and 'full' returned,
-- so nobody gives up a shift for a place in line. Returns jsonb:
--   { status: 'confirmed' | 'full', cancelled_opportunity_ids: [bigint] }
-- The participant waiver is checked by the caller, same as rsvp_to_event.
create or replace function public.switch_volunteer_to_rsvp(p_event_id bigint, p_dietary text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cancelled bigint[] := '{}';
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform 1 from public.events where id = p_event_id for update;

  begin
    with cancelled as (
      update public.volunteer_signups s
         set status = 'cancelled', cancelled_at = now()
        from public.volunteer_opportunities vo
       where vo.id = s.opportunity_id
         and vo.event_id = p_event_id
         and s.user_id = v_uid
         and s.status = 'confirmed'
      returning s.opportunity_id
    )
    select coalesce(array_agg(opportunity_id), '{}') into v_cancelled from cancelled;

    update public.volunteer_opportunities
       set slots_taken = greatest(slots_taken - 1, 0)
     where id = any(v_cancelled);

    v_status := public.rsvp_to_event(p_event_id, p_dietary);
    if v_status is distinct from 'confirmed' then
      raise exception 'event full' using errcode = 'FTGF1';
    end if;
  exception when sqlstate 'FTGF1' then
    return jsonb_build_object('status', 'full', 'cancelled_opportunity_ids', '[]'::jsonb);
  end;

  return jsonb_build_object('status', v_status, 'cancelled_opportunity_ids', to_jsonb(v_cancelled));
end $function$;

revoke all on function public.switch_volunteer_to_rsvp(bigint, text) from public, anon;
grant execute on function public.switch_volunteer_to_rsvp(bigint, text) to authenticated;

-- =============================================================================
-- 2026-09-23 — Every user-callable function checks its own preconditions
-- =============================================================================
-- An audit of every SECURITY DEFINER function, following the volunteer
-- signup fix above: which ones trusted the app to have checked something
-- before calling them? (Supabase grants EXECUTE on new public functions to
-- anon and authenticated by default, so anything not explicitly revoked can
-- be called straight from the browser with the public key — no app code in
-- between, and for anon, no login either.)
--
-- Trusting the caller, fixed here:
--   * try_claim_event_spot — an internal helper, never revoked: ANYONE, even
--     logged out, could call it repeatedly to push an event's spots_taken up
--     to capacity and waitlist every real RSVP. Now internal-only.
--   * rsvp_to_event — trusted the app for the participant waiver (state +
--     year), the event being published and scheduled (an unpublished or
--     cancelled event got a 'waitlisted' row), required registration
--     sections, and a signed-in caller. It now checks all of them.
--   * switch_volunteer_to_rsvp — inherits rsvp_to_event's checks; now
--     reports why (not just 'full') when one refuses.
--   * sign_up_for_volunteer_shift / switch_rsvp_to_volunteer (via
--     volunteer_signup_blocker) — didn't check the registration sections the
--     app now requires of volunteers.
--   * admin_upsert_walkup_rsvp — admin-only, but trusted the walk-up action
--     for the waiver signature and registration sections. Now checked here
--     too (the action records both before calling, so nothing changes for it).
--   * complete_volunteer_registration — trusted the app for the volunteer
--     waiver (home chapter's state, current year) and the required profile
--     answers; only the 18+ flag was checked. Now checks all of them.
--
-- Checked and fine (own row only, or is_admin() first): cancel_rsvp,
-- update_rsvp_answers, waitlist_position, claim_offered_spot (re-checks the
-- offer, its expiry and capacity itself), cancel_volunteer_signup,
-- admin_offer_spot, admin_remove_rsvp, admin_add_volunteer_signup,
-- admin_delete_volunteer_opportunity, admin_cancel_volunteer_opportunity,
-- admin_delete_empty_events. Internal and already revoked:
-- offer_waitlisted_spots, expire_excess_offers, process_waitlist_expiry,
-- try_claim_volunteer_slot, volunteer_signup_blocker.
--
-- Grants: every user-facing function below is revoked from anon (none of
-- them do anything useful without a login). is_admin and
-- can_view_volunteer_screening stay callable — RLS policies call them as
-- the querying role.

-- The waiver state for an event: events.waiver_state, else the chapter's
-- state (same mapping as default_event_waiver_state / waiverStateForEvent).
create or replace function public.event_waiver_state(p_waiver_state text, p_chapter text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    p_waiver_state,
    case
      when p_chapter in ('Denver', 'CO Springs', 'Colorado Springs', 'Virtual', 'No local chapter') then 'CO'
      when p_chapter in ('Atlanta', 'Rome') then 'GA'
    end
  );
$function$;

-- Whether this person has signed the ACTIVE waiver (highest active version)
-- for this state, year and audience. Mirrors loadActiveWaiver + loadSignature.
create or replace function public.has_signed_active_waiver(
  p_user_id uuid,
  p_state text,
  p_year int,
  p_audience text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.waiver_signatures s
     where s.user_id = p_user_id
       and s.waiver_id = (
         select w.id from public.waivers w
          where w.state = p_state and w.year = p_year and w.audience = p_audience and w.is_active
          order by w.version desc
          limit 1
       )
  );
$function$;

-- Whether this person has signed the event's own waiver for an audience
-- ('participant' for RSVPs and walk-ups, 'volunteer' for shifts): the
-- event's waiver state, in the event's calendar year in its own timezone.
create or replace function public.has_signed_event_waiver(
  p_user_id uuid,
  p_event_id bigint,
  p_audience text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select public.has_signed_active_waiver(
      p_user_id,
      public.event_waiver_state(e.waiver_state, e.chapter),
      extract(year from (e.starts_at at time zone e.timezone))::int,
      p_audience
    )
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

-- The id of the first registration section this person hasn't completed for
-- this event, or null. A SQL mirror of sectionsForEvent + isSectionComplete
-- over REGISTRATION_SECTIONS (lib/registration-sections.ts) — KEEP IN SYNC:
-- adding a section there means adding its required fields here. Unknown ids
-- in events.registration_sections are ignored, as in the app. The waiver
-- section is checked separately (has_signed_event_waiver); the directory
-- section is profile-only and never required.
create or replace function public.registration_incomplete_section(p_user_id uuid, p_event_id bigint)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_sections text[];
  p public.profiles%rowtype;
  blank constant text := '';
begin
  select coalesce(registration_sections, '{}') into v_sections
    from public.events where id = p_event_id;
  select * into p from public.profiles where id = p_user_id;
  if not found then
    return 'emergency_contact';
  end if;

  -- Always required.
  if coalesce(btrim(p.emergency_contact), blank) = blank
     or coalesce(btrim(p.emergency_phone), blank) = blank then
    return 'emergency_contact';
  end if;

  if 'dietary' = any(v_sections)
     and coalesce(btrim(p.dietary_notes), blank) = blank then
    return 'dietary';
  end if;

  if 'fly_fishing_sizing' = any(v_sections) and (
       coalesce(btrim(p.fly_fishing_experience), blank) = blank
       or p.needs_boots is null
       or (p.needs_boots and coalesce(btrim(p.boot_size), blank) = blank)
       or p.needs_waders is null
       or (p.needs_waders and coalesce(btrim(p.wader_size), blank) = blank)
       or p.needs_rod_reel is null
     ) then
    return 'fly_fishing_sizing';
  end if;

  return null;
end $function$;

revoke all on function public.event_waiver_state(text, text) from public, anon, authenticated;
revoke all on function public.has_signed_active_waiver(uuid, text, int, text) from public, anon, authenticated;
revoke all on function public.has_signed_event_waiver(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.registration_incomplete_section(uuid, bigint) from public, anon, authenticated;
grant execute on function public.event_waiver_state(text, text) to service_role;
grant execute on function public.has_signed_active_waiver(uuid, text, int, text) to service_role;
grant execute on function public.has_signed_event_waiver(uuid, bigint, text) to service_role;
grant execute on function public.registration_incomplete_section(uuid, bigint) to service_role;

-- Same as the earlier 2026-09-23 version, now built on the shared waiver
-- helpers, plus 'registration_incomplete' (checked last, so a volunteer who
-- isn't eligible at all is told that first).
create or replace function public.volunteer_signup_blocker(p_user_id uuid, p_opportunity_id bigint)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role_type_id bigint;
  v_event_id bigint;
begin
  if not exists (
    select 1 from public.volunteers where user_id = p_user_id and status = 'approved'
  ) then
    return 'not_approved';
  end if;

  select vo.role_type_id, vo.event_id into v_role_type_id, v_event_id
    from public.volunteer_opportunities vo
   where vo.id = p_opportunity_id;
  if not found then
    return 'not_found';
  end if;

  -- A role with no role_type_id ("Custom / other") is open to any approved
  -- volunteer, same as isRoleEligible.
  if v_role_type_id is not null and not exists (
    select 1 from public.volunteer_role_approvals
     where volunteer_id = p_user_id
       and role_type_id = v_role_type_id
       and revoked_at is null
  ) then
    return 'role_not_approved';
  end if;

  if not public.has_signed_event_waiver(p_user_id, v_event_id, 'volunteer') then
    return 'waiver_unsigned';
  end if;

  if public.registration_incomplete_section(p_user_id, v_event_id) is not null then
    return 'registration_incomplete';
  end if;

  return null;
end $function$;

-- rsvp_to_event, now checking everything the RSVP page and action check
-- instead of trusting them. Returns 'confirmed' / 'waitlisted' (or an
-- existing active status, for a notes-only update), else — writing nothing —
-- 'unavailable' (no such event, unpublished, or not scheduled),
-- 'waiver_unsigned' (no signature on the event's active participant waiver),
-- 'registration_incomplete' (a required section isn't on the profile), or
-- 'is_volunteer'. Someone who already holds an active RSVP can still update
-- its notes without re-passing the checks, as before (e.g. after the event
-- moved states and they owe a new signature — their spot is still theirs).
create or replace function public.rsvp_to_event(p_event_id bigint, p_dietary text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform 1 from public.events where id = p_event_id for update;

  select status into v_existing_status
    from public.rsvps
   where event_id = p_event_id and user_id = v_uid;

  if v_existing_status in ('confirmed', 'waitlisted', 'offered') then
    update public.rsvps
       set dietary_notes = p_dietary, updated_at = now()
     where event_id = p_event_id and user_id = v_uid;
    return v_existing_status;
  end if;

  if not exists (
    select 1 from public.events
     where id = p_event_id
       and coalesce(is_published, false)
       and coalesce(status, 'scheduled') = 'scheduled'
  ) then
    return 'unavailable';
  end if;

  if not public.has_signed_event_waiver(v_uid, p_event_id, 'participant') then
    return 'waiver_unsigned';
  end if;

  if public.registration_incomplete_section(v_uid, p_event_id) is not null then
    return 'registration_incomplete';
  end if;

  if exists (
    select 1
      from public.volunteer_signups s
      join public.volunteer_opportunities vo on vo.id = s.opportunity_id
     where vo.event_id = p_event_id
       and s.user_id = v_uid
       and s.status = 'confirmed'
  ) then
    return 'is_volunteer';
  end if;

  v_status := case when public.try_claim_event_spot(p_event_id) then 'confirmed' else 'waitlisted' end;

  insert into public.rsvps (event_id, user_id, status, dietary_notes, joined_at)
  values (
    p_event_id, v_uid, v_status, p_dietary,
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

-- Same as the earlier 2026-09-23 version, but when rsvp_to_event refuses
-- for a reason other than capacity (waiver, sections, event unavailable),
-- that reason is returned instead of 'full'. Still all-or-nothing: the
-- shift cancellations are rolled back either way. (PL/pgSQL variables
-- aren't rolled back with the block, so v_status survives into the handler.)
create or replace function public.switch_volunteer_to_rsvp(p_event_id bigint, p_dietary text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cancelled bigint[] := '{}';
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform 1 from public.events where id = p_event_id for update;

  begin
    with cancelled as (
      update public.volunteer_signups s
         set status = 'cancelled', cancelled_at = now()
        from public.volunteer_opportunities vo
       where vo.id = s.opportunity_id
         and vo.event_id = p_event_id
         and s.user_id = v_uid
         and s.status = 'confirmed'
      returning s.opportunity_id
    )
    select coalesce(array_agg(opportunity_id), '{}') into v_cancelled from cancelled;

    update public.volunteer_opportunities
       set slots_taken = greatest(slots_taken - 1, 0)
     where id = any(v_cancelled);

    v_status := public.rsvp_to_event(p_event_id, p_dietary);
    if v_status is distinct from 'confirmed' then
      raise exception 'switch refused' using errcode = 'FTGF1';
    end if;
  exception when sqlstate 'FTGF1' then
    return jsonb_build_object(
      'status', case when v_status = 'waitlisted' then 'full' else coalesce(v_status, 'full') end,
      'cancelled_opportunity_ids', '[]'::jsonb
    );
  end;

  return jsonb_build_object('status', v_status, 'cancelled_opportunity_ids', to_jsonb(v_cancelled));
end $function$;

-- Same as the 2026-09-21 version plus the participant waiver and required
-- registration sections, checked right after the admin check (before the
-- already-confirmed check-in shortcut too). The walk-up action records the
-- signature and saves the sections before calling this, so for it nothing
-- changes; it just can't be skipped. Returns 'waiver_unsigned' /
-- 'registration_incomplete' in those cases, writing nothing.
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

  if not public.has_signed_event_waiver(p_profile_id, p_event_id, 'participant') then
    return 'waiver_unsigned';
  end if;

  if public.registration_incomplete_section(p_profile_id, p_event_id) is not null then
    return 'registration_incomplete';
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

-- Same as the 2026-09-22 version plus what submitVolunteerRegistrationAction
-- (lib/actions/volunteer-register.ts) validates — KEEP IN SYNC: the required
-- profile answers, a recognized home chapter, and a signature on the active
-- VOLUNTEER waiver for the home chapter's state, current year in that
-- chapter's timezone (resolveVolunteerWaiver + timezoneForChapter).
create or replace function public.complete_volunteer_registration(p_is_18_plus boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  blank constant text := '';
  v_state text;
  v_zone text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not p_is_18_plus then
    raise exception 'Must confirm 18 years of age or older';
  end if;

  select * into p from public.profiles where id = v_uid;
  if not found
     or coalesce(btrim(p.first_name), blank) = blank
     or coalesce(btrim(p.last_name), blank) = blank
     or coalesce(btrim(p.phone), blank) = blank
     or coalesce(btrim(p.email), blank) = blank
     or coalesce(btrim(p.address_line1), blank) = blank
     or coalesce(btrim(p.city), blank) = blank
     or coalesce(btrim(p.state), blank) = blank
     or coalesce(btrim(p.postal_code), blank) = blank
     or coalesce(btrim(p.emergency_contact), blank) = blank
     or coalesce(btrim(p.emergency_phone), blank) = blank
     or coalesce(btrim(p.tshirt_size), blank) = blank
     or coalesce(btrim(p.favorite_snack), blank) = blank
     or coalesce(btrim(p.favorite_na_beverage), blank) = blank then
    raise exception 'Complete every required registration answer first';
  end if;

  if p.chapter not in ('Atlanta', 'CO Springs', 'Denver', 'Rome', 'No local chapter') then
    raise exception 'Choose a home chapter';
  end if;
  v_state := public.event_waiver_state(null, p.chapter);
  v_zone := case when v_state = 'GA' then 'America/New_York' else 'America/Denver' end;
  if not public.has_signed_active_waiver(
       v_uid, v_state, extract(year from (now() at time zone v_zone))::int, 'volunteer'
     ) then
    raise exception 'Sign the volunteer waiver first';
  end if;

  update public.volunteers
     set status = 'registered',
         registered_at = coalesce(registered_at, now()),
         is_18_plus = true,
         health_history_outstanding = true,
         updated_at = now()
   where user_id = v_uid
     and status in ('invited', 'registered');

  if not found then
    raise exception 'No volunteer invitation found for this account';
  end if;
end $function$;

-- ---- Grants -----------------------------------------------------------------
-- Internal: only ever called from inside the functions above/below (which
-- run as their owner), never by the app directly.
revoke all on function public.try_claim_event_spot(bigint, uuid) from public, anon, authenticated;
grant execute on function public.try_claim_event_spot(bigint, uuid) to service_role;

-- User-facing: signed-in users only.
revoke all on function public.rsvp_to_event(bigint, text) from public, anon;
revoke all on function public.cancel_rsvp(bigint) from public, anon;
revoke all on function public.claim_offered_spot(bigint) from public, anon;
revoke all on function public.update_rsvp_answers(bigint, text, boolean) from public, anon;
revoke all on function public.waitlist_position(bigint) from public, anon;
revoke all on function public.event_offered_counts(bigint[]) from public, anon;
revoke all on function public.admin_upsert_walkup_rsvp(bigint, uuid, boolean) from public, anon;
revoke all on function public.admin_offer_spot(bigint) from public, anon;
revoke all on function public.admin_remove_rsvp(bigint) from public, anon;
grant execute on function public.rsvp_to_event(bigint, text) to authenticated;
grant execute on function public.cancel_rsvp(bigint) to authenticated;
grant execute on function public.claim_offered_spot(bigint) to authenticated;
grant execute on function public.update_rsvp_answers(bigint, text, boolean) to authenticated;
grant execute on function public.waitlist_position(bigint) to authenticated;
grant execute on function public.event_offered_counts(bigint[]) to authenticated;
grant execute on function public.admin_upsert_walkup_rsvp(bigint, uuid, boolean) to authenticated;
grant execute on function public.admin_offer_spot(bigint) to authenticated;
grant execute on function public.admin_remove_rsvp(bigint) to authenticated;

-- =============================================================================
-- 2026-09-23 — Public event pages: anonymous read access, URL slugs
-- =============================================================================
-- /events/[slug] is readable without logging in, so anon needs to read
-- events — but only published ones, and never the meeting link.
--
-- 1. Rows: a new SELECT policy for the anon role only, limited to published
--    events that are scheduled or cancelled (a cancelled event's page shows
--    the cancellation). Unpublished events stay invisible, so their public
--    page 404s. The existing authenticated/admin policies are untouched.
--
-- 2. Columns: anon loses table-wide SELECT on events and gets it back on an
--    explicit column list instead (column-level privileges). virtual_link,
--    virtual_access_notes, the lead's contact details, the email-only note,
--    series/waiver internals and every column added in future are simply
--    not granted — Postgres refuses the query ("permission denied for table
--    events") if anon asks for them, including via select=* through the
--    API. This doesn't depend on the app selecting the right columns: it
--    holds for anyone with the public key. (Signed-in users are unaffected;
--    the public page itself always reads as anon — lib/public-events.ts.)
--    Anon also loses any write privilege on events it may have had by
--    default (RLS already blocked writes; this is belt and braces).
--
-- 3. Slugs: events.slug, e.g. "knot-just-fly-tying-night-oct-2-a1b2" —
--    title + the date in the event's own time zone + 4 random hex chars.
--    Set by a trigger on insert when not given (every creation path — the
--    wizard, series, anything future — gets one), backfilled for existing
--    rows, and NEVER regenerated: renaming or moving an event keeps its
--    link. An admin can change it on the edit form; the previous slug is
--    kept in event_slug_aliases so printed links still resolve (the page
--    redirects to the current slug), and no event can take a slug another
--    event has used. It always contains a letter, so /events/123 is always
--    unambiguously an old numeric-id URL (still supported, redirecting).
--
-- 4. event_offered_counts goes back to anon (revoked earlier today): the
--    public page's "spots remaining" subtracts open waitlist offers, same as
--    the signed-in pages. It returns only counts per event.
--
-- To check the column lock after running this (in the SQL editor):
--   set role anon;
--   select id, name, slug from public.events limit 1;   -- works
--   select virtual_link from public.events limit 1;     -- permission denied
--   reset role;

-- ---- Slugs --------------------------------------------------------------------

alter table public.events add column if not exists slug text;

create table if not exists public.event_slug_aliases (
  slug text primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  retired_at timestamptz not null default now()
);
create index if not exists event_slug_aliases_event_idx on public.event_slug_aliases (event_id);

-- "Knot Just Fly-Tying Night!" -> "knot-just-fly-tying-night"
create or replace function public.slugify_event_title(p_title text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select btrim(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'), '-');
$function$;

-- A fresh, unused slug: title (cut at a word boundary to ~48 chars) + the
-- event's local date ("oct-2") + 4 random hex chars, retried until it's
-- used by no event and no retired alias.
create or replace function public.generate_event_slug(p_name text, p_starts_at timestamptz, p_timezone text)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_title text := public.slugify_event_title(p_name);
  v_base text;
  v_candidate text;
begin
  if length(v_title) > 48 then
    v_title := btrim(regexp_replace(left(v_title, 49), '-[^-]*$', ''), '-');
  end if;
  v_base := concat_ws(
    '-',
    nullif(v_title, ''),
    lower(to_char(p_starts_at at time zone coalesce(p_timezone, 'America/Denver'), 'Mon-FMDD'))
  );
  loop
    v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (select 1 from public.events where slug = v_candidate)
          and not exists (select 1 from public.event_slug_aliases where slug = v_candidate);
  end loop;
  return v_candidate;
end $function$;

-- Insert: generate one if none given. Update: a slug is never cleared
-- (null/blank keeps the old one), and a change retires the old slug into
-- event_slug_aliases. SECURITY DEFINER so it can write the alias table,
-- which nobody else can. Unique-violation errcode for a slug another event
-- has used, so the app reports it the same way as the unique index.
create or replace function public.events_slug_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.slug is null or btrim(new.slug) = '' then
      new.slug := public.generate_event_slug(new.name, new.starts_at, new.timezone);
    end if;
  else
    if new.slug is null or btrim(new.slug) = '' then
      new.slug := old.slug;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;

  if exists (
    select 1 from public.event_slug_aliases
     where slug = new.slug and event_id is distinct from new.id
  ) then
    raise exception 'That link was used by another event' using errcode = '23505';
  end if;

  if tg_op = 'UPDATE' then
    -- Taking back one of its own old slugs: it's current again, not an alias.
    delete from public.event_slug_aliases where slug = new.slug and event_id = new.id;
    if old.slug is not null then
      insert into public.event_slug_aliases (slug, event_id)
      values (old.slug, new.id)
      on conflict (slug) do nothing;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists events_slug_guard on public.events;
create trigger events_slug_guard
  before insert or update of slug on public.events
  for each row execute function public.events_slug_guard();

-- Backfill (the trigger sees old.slug null here, so nothing is aliased).
update public.events
   set slug = public.generate_event_slug(name, starts_at, timezone)
 where slug is null;

alter table public.events alter column slug set not null;
create unique index if not exists events_slug_key on public.events (slug);
alter table public.events drop constraint if exists events_slug_format;
alter table public.events
  add constraint events_slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and slug ~ '[a-z]'
    and length(slug) between 3 and 80
  );

revoke all on function public.slugify_event_title(text) from public, anon, authenticated;
revoke all on function public.generate_event_slug(text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.events_slug_guard() from public, anon, authenticated;
grant execute on function public.slugify_event_title(text) to service_role;
grant execute on function public.generate_event_slug(text, timestamptz, text) to service_role;

-- Anyone may look up a retired slug of a published event (it only maps to an
-- event id; the event itself is then subject to the policies below). Admins
-- see all. Written only by events_slug_guard.
alter table public.event_slug_aliases enable row level security;

drop policy if exists event_slug_aliases_select_published on public.event_slug_aliases;
create policy event_slug_aliases_select_published on public.event_slug_aliases
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.events e
       where e.id = event_slug_aliases.event_id
         and coalesce(e.is_published, false)
    )
  );

drop policy if exists event_slug_aliases_select_admin on public.event_slug_aliases;
create policy event_slug_aliases_select_admin on public.event_slug_aliases
  for select to authenticated
  using (public.is_admin());

revoke all on public.event_slug_aliases from anon, authenticated;
grant select on public.event_slug_aliases to anon, authenticated;
grant all on public.event_slug_aliases to service_role;

-- ---- Anonymous read access to events -------------------------------------------

drop policy if exists events_select_public on public.events;
create policy events_select_public on public.events
  for select to anon
  using (
    coalesce(is_published, false)
    and coalesce(status, 'scheduled') in ('scheduled', 'cancelled')
  );

revoke all on public.events from anon;
grant select (
  id,
  slug,
  name,
  chapter,
  event_type,
  starts_at,
  ends_at,
  timezone,
  location,
  venue_name,
  street_address,
  city,
  state,
  description,
  occurrence_note,
  capacity,
  spots_taken,
  is_published,
  status,
  cancellation_reason
) on public.events to anon;

grant execute on function public.event_offered_counts(bigint[]) to anon;

-- =============================================================================
-- 2026-09-23 — Slug suffix always contains a letter
-- =============================================================================
-- The 4-character random suffix was plain hex, so about 15% of slugs ended in
-- four digits and read as a year: "...-dec-31-2071". The suffix now starts
-- with a random letter a–z followed by 3 hex characters ("...-dec-31-k07b"),
-- so it can't be mistaken for a date. Same length, same uniqueness retry.
-- Existing slugs are untouched — they're stable by design (printed links).
create or replace function public.generate_event_slug(p_name text, p_starts_at timestamptz, p_timezone text)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_title text := public.slugify_event_title(p_name);
  v_base text;
  v_candidate text;
begin
  if length(v_title) > 48 then
    v_title := btrim(regexp_replace(left(v_title, 49), '-[^-]*$', ''), '-');
  end if;
  v_base := concat_ws(
    '-',
    nullif(v_title, ''),
    lower(to_char(p_starts_at at time zone coalesce(p_timezone, 'America/Denver'), 'Mon-FMDD'))
  );
  loop
    v_candidate := v_base || '-'
      || chr(97 + floor(random() * 26)::int)
      || substr(md5(random()::text || clock_timestamp()::text), 1, 3);
    exit when not exists (select 1 from public.events where slug = v_candidate)
          and not exists (select 1 from public.event_slug_aliases where slug = v_candidate);
  end loop;
  return v_candidate;
end $function$;

revoke all on function public.generate_event_slug(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.generate_event_slug(text, timestamptz, text) to service_role;

-- =============================================================================
-- 2026-09-24 — Deleting unused role types / event types / templates,
-- template provenance on events, Fishing Instructor retreat-only
-- =============================================================================
-- Volunteer role types, event types, and event templates can now be deleted
-- from their admin screens — but only when nothing references them; anything
-- in use can still only be deactivated. The app checks first so it can say
-- exactly what's using it, and the database enforces the same rule on its
-- own:
--  - volunteer_role_types: already referenced by plain (NO ACTION) FKs from
--    volunteer_role_approvals (active and revoked), volunteer_opportunities,
--    and event_template_roles, so a delete of one in use fails with 23503.
--    The existing volunteer_role_types_admin_all policy already covers
--    DELETE; only the grant was missing.
--  - event_types: events.event_type and event_templates.event_type are plain
--    text with no FK (see the 2026-09-22 entry), so a BEFORE DELETE trigger
--    refuses the delete while any event or template still carries the
--    type's name.
--  - event_templates: events.created_from_template_id (new) records which
--    template seeded an event, with a NO ACTION FK so a template that has
--    created events can't be deleted. Events created before this change have
--    no record of their template, so they don't count. The link is
--    provenance only — editing a template still never changes an event.

-- ---- Template provenance ------------------------------------------------------
alter table public.events
  add column if not exists created_from_template_id bigint
    references public.event_templates(id);

create index if not exists events_created_from_template_idx
  on public.events (created_from_template_id)
  where created_from_template_id is not null;

-- ---- Delete grants --------------------------------------------------------------
-- Each table's existing "*_admin_all" policy (for all, is_admin()) already
-- covers DELETE for admins.
grant delete on public.volunteer_role_types to authenticated;
grant delete on public.event_types to authenticated;
grant delete on public.event_templates to authenticated;

-- ---- Event types: refuse deleting one still in use ---------------------------
create or replace function public.event_types_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.events where event_type = old.name)
     or exists (select 1 from public.event_templates where event_type = old.name) then
    raise exception 'Event type "%" is still used by an event or template', old.name
      using errcode = '23503';
  end if;
  return old;
end $function$;

drop trigger if exists event_types_delete_guard on public.event_types;
create trigger event_types_delete_guard
  before delete on public.event_types
  for each row execute function public.event_types_delete_guard();

revoke all on function public.event_types_delete_guard() from public, anon, authenticated;

-- ---- Fishing Instructor: retreats only ----------------------------------------
-- A separate chapter-program role will be added later. Existing event roles
-- and approvals that use it are untouched; it just stops being offered for
-- new chapter events and templates.
update public.volunteer_role_types
  set for_chapter_events = false
  where key = 'fishing_instructor';

-- =============================================================================
-- 2026-09-24 — Optional title on event template roles
-- =============================================================================
-- A display-only label for a template's role (e.g. "Vise wrangler" for a
-- Fly Tying Lead role type). Null = use the role type's name. Applying the
-- template fills the new event role's title (volunteer_opportunities.role)
-- from it, falling back to the role type's name; "Save as template" carries
-- an event role's title over when it differs from its role type's name. The
-- role type alone still decides who's eligible to sign up.
alter table public.event_template_roles
  add column if not exists title text;

-- =============================================================================
-- 2026-09-24 — Chapter lead privileges: profiles.role, led chapters, event
-- lead accounts, can_manage_event()
-- =============================================================================
-- A middle tier between participant and admin.
--
-- Roles: profiles.role ('participant' | 'chapter_lead' | 'admin') replaces
-- profiles.is_admin as the source of truth. is_admin stays as a column, kept
-- equal to (role = 'admin') by profiles_role_guard, so anything that still
-- reads it keeps working; setting it directly (e.g. from the Table Editor)
-- maps back onto role. is_admin() now reads role, so every existing
-- admin-only policy and function (setup tables, volunteer registry, role
-- approvals, invites, screening notes, waivers) stays admin-only without
-- being rewritten. can_view_volunteer_screening stays a separate flag, now
-- only honoured for admins.
--
-- profiles.led_chapters: the chapters a chapter lead is responsible for
-- (events.chapter names). Always empty unless role = 'chapter_lead'.
--
-- events.lead_user_id: the event's lead as an account (nullable). The
-- free-text lead_name / lead_email / lead_phone stay for display and for
-- leads without an account.
--
-- Who can manage an event — ONE definition, can_manage_event(event_id),
-- used by the RLS policies below, the SECURITY DEFINER RPCs, and the app's
-- server actions (via rpc): an admin, OR a chapter lead whose led_chapters
-- includes the event's chapter, OR the event's lead_user_id. The logic sits
-- in can_manage_event_row(chapter, lead_user_id), which can_manage_event
-- looks up and calls, and the events table's own policies call directly
-- (see there). The chapter half is can_manage_chapter(chapter), which also
-- decides where an event may be CREATED (there's no event id yet then).
-- Nothing else re-implements any of them.
--
-- Chapter leads get, for events they manage (all via new, additive
-- permissive policies — the admin ones are untouched): read/insert/update
-- the event, its volunteer roles, RSVPs and volunteer signups (check-in),
-- the profiles and waiver signatures of people on those events (roster
-- contact details, emergency contacts, registration answers), slug aliases;
-- plus read-only access to event types, templates and volunteer role types
-- so the create/edit forms work. Everything else stays admin-only because
-- its policy is is_admin(): the setup tables' writes, volunteers,
-- volunteer_role_approvals, volunteer_certifications,
-- volunteer_screening_notes, waivers' writes. Role changes are admin-only,
-- enforced by profiles_role_guard (and admin_set_user_role).
--
-- Also closes a gap: nothing previously stopped a user from setting
-- is_admin = true on their own profile row (the profile form updates it
-- from the browser). profiles_role_guard now rejects any non-admin change
-- to role / led_chapters / is_admin / can_view_volunteer_screening.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.

begin;

-- ---- Roles ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'participant'
    check (role in ('participant', 'chapter_lead', 'admin')),
  add column if not exists led_chapters text[] not null default '{}'::text[];

update public.profiles set role = 'admin' where is_admin and role <> 'admin';

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select role = 'admin' from public.profiles where id = p_user_id),
    false
  );
$function$;

-- The flag only counts for an admin — a demoted admin who still has it set
-- sees nothing (and it comes back if they're made admin again).
create or replace function public.can_view_volunteer_screening(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select role = 'admin' and can_view_volunteer_screening
       from public.profiles where id = p_user_id),
    false
  );
$function$;

-- Only an admin (or a trusted server context with no signed-in user: the
-- service role, the SQL editor, the signup trigger) may change role,
-- led_chapters, is_admin or can_view_volunteer_screening. Keeps is_admin =
-- (role = 'admin') and led_chapters empty for anyone who isn't a lead.
create or replace function public.profiles_role_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_privileged boolean := auth.uid() is null or public.is_admin();
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      new.role := 'participant';
      new.led_chapters := '{}'::text[];
      new.can_view_volunteer_screening := false;
    end if;
  else
    if not v_privileged and (
      new.role is distinct from old.role
      or new.led_chapters is distinct from old.led_chapters
      or new.is_admin is distinct from old.is_admin
      or new.can_view_volunteer_screening is distinct from old.can_view_volunteer_screening
    ) then
      raise exception 'Only admins can change roles' using errcode = '42501';
    end if;
    -- Back-compat: a trusted write that flips is_admin alone (the old way of
    -- making someone an admin) is mapped onto role.
    if new.is_admin is distinct from old.is_admin and new.role is not distinct from old.role then
      new.role := case
        when new.is_admin then 'admin'
        when old.role = 'admin' then 'participant'
        else old.role
      end;
    end if;
  end if;

  if new.role is distinct from 'chapter_lead' then
    new.led_chapters := '{}'::text[];
  end if;
  new.is_admin := (new.role = 'admin');
  return new;
end $function$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_role_guard();

revoke all on function public.profiles_role_guard() from public, anon, authenticated;

-- ---- Event lead account ----------------------------------------------------------
alter table public.events
  add column if not exists lead_user_id uuid references public.profiles(id) on delete set null;

create index if not exists events_lead_user_idx
  on public.events (lead_user_id)
  where lead_user_id is not null;

-- ---- Who can manage what -----------------------------------------------------------
-- The chapter half of the rule: an admin, or a chapter lead who leads it.
create or replace function public.can_manage_chapter(p_chapter text)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select p.role = 'admin'
            or (p.role = 'chapter_lead' and p_chapter is not null and p_chapter = any(p.led_chapters))
       from public.profiles p
      where p.id = auth.uid()),
    false
  );
$function$;

-- THE rule, on an event's values: admin, or chapter lead for its chapter,
-- or its own lead_user_id. The events policies call this form directly on
-- the row's columns — a policy that looked the event up by id couldn't see
-- a row the same INSERT ... RETURNING is creating.
create or replace function public.can_manage_event_row(p_chapter text, p_lead_user_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select public.can_manage_chapter(p_chapter)
      or coalesce(p_lead_user_id is not null and p_lead_user_id = auth.uid(), false);
$function$;

-- The same rule by event id — what everything else calls (other tables'
-- policies, the RPCs, the app's server actions).
create or replace function public.can_manage_event(p_event_id bigint)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select public.can_manage_event_row(e.chapter, e.lead_user_id)
       from public.events e
      where e.id = p_event_id),
    false
  );
$function$;

-- can_manage_event for a volunteer role's event. SECURITY DEFINER so the
-- volunteer_signups policies can use it without recursing through
-- volunteer_opportunities' own policies (which read volunteer_signups).
create or replace function public.can_manage_opportunity(p_opportunity_id bigint)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select public.can_manage_event(vo.event_id)
       from public.volunteer_opportunities vo
      where vo.id = p_opportunity_id),
    false
  );
$function$;

-- Every event the caller can manage (can_manage_event, row by row).
create or replace function public.managed_event_ids()
returns setof bigint
language sql
security definer
set search_path to 'public'
stable
as $function$
  select e.id from public.events e where public.can_manage_event(e.id);
$function$;

-- Which of p_chapters the caller may create events in (can_manage_chapter
-- for each) — the create wizard's chapter options. The chapter list itself
-- lives in the app (lib/chapters.ts), so it's passed in.
create or replace function public.manageable_chapters(p_chapters text[])
returns text[]
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(array_agg(c order by ord), '{}'::text[])
    from unnest(p_chapters) with ordinality as t(c, ord)
   where public.can_manage_chapter(c);
$function$;

-- Whether the caller gets the event-management area at all: an admin or
-- chapter lead, or anyone who manages at least one event. For anyone else
-- that can only be an event they're the lead_user_id of, so only those rows
-- are put through can_manage_event (this runs inside per-row policies, so
-- it mustn't scan every event for every plain participant).
create or replace function public.has_event_admin_access()
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(
    (select p.role in ('admin', 'chapter_lead') from public.profiles p where p.id = auth.uid()),
    false
  ) or exists (
    select 1 from public.events e
     where e.lead_user_id = auth.uid() and public.can_manage_event(e.id)
  );
$function$;

-- A person the caller may see the profile (and waiver signatures) of:
-- themselves, or anyone with an RSVP or volunteer signup — any status — on
-- an event the caller manages. Admins already read every profile through
-- admin_select_all_profiles.
create or replace function public.can_view_person(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
begin
  if auth.uid() is null then
    return false;
  end if;
  if p_user_id = auth.uid() or public.is_admin() then
    return true;
  end if;
  -- Cheap exit for the common case: a plain participant who leads nothing.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'chapter_lead')
  ) and not exists (
    select 1 from public.events where lead_user_id = auth.uid()
  ) then
    return false;
  end if;
  return exists (
    select 1 from public.rsvps r
     where r.user_id = p_user_id and public.can_manage_event(r.event_id)
  ) or exists (
    select 1 from public.volunteer_signups s
      join public.volunteer_opportunities vo on vo.id = s.opportunity_id
     where s.user_id = p_user_id and public.can_manage_event(vo.event_id)
  );
end $function$;

-- Events can only be created in, or moved to, a chapter the caller manages
-- (can_manage_chapter). Covers what an UPDATE policy can't: a WITH CHECK
-- can't compare against the old row. Trusted contexts (no signed-in user)
-- are exempt.
create or replace function public.events_chapter_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.chapter is distinct from old.chapter)
     and not public.can_manage_chapter(new.chapter) then
    raise exception 'You can only put events in a chapter you manage' using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists events_chapter_guard on public.events;
create trigger events_chapter_guard
  before insert or update of chapter on public.events
  for each row execute function public.events_chapter_guard();

revoke all on function public.events_chapter_guard() from public, anon, authenticated;

-- ---- Policies for event managers (additive; admin policies unchanged) -------------
drop policy if exists events_select_managed on public.events;
create policy events_select_managed on public.events
  for select to authenticated
  using (public.can_manage_event_row(chapter, lead_user_id));

drop policy if exists events_update_managed on public.events;
-- WITH CHECK on the new values: whoever saves must still manage the event
-- afterwards. (Moving it to another chapter is checked separately by
-- events_chapter_guard, since an event's lead could otherwise move it
-- anywhere while staying its lead.)
create policy events_update_managed on public.events
  for update to authenticated
  using (public.can_manage_event_row(chapter, lead_user_id))
  with check (public.can_manage_event_row(chapter, lead_user_id));

drop policy if exists events_insert_chapter_manager on public.events;
create policy events_insert_chapter_manager on public.events
  for insert to authenticated
  with check (public.can_manage_chapter(chapter));

drop policy if exists rsvps_select_managed on public.rsvps;
create policy rsvps_select_managed on public.rsvps
  for select to authenticated
  using (public.can_manage_event(event_id));

-- The roster's check-in toggle writes checked_in_at from the browser.
drop policy if exists rsvps_update_managed on public.rsvps;
create policy rsvps_update_managed on public.rsvps
  for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

drop policy if exists profiles_select_managed_people on public.profiles;
create policy profiles_select_managed_people on public.profiles
  for select to authenticated
  using (public.can_view_person(id));

drop policy if exists waiver_signatures_select_managed_people on public.waiver_signatures;
create policy waiver_signatures_select_managed_people on public.waiver_signatures
  for select to authenticated
  using (public.can_view_person(user_id));

drop policy if exists volunteer_opportunities_select_managed on public.volunteer_opportunities;
create policy volunteer_opportunities_select_managed on public.volunteer_opportunities
  for select to authenticated
  using (public.can_manage_event(event_id));

drop policy if exists volunteer_opportunities_insert_managed on public.volunteer_opportunities;
create policy volunteer_opportunities_insert_managed on public.volunteer_opportunities
  for insert to authenticated
  with check (public.can_manage_event(event_id));

drop policy if exists volunteer_opportunities_update_managed on public.volunteer_opportunities;
create policy volunteer_opportunities_update_managed on public.volunteer_opportunities
  for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

drop policy if exists volunteer_signups_select_managed on public.volunteer_signups;
create policy volunteer_signups_select_managed on public.volunteer_signups
  for select to authenticated
  using (public.can_manage_opportunity(opportunity_id));

-- Volunteer check-in from the roster.
drop policy if exists volunteer_signups_update_managed on public.volunteer_signups;
create policy volunteer_signups_update_managed on public.volunteer_signups
  for update to authenticated
  using (public.can_manage_opportunity(opportunity_id))
  with check (public.can_manage_opportunity(opportunity_id));

drop policy if exists event_slug_aliases_select_managed on public.event_slug_aliases;
create policy event_slug_aliases_select_managed on public.event_slug_aliases
  for select to authenticated
  using (public.can_manage_event(event_id));

-- Read-only catalog access for chapter leads, so the create/edit forms can
-- offer event types, templates and volunteer role types. Writes stay on the
-- admin-only *_admin_all policies.
drop policy if exists event_types_select_chapter_lead on public.event_types;
create policy event_types_select_chapter_lead on public.event_types
  for select to authenticated
  using (public.has_event_admin_access());

drop policy if exists event_templates_select_chapter_lead on public.event_templates;
create policy event_templates_select_chapter_lead on public.event_templates
  for select to authenticated
  using (public.has_event_admin_access());

drop policy if exists event_template_roles_select_chapter_lead on public.event_template_roles;
create policy event_template_roles_select_chapter_lead on public.event_template_roles
  for select to authenticated
  using (public.has_event_admin_access());

drop policy if exists volunteer_role_types_select_chapter_lead on public.volunteer_role_types;
create policy volunteer_role_types_select_chapter_lead on public.volunteer_role_types
  for select to authenticated
  using (public.has_event_admin_access());

-- ---- Event-scoped RPCs: is_admin() -> can_manage_event() --------------------------
-- Bodies unchanged apart from the gate (and, where the event id has to be
-- looked up first, the lookup moving above it).

-- Same as the 2026-09-23 version; gate is can_manage_event.
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
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only someone who manages this event can add walk-ups';
  end if;

  if not exists (
    select 1 from public.events where id = p_event_id and status = 'scheduled'
  ) then
    raise exception 'Event is not scheduled';
  end if;

  if not public.has_signed_event_waiver(p_profile_id, p_event_id, 'participant') then
    return 'waiver_unsigned';
  end if;

  if public.registration_incomplete_section(p_profile_id, p_event_id) is not null then
    return 'registration_incomplete';
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

-- Same as the 2026-09-21 null-safe version; gate is can_manage_event.
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
  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    if not public.has_event_admin_access() then
      raise exception 'Only someone who manages this event can offer spots';
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'Only someone who manages this event can offer spots';
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

-- Same as the 2026-09-21 version; gate is can_manage_event.
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
  select event_id into v_event_id from public.rsvps where id = p_rsvp_id;
  if not found then
    if not public.has_event_admin_access() then
      raise exception 'Only someone who manages this event can remove RSVPs';
    end if;
    return jsonb_build_object('removed', false, 'offered', v_offered);
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'Only someone who manages this event can remove RSVPs';
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

-- Same as the 2026-09-22 version; gate is can_manage_opportunity, and only
-- an admin may add someone who isn't approved for the role (a chapter lead
-- can add approved volunteers only — approving is admin-only).
create or replace function public.admin_add_volunteer_signup(
  p_opportunity_id bigint,
  p_user_id uuid,
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
  if not public.can_manage_opportunity(p_opportunity_id) then
    raise exception 'Only someone who manages this event can add a volunteer signup';
  end if;

  if not public.is_admin()
     and public.volunteer_signup_blocker(p_user_id, p_opportunity_id) in ('not_approved', 'role_not_approved') then
    raise exception 'Only an admin can add someone who isn''t approved for this role';
  end if;

  select status into v_existing_status
    from public.volunteer_signups
   where opportunity_id = p_opportunity_id and user_id = p_user_id;

  if v_existing_status = 'confirmed' then
    return 'confirmed';
  end if;

  v_claimed := public.try_claim_volunteer_slot(p_opportunity_id);

  if not v_claimed and not p_force then
    return 'capacity_exceeded';
  end if;

  if not v_claimed and p_force then
    update public.volunteer_opportunities
       set slots_taken = slots_taken + 1
     where id = p_opportunity_id;
  end if;

  insert into public.volunteer_signups (opportunity_id, user_id, status, signed_up_at, cancelled_at, checked_in_at)
  values (p_opportunity_id, p_user_id, 'confirmed', now(), null, null)
  on conflict (opportunity_id, user_id)
  do update set status = 'confirmed',
                signed_up_at = now(),
                cancelled_at = null,
                checked_in_at = null;

  return 'confirmed';
end $function$;

-- Same as the 2026-09-22 version; gate is can_manage_opportunity.
create or replace function public.admin_delete_volunteer_opportunity(p_opportunity_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.can_manage_opportunity(p_opportunity_id) then
    if exists (select 1 from public.volunteer_opportunities where id = p_opportunity_id)
       or not public.has_event_admin_access() then
      raise exception 'Only someone who manages this event can delete a volunteer role';
    end if;
    return 'not_found';
  end if;

  perform 1 from public.volunteer_opportunities where id = p_opportunity_id for update;
  if not found then
    return 'not_found';
  end if;

  if exists (
    select 1 from public.volunteer_signups
     where opportunity_id = p_opportunity_id and status = 'confirmed'
  ) then
    return 'has_signups';
  end if;

  delete from public.volunteer_opportunities where id = p_opportunity_id;
  return 'deleted';
end $function$;

-- Same as the 2026-09-22 version; gate is can_manage_opportunity.
create or replace function public.admin_cancel_volunteer_opportunity(p_opportunity_id bigint)
returns table (user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.can_manage_opportunity(p_opportunity_id) then
    if exists (select 1 from public.volunteer_opportunities where id = p_opportunity_id)
       or not public.has_event_admin_access() then
      raise exception 'Only someone who manages this event can cancel a volunteer role';
    end if;
    return;
  end if;

  perform 1 from public.volunteer_opportunities
   where id = p_opportunity_id and cancelled_at is null
   for update;
  if not found then
    return;
  end if;

  return query
    with cancelled as (
      update public.volunteer_signups s
         set status = 'cancelled', cancelled_at = now()
       where s.opportunity_id = p_opportunity_id and s.status = 'confirmed'
      returning s.user_id as cancelled_user_id
    )
    select c.cancelled_user_id from cancelled c;

  update public.volunteer_opportunities
     set cancelled_at = now(), slots_taken = 0
   where id = p_opportunity_id;
end $function$;

-- Same as the 2026-09-22 version; every id passed must be manageable.
create or replace function public.admin_delete_empty_events(p_event_ids bigint[])
returns setof bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if not public.has_event_admin_access() or exists (
    select 1 from unnest(p_event_ids) as t(id)
     where exists (select 1 from public.events e where e.id = t.id)
       and not public.can_manage_event(t.id)
  ) then
    raise exception 'Only someone who manages these events can delete them';
  end if;

  for v_id in
    select id from public.events where id = any(p_event_ids) order by id for update
  loop
    if exists (
      select 1 from public.rsvps
       where event_id = v_id and status in ('confirmed', 'waitlisted', 'offered')
    ) or exists (
      select 1 from public.volunteer_signups s
        join public.volunteer_opportunities vo on vo.id = s.opportunity_id
       where vo.event_id = v_id and s.status = 'confirmed'
    ) then
      continue;
    end if;

    delete from public.rsvps where event_id = v_id;
    delete from public.volunteer_opportunities where event_id = v_id;
    delete from public.events where id = v_id;
    return next v_id;
  end loop;
end $function$;

-- ---- New RPCs --------------------------------------------------------------------

-- The event lead person-picker. Admins can pick anyone; chapter leads and
-- event leads can pick admins, chapter leads, themselves, and members whose
-- home chapter they lead — so the picker can't be used to list every
-- member's contact details.
create or replace function public.event_lead_candidates(p_query text)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  role text,
  chapter text
)
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
  v_is_admin boolean := public.is_admin();
  v_led text[];
begin
  if not public.has_event_admin_access() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select p.led_chapters into v_led from public.profiles p where p.id = auth.uid();

  return query
    select p.id, p.first_name, p.last_name, p.email, p.phone, p.role, p.chapter
      from public.profiles p
     where (
             p.first_name ilike v_pattern
             or p.last_name ilike v_pattern
             or p.email ilike v_pattern
             or concat_ws(' ', p.first_name, p.last_name) ilike v_pattern
           )
       and (
             v_is_admin
             or p.role in ('admin', 'chapter_lead')
             or p.id = auth.uid()
             or p.chapter = any(coalesce(v_led, '{}'::text[]))
           )
     order by p.first_name nulls last, p.last_name nulls last
     limit 10;
end $function$;

-- "Add a volunteer" on the roster: looks a person up by email for one
-- volunteer role, with whether they're approved (and approved for this
-- role). Lets a chapter lead add approved volunteers without reading the
-- volunteer registry itself.
create or replace function public.volunteer_for_shift(p_opportunity_id bigint, p_email text)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  approved boolean,
  approved_for_role boolean
)
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_blocker text;
  v_profile public.profiles%rowtype;
begin
  if not public.can_manage_opportunity(p_opportunity_id) then
    raise exception 'Only someone who manages this event can add volunteers' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles p
   where lower(p.email) = lower(btrim(coalesce(p_email, '')))
   limit 1;
  if not found then
    return;
  end if;

  v_blocker := public.volunteer_signup_blocker(v_profile.id, p_opportunity_id);
  return query select
    v_profile.id,
    v_profile.first_name,
    v_profile.last_name,
    v_profile.email,
    coalesce(v_blocker, '') <> 'not_approved',
    coalesce(v_blocker, '') not in ('not_approved', 'role_not_approved');
end $function$;

-- Admin-only role change. Refuses to demote the last admin; clears
-- led_chapters for anyone who isn't a chapter lead (profiles_role_guard).
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role text,
  p_led_chapters text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_role text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if p_role not in ('participant', 'chapter_lead', 'admin') then
    raise exception 'Unknown role %', p_role;
  end if;

  -- Serializes concurrent demotions so two admins can't each remove the
  -- other and leave nobody.
  perform 1 from public.profiles where role = 'admin' for update;
  select role into v_old_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Person not found';
  end if;

  if v_old_role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'There has to be at least one admin' using errcode = '42501';
  end if;

  update public.profiles
     set role = p_role,
         led_chapters = case
           when p_role = 'chapter_lead' then coalesce(p_led_chapters, '{}'::text[])
           else '{}'::text[]
         end
   where id = p_user_id;
end $function$;

-- ---- Grants ----------------------------------------------------------------------
-- The helpers are called from RLS policies as the querying role, and from
-- the app via rpc, so authenticated needs EXECUTE; anon never does.
revoke all on function public.can_manage_chapter(text) from public, anon;
grant execute on function public.can_manage_chapter(text) to authenticated, service_role;
revoke all on function public.can_manage_event_row(text, uuid) from public, anon;
grant execute on function public.can_manage_event_row(text, uuid) to authenticated, service_role;
revoke all on function public.can_manage_event(bigint) from public, anon;
grant execute on function public.can_manage_event(bigint) to authenticated, service_role;
revoke all on function public.can_manage_opportunity(bigint) from public, anon;
grant execute on function public.can_manage_opportunity(bigint) to authenticated, service_role;
revoke all on function public.managed_event_ids() from public, anon;
grant execute on function public.managed_event_ids() to authenticated, service_role;
revoke all on function public.manageable_chapters(text[]) from public, anon;
grant execute on function public.manageable_chapters(text[]) to authenticated, service_role;
revoke all on function public.has_event_admin_access() from public, anon;
grant execute on function public.has_event_admin_access() to authenticated, service_role;
revoke all on function public.can_view_person(uuid) from public, anon;
grant execute on function public.can_view_person(uuid) to authenticated, service_role;
revoke all on function public.event_lead_candidates(text) from public, anon;
grant execute on function public.event_lead_candidates(text) to authenticated;
revoke all on function public.volunteer_for_shift(bigint, text) from public, anon;
grant execute on function public.volunteer_for_shift(bigint, text) to authenticated;
revoke all on function public.admin_set_user_role(uuid, text, text[]) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text, text[]) to authenticated;

commit;

-- =============================================================================
-- 2026-09-24 — Event ZIP codes, template title + location, saved venues
-- =============================================================================
-- 1. events.postal_code: optional ZIP next to state. The composed
--    events.location string (cards, emails, .ics LOCATION) now ends
--    "City, ST 80202" when one is given; existing rows are untouched until
--    edited. Granted to anon alongside the other address columns so the
--    public event page can show it (see the 2026-09-23 "Public event pages"
--    entry — anon only ever gets an explicit column list).
--
-- 2. event_templates.default_title: pre-fills the new event's title (null =
--    the title starts blank; the template's own `name` is never copied).
--    event_templates.default_venue_name / _street_address / _city / _state /
--    _postal_code: an optional default location. Like everything else on a
--    template, applying it copies values — nothing links back.
--
-- 3. venues: saved places the event forms' venue picker offers. Picking one
--    COPIES its address onto the event (events keep their own venue_name,
--    street_address, city, state, postal_code), so editing, retiring
--    (active = false) or deleting a venue never changes any event or
--    template. chapter null = offered to every chapter.
--    - read: anyone with the event-management area (has_event_admin_access)
--    - add: admins, and chapter leads for a chapter they lead
--      (can_manage_chapter) — the forms' "Save this venue for next time";
--      an all-chapter venue (chapter null) is admin-only
--    - edit / retire / delete: admins only
--    One venue per name per chapter (case-insensitive).
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.

begin;

-- ---- 1. Event ZIP code ----------------------------------------------------------
alter table public.events add column if not exists postal_code text;

grant select (postal_code) on public.events to anon;

-- ---- 2. Template title + default location ---------------------------------------
alter table public.event_templates
  add column if not exists default_title text,
  add column if not exists default_venue_name text,
  add column if not exists default_street_address text,
  add column if not exists default_city text,
  add column if not exists default_state text,
  add column if not exists default_postal_code text;

-- ---- 3. Saved venues ------------------------------------------------------------
create table if not exists public.venues (
  id bigserial primary key,
  name text not null check (btrim(name) <> ''),
  street_address text,
  city text,
  state text,
  postal_code text,
  -- Null = offered to every chapter; otherwise an events.chapter name.
  chapter text,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists venues_chapter_name_key
  on public.venues (coalesce(chapter, ''), lower(btrim(name)));

alter table public.venues enable row level security;

drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues
  for select to authenticated
  using (public.has_event_admin_access());

-- can_manage_chapter is true for admins in any chapter; a null chapter
-- (all chapters) only passes the is_admin() half. A lead can only add an
-- active venue.
drop policy if exists venues_insert on public.venues;
create policy venues_insert on public.venues
  for insert to authenticated
  with check (
    public.is_admin()
    or (active and chapter is not null and public.can_manage_chapter(chapter))
  );

drop policy if exists venues_update_admin on public.venues;
create policy venues_update_admin on public.venues
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists venues_delete_admin on public.venues;
create policy venues_delete_admin on public.venues
  for delete to authenticated
  using (public.is_admin());

revoke all on public.venues from anon;
grant select, insert, update, delete on public.venues to authenticated;
grant usage, select on sequence public.venues_id_seq to authenticated;
grant all on public.venues to service_role;
grant usage, select on sequence public.venues_id_seq to service_role;

commit;

-- =============================================================================
-- 2026-09-24 — Deleting an event nobody ever registered for
-- =============================================================================
-- "Delete event" on an event's Manage page, for events that were never really
-- going to happen (typically surplus occurrences of a bulk-created series) —
-- cancelling one leaves it in the admin list and on its public page as
-- "cancelled".
--
-- The rule: an event can be deleted only if NOBODY has ever registered or
-- signed up for it — no rsvps row in any status (confirmed, waitlisted,
-- offered, cancelled, walk-up) and no volunteer_signups row in any status.
-- (The series page's admin_delete_empty_events ignored cancelled rows at
-- this point; the next entry moves it onto this same rule.) A cancelled
-- event whose attendees were all emailed a cancellation still has their
-- cancelled RSVPs, and deleting it would break the link in that email. Past
-- events follow the same rule.
--
-- 1. event_has_registrations(event_id): the rule, in one place (internal —
--    not callable from the app).
--
-- 2. admin_delete_event(event_id, include_later): deletes the event and
--    everything hanging off it, in one transaction:
--      rsvps (registrations, the waitlist and open offers are all rsvps rows)
--      volunteer_signups -> volunteer_opportunities
--      event_slug_aliases (also on delete cascade)
--    Refuses with a clear error if the caller doesn't manage it
--    (can_manage_event — admins, the chapter's lead, the event's own lead)
--    or it has registrations. With include_later, also deletes every LATER
--    occurrence of its series (any status) that the caller manages and that
--    has no registrations; the rest are left alone. Returns the deleted ids.
--    Nothing else in a series changes — a series left with one event is fine.
--
-- 3. events_delete_guard: a BEFORE DELETE trigger enforcing the same rule on
--    ANY delete of an events row (the table editor, the SQL editor, a future
--    code path) — delete an event's registrations deliberately first if you
--    ever really mean to. admin_delete_event and admin_delete_empty_events
--    remove the rows they're allowed to remove before the event, so they
--    pass it.
--
-- There's no audit-log table in this schema. Who deleted what and when is
-- recorded the same way as every other event change: the admin change
-- notification email (ADMIN_NOTIFICATION_EMAILS), sent by the app after a
-- delete.
--
-- Step 0 checks the live database for any foreign key pointing at events
-- (or at the tables deleted along with it) beyond the ones listed above.
-- events, rsvps and volunteer_opportunities were created in the dashboard
-- before this file existed, so their constraints aren't recorded here. If
-- anything unexpected references them, the whole script stops with the
-- list and nothing is applied — send it over rather than editing around it.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.

begin;

-- ---- 0. Every foreign key into events (and its child tables) is accounted for -----
do $check$
declare
  v_unexpected text;
begin
  select string_agg(
           format('%s.%s -> %s (%s)', src.relname, a.attname, tgt.relname, c.conname),
           E'\n' order by src.relname, c.conname
         )
    into v_unexpected
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_namespace srcns on srcns.oid = src.relnamespace
    join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f'
     and tgtns.nspname = 'public'
     and tgt.relname in ('events', 'rsvps', 'volunteer_opportunities', 'volunteer_signups')
     and not (srcns.nspname = 'public' and (src.relname, tgt.relname) in (
       ('rsvps', 'events'),
       ('volunteer_opportunities', 'events'),
       ('event_slug_aliases', 'events'),
       ('volunteer_signups', 'volunteer_opportunities')
     ));
  if v_unexpected is not null then
    raise exception E'Unexpected foreign keys reference events or its child tables — nothing was applied:\n%', v_unexpected;
  end if;
end $check$;

-- ---- 1. The rule -------------------------------------------------------------------
create or replace function public.event_has_registrations(p_event_id bigint)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $function$
  select exists (select 1 from public.rsvps r where r.event_id = p_event_id)
      or exists (
           select 1 from public.volunteer_signups s
             join public.volunteer_opportunities vo on vo.id = s.opportunity_id
            where vo.event_id = p_event_id
         );
$function$;

-- ---- 2. Delete ---------------------------------------------------------------------
create or replace function public.admin_delete_event(
  p_event_id bigint,
  p_include_later boolean default false
)
returns setof bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.events%rowtype;
  v_ids bigint[];
  v_id bigint;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only someone who manages this event can delete it' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  -- This event plus, if asked, the later occurrences of its series the
  -- caller manages. Locked in id order (as admin_delete_empty_events does)
  -- so a registration can't land between the check and the delete.
  v_ids := array[p_event_id];
  if p_include_later and v_event.series_id is not null then
    v_ids := v_ids || coalesce((
      select array_agg(e.id)
        from public.events e
       where e.series_id = v_event.series_id
         and e.starts_at > v_event.starts_at
         and public.can_manage_event(e.id)
    ), '{}'::bigint[]);
  end if;
  perform 1 from public.events where id = any(v_ids) order by id for update;

  if public.event_has_registrations(p_event_id) then
    raise exception 'This event has registrations or volunteer signups, so it can''t be deleted — cancel it instead'
      using errcode = '23503';
  end if;

  foreach v_id in array v_ids loop
    -- The event asked for was checked above; a later occurrence with people
    -- on it is simply left alone.
    if v_id <> p_event_id and public.event_has_registrations(v_id) then
      continue;
    end if;
    delete from public.rsvps where event_id = v_id;
    delete from public.volunteer_signups
     where opportunity_id in (select id from public.volunteer_opportunities where event_id = v_id);
    delete from public.volunteer_opportunities where event_id = v_id;
    delete from public.event_slug_aliases where event_id = v_id;
    delete from public.events where id = v_id;
    return next v_id;
  end loop;
end $function$;

-- ---- 3. Any delete, however it's made, follows the rule --------------------------
create or replace function public.events_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.event_has_registrations(old.id) then
    raise exception 'Event % has registrations or volunteer signups, so it can''t be deleted — cancel it instead', old.id
      using errcode = '23503';
  end if;
  return old;
end $function$;

drop trigger if exists events_delete_guard on public.events;
create trigger events_delete_guard
  before delete on public.events
  for each row execute function public.events_delete_guard();

-- ---- Grants ------------------------------------------------------------------------
-- Internal only (the app counts through RLS): granted to signed-in users it
-- would say whether ANY event has registrations.
revoke all on function public.event_has_registrations(bigint) from public, anon, authenticated;
grant execute on function public.event_has_registrations(bigint) to service_role;
revoke all on function public.admin_delete_event(bigint, boolean) from public, anon;
grant execute on function public.admin_delete_event(bigint, boolean) to authenticated;
revoke all on function public.events_delete_guard() from public, anon, authenticated;

commit;

-- =============================================================================
-- 2026-09-24 — One definition of an "empty" event
-- =============================================================================
-- The series page's "Delete" / "Delete all future empty occurrences"
-- (admin_delete_empty_events) now uses the same rule as the Manage page's
-- "Delete event" (admin_delete_event): an event is empty only if NOBODY has
-- ever registered or signed up — no rsvps row and no volunteer_signups row
-- in ANY status, cancelled included. Before, it counted only confirmed /
-- waitlisted / offered RSVPs and confirmed volunteer signups, so an
-- occurrence whose people had all cancelled (or that was cancelled with
-- attendees on it) could be deleted from the series page but not from its
-- own Manage page. Both now call event_has_registrations(), and the
-- events_delete_guard trigger enforces the same thing on any delete.
--
-- Otherwise unchanged: same signature and permission check (every id must
-- be one the caller manages), rows locked in id order, anything with people
-- on it is skipped rather than failing the whole call, returns the deleted
-- ids. It now also clears volunteer_signups and event_slug_aliases
-- explicitly, same as admin_delete_event (both would cascade anyway).
--
-- Needs event_has_registrations() from the "Deleting an event nobody ever
-- registered for" entry just above — run that first.

begin;

do $check$
begin
  if to_regprocedure('public.event_has_registrations(bigint)') is null then
    raise exception 'Run the "Deleting an event nobody ever registered for" SQL first — event_has_registrations() is missing. Nothing was applied.';
  end if;
end $check$;

create or replace function public.admin_delete_empty_events(p_event_ids bigint[])
returns setof bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if not public.has_event_admin_access() or exists (
    select 1 from unnest(p_event_ids) as t(id)
     where exists (select 1 from public.events e where e.id = t.id)
       and not public.can_manage_event(t.id)
  ) then
    raise exception 'Only someone who manages these events can delete them';
  end if;

  for v_id in
    select id from public.events where id = any(p_event_ids) order by id for update
  loop
    if public.event_has_registrations(v_id) then
      continue;
    end if;

    delete from public.rsvps where event_id = v_id;
    delete from public.volunteer_signups
     where opportunity_id in (select id from public.volunteer_opportunities where event_id = v_id);
    delete from public.volunteer_opportunities where event_id = v_id;
    delete from public.event_slug_aliases where event_id = v_id;
    delete from public.events where id = v_id;
    return next v_id;
  end loop;
end $function$;

revoke all on function public.admin_delete_empty_events(bigint[]) from public, anon;
grant execute on function public.admin_delete_empty_events(bigint[]) to authenticated;

commit;

-- =============================================================================
-- 2026-09-24 — Unlimited capacity: events.capacity nullable, null = no limit
-- =============================================================================
-- Creating an event with capacity left blank ("unlimited") failed with
-- 'null value in column "capacity" of relation "events" violates not-null
-- constraint'. The app has always meant NULL = unlimited (lib/event-capacity.ts,
-- and every capacity function since the 2026-09-21 "Unlimited events" and
-- "Null-safe capacity checks" entries: try_claim_event_spot,
-- offer_waitlisted_spots, admin_offer_spot, expire_excess_offers — an
-- unlimited event never waitlists anyone), but events was created in the
-- dashboard with capacity NOT NULL, so no event could actually be unlimited.
--
-- 1. events.capacity: drop NOT NULL and any default, so a missing value is
--    NULL = unlimited too — one convention, no "0 means unlimited".
--
-- 2. One rule for a capacity that IS set: at least 1 (the forms' rule,
--    capacityError). Added as events_capacity_check and
--    event_templates_default_capacity_check — but only when no existing row
--    breaks it; a row with capacity 0 or less would otherwise make every
--    later update of that event fail (even a spots_taken change from someone
--    cancelling). Any such rows are listed by the report at the end instead,
--    to be fixed by hand (set to NULL for unlimited, or a real number), after
--    which re-running this script adds the check.
--
-- Safe to re-run. One transaction: if any statement fails, nothing is
-- applied. The report after COMMIT only reads.

begin;

-- ---- 1. Nullable, no default -----------------------------------------------------
alter table public.events alter column capacity drop not null;
alter table public.events alter column capacity drop default;

-- ---- 2. A set capacity is at least 1 ---------------------------------------------
do $capacity$
begin
  if exists (select 1 from public.events where capacity < 1) then
    raise notice 'events_capacity_check not added: some events have capacity < 1 (see the report below)';
  else
    alter table public.events drop constraint if exists events_capacity_check;
    alter table public.events
      add constraint events_capacity_check check (capacity is null or capacity >= 1);
  end if;

  if exists (select 1 from public.event_templates where default_capacity < 1) then
    raise notice 'event_templates_default_capacity_check not added: some templates have default_capacity < 1';
  else
    alter table public.event_templates drop constraint if exists event_templates_default_capacity_check;
    alter table public.event_templates
      add constraint event_templates_default_capacity_check
      check (default_capacity is null or default_capacity >= 1);
  end if;
end $capacity$;

commit;

-- ---- Report (read-only) ------------------------------------------------------------
-- Everything the event forms have to satisfy on events and
-- volunteer_opportunities, plus any capacity values still outside the rule.
-- Please paste this result back — events and volunteer_opportunities were
-- created in the dashboard, so this is the only record of their constraints.
select 'capacity < 1' as kind, format('event %s "%s": capacity %s', id, name, capacity) as detail
  from public.events where capacity < 1
union all
select 'template capacity < 1', format('template %s "%s": default_capacity %s', id, name, default_capacity)
  from public.event_templates where default_capacity < 1
union all
select 'not null', format('%s.%s%s', c.table_name, c.column_name,
         case when c.column_default is not null then ' (default ' || c.column_default || ')' else '' end)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('events', 'volunteer_opportunities')
   and c.is_nullable = 'NO'
union all
select 'check', format('%s: %s', con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con
 where con.conrelid in ('public.events'::regclass, 'public.volunteer_opportunities'::regclass)
   and con.contype = 'c'
union all
select 'unique', format('%s: %s', con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con
 where con.conrelid in ('public.events'::regclass, 'public.volunteer_opportunities'::regclass)
   and con.contype in ('u', 'x')
order by 1, 2;

-- =============================================================================
-- 2026-09-24 — Rename spots_within_capacity to what it checks
-- =============================================================================
-- events.spots_within_capacity (created in the dashboard, not in this file)
-- is CHECK (spots_taken >= 0): a lower bound only, despite the name. The
-- 2026-09-24 capacity change didn't alter it — that only dropped NOT NULL and
-- the default on capacity and added events_capacity_check.
--
-- It deliberately does NOT also check spots_taken <= capacity. Two things go
-- over capacity on purpose, and that check would make both fail:
--   - Walk-ups: admin_upsert_walkup_rsvp(p_force => true) — the roster's
--     "This event is at capacity. Add them anyway?" — confirms the person
--     and raises spots_taken past capacity.
--   - Lowering capacity below the people already confirmed: the edit form
--     warns and saves anyway ("Nobody is removed") — capacity ends up below
--     spots_taken.
-- Overselling through normal RSVPs is prevented by try_claim_event_spot, the
-- one capacity gate every RSVP / offer-claim / switch path goes through.
--
-- So this only renames it, to events_spots_taken_not_negative. Guarded: it
-- renames only if the old constraint exists with exactly that definition,
-- and does nothing if it's already been renamed. Safe to re-run; one
-- transaction.

begin;

do $rename$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.events'::regclass and conname = 'spots_within_capacity';

  if v_def is null then
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.events'::regclass and conname = 'events_spots_taken_not_negative'
    ) then
      raise exception 'Neither spots_within_capacity nor events_spots_taken_not_negative exists on events — nothing was changed';
    end if;
    raise notice 'Already renamed — nothing to do';
  elsif v_def <> 'CHECK ((spots_taken >= 0))' then
    raise exception 'spots_within_capacity is now "%", not the lower-bound-only check this expects — nothing was changed', v_def;
  else
    alter table public.events
      rename constraint spots_within_capacity to events_spots_taken_not_negative;
  end if;
end $rename$;

commit;
