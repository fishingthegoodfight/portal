# Backlog

- **Change login email from the profile page.** The email field is read-only (it's the login email) and people contact us to change it. A self-service flow would call `supabase.auth.updateUser({ email })`, which needs confirmation from the new address, and update `profiles.email` only once that's confirmed, so the two never drift. Mind the unique index on `lower(btrim(profiles.email))` (2026-10-06 "One profile per email" entry in `schema-changes.sql`).
