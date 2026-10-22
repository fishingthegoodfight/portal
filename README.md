# Fishing the Good Fight portal

The member site for Fishing the Good Fight: participants RSVP to events, volunteers apply, register and take shifts, and chapter leads run rosters, check-in and outreach. Built with Next.js and Supabase, deployed on Vercel.

- **What's built and what's next:** `BACKLOG.md`
- **Project rules** (database grants, SQL workflow): `CLAUDE.md`
- **Database history:** `schema-changes.sql`, every change in order, dated

## Running locally

1. Copy `.env.example` to `.env.local` and fill it in (Supabase keys, email provider, `CRON_SECRET`).
2. `npm install`
3. `npm run dev`, then open http://localhost:3000

Dev runs against the live database and sends real email, so test with your own address.
