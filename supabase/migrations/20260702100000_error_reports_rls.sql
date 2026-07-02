-- Row Level Security for public.error_reports
--
-- Written from both the browser (src/js/db.js#logError, using the public anon key) and the
-- backend (backend/server.js#logBackendError, also using the anon key rather than a service
-- role key) — same anon-key exposure as wine_ratings/chat_messages/profiles/feedback, so RLS
-- is the only thing standing between "anyone holding the anon key" and this table's contents
-- (which include user_id and raw stack traces — a read/delete hole here is an account
-- enumeration / info-leak risk, not just spam).
--
-- Unlike the other migrations in this folder, this one was NOT authored blind from client
-- code alone: it was cross-checked against the live `somm` Supabase project (2026-07-02) via
-- `list_policies`/`pg_policies` and `pg_class.relrowsecurity`, since a Lead Engineer static
-- review (this file was missing) and a PM live-advisor check disagreed about whether this
-- table was locked down. Findings: RLS IS enabled on the live table, and the only policy
-- present is an insert-only policy (`error_reports_insert_any`, `with check (true)`, anon +
-- authenticated) — no select/update/delete policy exists, so those are correctly denied by
-- default. The permissive INSERT is flagged WARN by the Supabase advisor but is intentional
-- (same as feedback: needs to accept reports from signed-out guests, and the payload has no
-- sensitive fields an attacker controls beyond their own error text). This file codifies that
-- live state so it's auditable and reproducible instead of only existing as out-of-band DB
-- state.
--
-- Schema (confirmed live via information_schema.columns, not just inferred):
--   error_reports(id uuid primary key default gen_random_uuid(), created_at timestamptz not
--     null default now(), user_id uuid references auth.users null, source text not null,
--     context text, message text not null, stack text, url text)

alter table public.error_reports enable row level security;

-- Anyone (including anon/guest sessions, and the backend proxy using the anon key) can file an
-- error report, but never scoped to read/update/delete — this is a write-only inbox from the
-- client's point of view, same as `feedback`. Reading it is a maintainer task done via the
-- Supabase dashboard/service-role key, not the client's anon key.
drop policy if exists "error_reports_insert_any" on public.error_reports;
create policy "error_reports_insert_any"
  on public.error_reports for insert
  to anon, authenticated
  with check (true);

-- No select/update/delete policies on purpose (verified: none exist live either) — with RLS
-- enabled and no policy for those commands, anon/authenticated are denied by default. Do not
-- add a permissive `using (true)` select policy here; that would turn this into exactly the
-- account-enumeration hole (stack traces + user_id, readable by anyone with the anon key) the
-- static review was worried about.
