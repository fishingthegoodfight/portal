# Backlog

## Where things stand

The portal is Fishing the Good Fight's member site (Next.js + Supabase). Participants RSVP to events, volunteers apply, register and take shifts, and leads run rosters and check-in.

**Access roles** (`profiles.role`):
- **participant:** everyone by default. RSVPs, and volunteers once approved.
- **chapter_lead:** manages events in the chapters they lead (`profiles.led_chapters`).
- **admin:** everything.

Separately, an **event lead** (`events.lead_user_id`) can manage just that one event, whatever their role. The volunteer **role types** (Fishing Instructor and so on) are not access roles.

**SQL:**
- **`schema-changes.sql`** is the full, ordered history of every database change. Each entry is dated, says what it does and why, and is marked "Run …" once it has been applied to the live database.
- **`admin-sql.sql`** isn't tracked by git. It's the scratch file for SQL waiting to be run: new SQL goes there for the user to paste into the Supabase SQL editor, and the same SQL is appended to `schema-changes.sql`. Nobody queries the live database directly.
- Project rules, including the table-grant rules and their exceptions, are in `CLAUDE.md`.

## Items, in priority order

### 1. Welcome email for walk-up accounts (top item)
**What:** send each account created by a walk-up a welcome email with a one-time set-password link.

**Why:** a walk-up for someone with no account creates one for them (`auth.admin.createUser`, email confirmed, with a random password hash nobody knows). They have an account they don't know about and can't log in to. Nine real people got accounts this way at the **Knot Just Fly Tying** event on the evening of 2026-10-05 (Denver time; 01:33–02:45 UTC on 2026-10-06).

**Decided / known:**
- **The link:** a `recovery` link from `auth.admin.generateLink`, the way `lib/actions/new-link.ts` and the invites already do it.
- **When to send:**
  - right after the walk-up, from `addWalkupRsvpAction` in `lib/actions/admin-walkup.ts`, only on the branch that creates the account;
  - once as a catch-up for the existing ones.
- **Finding the existing ones:** walk-up accounts are recognisable in `auth.users`:
  - `email_confirmed_at` within seconds of `created_at`;
  - `confirmation_sent_at` and `invited_at` both null;
  - `raw_user_meta_data` holds only `first_name` and `last_name`.
- **Until this exists:** if one of them tries to sign up, the sign-up form spots the existing email and shows "You already have an account… Use Forgot password" (`components/sign-up-form.tsx`). That's the only way they get in today.

### 2. Turn on the volunteer opportunities email
**What:** switch on the every-other-week email of open volunteer shifts. It's built and currently off.

**Why:** about 50 imported volunteers are approved but idle, and they're blocked from taking shifts until they complete volunteer registration. This email is how they hear about shifts, and it also nudges unregistered volunteers to register.

**Decided / known:**
- **Where:** Setup → Opportunities email (`app/protected/admin/setup/opportunities-email`), stored in `app_settings`:
  - `opportunities_email_enabled`
  - `opportunities_email_anchor`: Tuesday 2026-10-06
  - `opportunities_email_weekday`: 2 (Tuesday)
  It sends fortnightly from the anchor.
- **When it runs:** inside the daily `/api/cron/reminders` job (15:00 UTC, `vercel.json`). The code is `lib/volunteer-opportunities-email.ts`.
  - Registered volunteers get open roles.
  - Unregistered ones get a "finish registration" nudge instead.
  - Each run records who it has handled this cycle (`volunteers.opportunities_email_cycle`), so a run cut off by the time limit or the daily sending cap carries on over the next days.
- **Regions:**
  - Colorado: Denver and Colorado Springs chapters
  - Georgia: Atlanta and Rome chapters
- **Before turning it on:** check which chapters and regions each volunteer's email covers.

### 3. Reference reminder job has never fired
**What:** the weekly volunteer-reference reminders have never actually sent.

**Why:** it fails silently, so references sit unanswered and applications stall without anyone noticing.

**Decided / known:**
- **Where it runs:** `runReferenceReminders` (`lib/reference-reminders.ts`), called at the start of the daily `/api/cron/admin-digest` job (14:00 UTC).
- **How it fails silently:** failures are caught and only `console.error`-ed (`[reference-reminders]`), and the digest goes out anyway.
- **To do:** find out why first (the Vercel cron logs and the route's JSON `references` field are the places to look), then fix it or remove it.

### 4. Chapter directory and engagement
**What:** a per-chapter list of members with an engagement signal, so leads see who's active, who's new and who has gone quiet.

**Why:** leads have no view of their chapter's people beyond single event rosters. Attendance history already drives the volunteer application's events-attended threshold, so it's the natural source.

**Decided:**
- **Membership:** home chapter (`profiles.chapter`) decides which list someone is on.
- **Engagement:** worked out from activity, never a manual tag.
- **Drop detection:** someone who was engaged and has stopped coming triggers its own alert, separate from the list.
- **New members:**
  - flagged on their first check-in;
  - they get a two-week window for a lead to reach out.
- **Quiet members:** a tighter contact cadence than active ones.
- **Attendance counts as a touch:** checking in at an event resets the contact clock.
- **Keeping history together:** this relies on one record per person. Emails are unique and normalized in `profiles` since the 2026-10-06 "One profile per email" entry, so walk-ups and sign-ups don't split someone's history.

### 5. Change-email flow
**What:** let someone change their login email themselves.

**Why:** the email field is read-only on the profile page and the volunteer registration form, because it's the login email. Today people have to contact us to change it.

**Decided:**
- **The flow:** call `supabase.auth.updateUser({ email })`, which needs confirmation from the new address, and update `profiles.email` only once that's confirmed, so the two never drift.
- **The guard:** `profiles.email` can only be changed by `service_role` or `postgres` (the `profiles_protect_login_email` trigger; see `CLAUDE.md`). So the profile update has to happen server-side with the service role, after confirmation.
- **Uniqueness:** watch the unique index on `lower(btrim(profiles.email))` (2026-10-06 "One profile per email" entry in `schema-changes.sql`).

### 6. Attendance CSV import
**What:** import past attendance from a spreadsheet.

**Why:** attendance from before the portal, or from events not run through it, doesn't count toward anything: not the volunteer application threshold, and not engagement (item 4).

**Known:** match people by email through `lib/profile-lookup.ts`, so nobody gets a duplicate record.

### 7. Email an event's attendees
**What:** let a lead or admin send a message to everyone registered for, or who attended, an event.

**Why:** today the only emails to attendees are the automatic ones (confirmations, reminders, cancellations).

### 8. Brand restyle
**What:** apply FTGF's brand colors and typefaces across the portal.

**Why:** the portal still looks like the stock starter theme.

### 9. Resend migration
**What:** send all email through Resend from FTGF's own domain.

**Why:** a verified sending domain means better delivery than the current setup.

**Blocked until the domain transfer on 2026-11-18.** The code already supports both providers: `EMAIL_PROVIDER` (`resend` or `smtp`) and `RESEND_FROM` in `lib/email/send.ts`. Without `RESEND_FROM` it falls back to a `resend.dev` test sender. What's left is DNS verification and the environment variables.

### 10. Rename the "Chapter Program Lead" volunteer role type
**What:** give the volunteer role type a name that doesn't collide.

**Why:** "Chapter Program Lead" reads like the **chapter lead** access role, but it's just a volunteer role and grants no access.

**Known:** the role type was seeded as key `other_chapter_program_lead`, label "Other Chapter Program Lead" (2026-09-22 "Volunteer registry" entry in `schema-changes.sql`, table `volunteer_role_types`); check the live label before renaming. Change the label only. Approvals and shifts point at the role type's id, and no code refers to this key, but keys are how code identifies other role types (such as `fishing_instructor` for the practical check), so leave keys alone as a rule.
