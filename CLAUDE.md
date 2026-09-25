@AGENTS.md

# Database: every new table in `public` ships with its own GRANTs

From **2026-10-30**, Supabase stops giving new tables in the `public` schema Data API grants automatically. A table created on or after that date can't be reached through supabase-js/PostgREST until it's granted explicitly, and the failure looks like a permissions error ("permission denied for table …"), not a missing grant. So:

**Any SQL script that creates a table in `public` includes that table's GRANT statements in the same script, right after the `CREATE TABLE`, next to its `ENABLE ROW LEVEL SECURITY` and policies.** Grants are table-level and RLS is row-level. A role needs both: the grant to touch the table at all, and a policy to see or change any row. Write them together so they agree:

- **service_role:** full access. `grant all on public.<table> to service_role;`
- **authenticated:** only the operations its RLS policies actually allow. A table with only a `for select` policy gets `grant select`. One with select/insert/update/delete policies gets all four. Never grant an operation that no policy permits, and never write a policy for an operation that isn't granted.
- **anon:** nothing by default. Start with `revoke all on public.<table> from anon;`. Grant to anon only where logged-out visitors are deliberately meant to see data. Even then, prefer a column-level grant (`grant select (col_a, col_b) on …`) over the whole table, as `events` does for the public event pages (the 2026-09-23 "Public event pages" entry in `schema-changes.sql`). That way a column added later isn't exposed by accident.
- **Sequences:** a `bigserial`/identity column's sequence needs `grant usage, select on sequence public.<table>_id_seq` for every role that inserts, usually authenticated and service_role.

`venues` (the 2026-09-24 "Saved venues" entry in `schema-changes.sql`) follows this shape: RLS enabled, one policy per operation, then `revoke all … from anon`, grants to authenticated that match those policies, sequence grants, and `grant all` to service_role.

**Deliberate exception: `health_access_log`** (the 2026-09-25 "Sensitive-data flags, health access log…" entry in `schema-changes.sql`). service_role gets `select, insert` only, not `grant all`, and a trigger blocks UPDATE, DELETE and TRUNCATE for everyone, the table owner included. An audit log that nobody can alter is the whole point of that table. Don't "correct" it back to the standard grants, and don't add an update or delete policy. Writes go only through `log_health_access()`.

This applies only to tables created from 2026-10-30 onward. Don't go back and add grants to existing tables. They keep the grants they already have, and changing them isn't part of this rule.

SQL still goes in a fresh `admin-sql.sql` for the user to run, and is appended to `schema-changes.sql`.
