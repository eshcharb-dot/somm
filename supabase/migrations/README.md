# Supabase RLS migrations

These files codify the Row Level Security policies every user-scoped table (`wine_ratings`,
`chat_messages`, `profiles`, `feedback`, `error_reports`) needs, since the client
(`src/js/auth.js`, `src/js/db.js`) — and, for `error_reports`, `backend/server.js` too — talk
to Supabase directly with the public anon key. RLS is the only thing stopping one signed-in
user from reading/writing another user's data through that same key.

Most of these were authored from the columns the app's client code actually writes (see the
comments in each file), **not** pulled from a live introspection of the project, because the
`somm` Supabase project was paused/inactive when these were written. `error_reports` is the
exception: it was cross-checked against the live project on 2026-07-02 after a static review
(no migration file existed for it) and a live advisor check (reported RLS enabled with only a
WARN-level permissive INSERT policy) disagreed about its exposure. The live check was
confirmed correct — RLS is enabled and only an insert policy exists, so select/update/delete
are denied by default — and `20260702100000_error_reports_rls.sql` now codifies that so it's
reproducible instead of only existing as out-of-band DB state. Before applying the others:

1. Confirm the actual column names/types match what's assumed in each file (e.g. via the
   Supabase SQL editor: `select column_name, data_type from information_schema.columns
   where table_name = 'wine_ratings';` and same for `chat_messages` / `profiles`), and
   adjust the migrations if they differ.
2. Apply them (Supabase CLI: `supabase db push`, or paste each file into the SQL editor in
   order).
3. Run the project's security advisors (Supabase dashboard → Advisors → Security, or the
   `get_advisors` MCP tool) and confirm no "RLS disabled" / "policy missing" warnings remain
   for these tables.
4. Re-run after any schema change to these tables — a new column doesn't get RLS coverage
   for free, and forgetting a `with check` clause on `insert`/`update` lets a user attach
   rows to someone else's `user_id`.

This is now part of the standard setup/deploy checklist for this project — see
`DEPLOYMENT.md`.
