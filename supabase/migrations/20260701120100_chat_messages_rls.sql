-- Row Level Security for public.chat_messages
--
-- Same rationale as 20260701120000_wine_ratings_rls.sql: this table is written directly
-- from the browser with the anon key (src/js/db.js#saveMessage), so RLS is the only
-- boundary preventing one signed-in user from reading or deleting another user's chat
-- history with Vera.
--
-- Schema assumed (inferred from src/js/db.js#saveMessage — confirm against the live
-- schema before relying on this blindly):
--   chat_messages(id, user_id uuid references auth.users, role text, content text,
--     context text, wine_cards jsonb, created_at timestamptz default now())

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own"
  on public.chat_messages for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Required by the "Delete my cloud data" control (src/js/db.js#deleteMyData).
drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages for delete
  to authenticated
  using (auth.uid() = user_id);
