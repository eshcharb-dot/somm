-- Row Level Security for public.profiles
--
-- Written from the browser with the anon key (src/js/db.js#saveProfile/getProfile).
-- The primary key IS the user id, so policies compare directly against `id` rather than
-- a separate user_id column.
--
-- Schema assumed (inferred from src/js/db.js#saveProfile — confirm against the live
-- schema before relying on this blindly):
--   profiles(id uuid primary key references auth.users, display_name text, currency text,
--     palate jsonb, confidence numeric, adventurousness numeric, ratings_count int,
--     updated_at timestamptz default now())

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Required by the "Delete my cloud data" control (src/js/db.js#deleteMyData).
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (auth.uid() = id);

-- NOTE: get_crowd_favorites() (called from src/js/db.js#getCrowdFavorites) reads across
-- all users' data to build an aggregate. If it's a SECURITY DEFINER function it legitimately
-- bypasses these policies by design — verify it only returns aggregated/anonymized fields
-- (no user_id, no per-user rows) so it can't be used to enumerate other users' profiles.
