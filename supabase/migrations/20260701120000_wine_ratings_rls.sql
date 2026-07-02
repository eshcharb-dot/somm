-- Row Level Security for public.wine_ratings
--
-- Client code (src/js/db.js, src/js/auth.js) reads/writes this table using only the
-- public anon key — RLS is the ONLY thing standing between "signed-in user" and "any
-- other signed-in user's wine ratings." Without policies like these, RLS-disabled tables
-- are readable/writable by anyone holding the anon key (which ships in the client bundle).
--
-- Schema assumed (inferred from src/js/db.js#saveRating — confirm against the live schema
-- with `select column_name, data_type from information_schema.columns where table_name =
-- 'wine_ratings'` before relying on this blindly, since no prior migrations were checked in):
--   wine_ratings(id, user_id uuid references auth.users, wine_name text, wine_type text,
--     wine_region text, wine_grape text, wine_attrs jsonb, rating text, context text,
--     food_pairing text, price jsonb, created_at timestamptz default now())

alter table public.wine_ratings enable row level security;

drop policy if exists "wine_ratings_select_own" on public.wine_ratings;
create policy "wine_ratings_select_own"
  on public.wine_ratings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "wine_ratings_insert_own" on public.wine_ratings;
create policy "wine_ratings_insert_own"
  on public.wine_ratings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "wine_ratings_update_own" on public.wine_ratings;
create policy "wine_ratings_update_own"
  on public.wine_ratings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Required by the "Delete my cloud data" control (src/js/db.js#deleteMyData) —
-- without a delete policy, that button silently no-ops instead of deleting anything.
drop policy if exists "wine_ratings_delete_own" on public.wine_ratings;
create policy "wine_ratings_delete_own"
  on public.wine_ratings for delete
  to authenticated
  using (auth.uid() = user_id);
