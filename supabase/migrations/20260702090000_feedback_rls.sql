-- Row Level Security for public.feedback
--
-- Backs the in-app "Something off? Tell Vera" beta feedback channel (src/js/db.js#saveFeedback,
-- wired up from the You tab and the scan-result error screen in src/js/app.js). Distinct from
-- error_reports (crashes the app noticed on its own) — this is user-initiated free-text reports,
-- and needs to work for signed-out guests too, so it's insert-only for everyone rather than
-- scoped to auth.uid() like wine_ratings/chat_messages/profiles.
--
-- Schema assumed (inferred from src/js/db.js#saveFeedback — confirm against the live schema
-- before relying on this blindly, same caveat as the other migrations in this folder):
--   feedback(id, user_id uuid references auth.users null, message text, context text,
--     url text, created_at timestamptz default now())
--
-- Create the table first if it doesn't exist yet, e.g.:
--   create table public.feedback (
--     id uuid primary key default gen_random_uuid(),
--     user_id uuid references auth.users,
--     message text not null,
--     context text,
--     url text,
--     created_at timestamptz not null default now()
--   );

alter table public.feedback enable row level security;

-- Anyone (including anon/guest sessions) can file feedback, but never on someone else's behalf —
-- user_id must either be null (guest) or match the caller's own auth.uid().
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone"
  on public.feedback for insert
  to anon, authenticated
  with check (user_id is null or auth.uid() = user_id);

-- No select/update/delete policies on purpose — this is a write-only inbox from the client's
-- point of view (like error_reports). Reading it is a maintainer task done via the Supabase
-- dashboard/service-role key, not the client's anon key.
