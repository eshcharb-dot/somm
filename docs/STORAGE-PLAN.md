# Somm storage plan — Upstash Redis only (no accounts)

Decision: DECISIONS.md 2026-11-08 17:41 (Q-PR002-006 b). Supabase is dropped; old data is not recovered.

## 1. Audit: current Supabase usage

| Where | What | Fate |
|---|---|---|
| `src/js/auth.js` (whole file) | Supabase client, email/Google sign-in, reset password, JWT for the AI proxy | **Delete**. Replace with a tiny `device.js` (anonymous device ID). |
| `src/js/db.js` `saveRating` | insert `wine_ratings` | -> `POST /api/rating` |
| `db.js` `saveFeedback` | insert `feedback` | -> `POST /api/feedback` |
| `db.js` `logError` | insert `error_reports` | -> `POST /api/feedback` with `kind:"error"` (heavily capped) |
| `db.js` `saveMessage` | insert `chat_messages` (full chat backup) | **Drop**. Chat stays in localStorage only (privacy win, nothing reads it). |
| `db.js` `saveProfile` / `getProfile` | cloud profile sync across devices | **Drop**. No accounts means no cross-device sync; profile stays in localStorage. |
| `db.js` `getCrowdFavorites` | rpc `get_crowd_favorites` (is it used in the UI? verify) | Optional later: `GET /api/favorites` from a sorted set `somm:fav`. Otherwise remove. |
| `db.js` `deleteMyData` | delete user rows | -> `DELETE /api/me` (deletes the device's rating list). |
| `app.js` ~86-190, 716, 748, 906, 1254, 1305-1343, 1480-1500, 1730-1820 | auth init, syncProfileOnSignIn, authToken to /api/ai, sign-in UI, password reset | Remove; keep the guest path (it is already the default). |
| `index.html` L24, L203, `sw.js` L20-21, L52 | supabase-js CDN script, sign-in copy, SW cache + bypass | Remove script and auth modal; swap `auth.js` for `device.js` in the SW list; bump the cache version. |
| `backend/server.js` L25-50, 197-215 | `SUPABASE_*` env, `verifySupabaseUser`, error report forward | Remove; the budget becomes per-IP plus per-device. |
| `supabase/migrations`, `backend/test/costControl.test.js` | old schema, tests referencing the user budget | Keep the migrations as history; update the tests. |

## 2. Redis key schema (all keys under `somm:`)

Device ID: `crypto.randomUUID()` generated on first launch, in `localStorage["somm_device_id"]`, sent as the `X-Device-Id` header. The server validates it against `^[0-9a-f-]{36}$`.

- `somm:rating:{deviceId}` — LIST of JSON `{wine_name,type,region,grape,rating,context,price,ts}`. `LPUSH` + `LTRIM 0 499`, TTL 180 days (refreshed on write).
- `somm:feedback` — LIST of JSON `{id,deviceId,message,context,url,kind,ts}`. `LPUSH` + `LTRIM 0 1999`, no TTL (the owner reads it with `LRANGE`).
- `somm:fav` — optional ZSET, `ZINCRBY` by wine name when rating >= 4 (only if the crowd-favorites UI is kept).
- `somm:rl:{route}:{ip}` — existing `INCR` + `EXPIRE` limiter, reused.

Free-tier sizing: 500 ratings x ~300 B = ~150 KB per device at the cap, so a small beta fits easily. The per-device TTL bounds growth.

## 3. New backend endpoints (`backend/server.js`)

All use the existing `upstashIncr` rate limiter and fail closed (503) without a durable store. CORS is unchanged (GitHub Pages origin). Body limit 8 KB on these routes.

- `POST /api/rating` — body `{wine:{name,type,region,grape,price}, rating(1..5), context}`. Truncate strings to 200 chars; 30 writes/min/IP and 300/day/device.
- `POST /api/feedback` — body `{message<=2000, context<=100, url<=300, kind: "feedback"|"error"}`. 5/min/IP and 20/day/device for feedback; errors 10/day/device.
- `DELETE /api/me` — deletes `somm:rating:{deviceId}`. 5/min/IP.
- `GET /api/admin/feedback` — **skip for now**; the owner reads feedback via the Upstash console or `vercel env pull` plus curl. (Adding a token-protected admin read is a possible follow-up.)
- `/api/ai`: drop the JWT path; the budget key is `deviceId` when valid, else IP, with the existing IP cap still applied (so a device ID cannot be rotated to bypass the cost cap).

Tests (`backend/test`): validation (bad ID, oversize, bad rating), the rate limit, LTRIM behavior against a fake Upstash, and that `/api/ai` still caps per IP.

## 4. Client migration

1. Add `src/js/device.js` (`SommDevice.id()`), load it in place of `auth.js`.
2. Rewrite `db.js` with the same exported names where still used (`saveRating`, `saveFeedback`, `logError`, `deleteMyData`), now `fetch` calls to the backend, fire-and-forget. Remove the others.
3. In `app.js` remove the auth init/sign-in/sync/reset flows and the account block in the You tab. Replace it with a "Delete my data" button plus copy: "Ratings/feedback are stored anonymously; chat and profile stay on this device."
4. Update the privacy copy (`index.html`, `privacy.html`, You tab): no accounts, no Supabase.
5. Remove the supabase-js script tag; update the SW asset list and bypass; bump the cache name.
6. Run `src/js/__tests__`, the browser suites (pairing, browser-test) and the smoke test, then deploy the backend (Vercel CLI), push for Pages, and phone-check.

## 5. Order of work and risks

1. `POST /api/rating` + `/api/feedback` + tests (backend only, backwards-compatible; deploy first).
2. Client switch (single commit, deploy after the backend).
3. Cleanup: remove `SUPABASE_*` env vars from Vercel (needs care; the owner approved Supabase removal in general).

Risks: losing cross-device profile sync is intended; existing signed-in beta users silently become guests (their local data stays). Anyone can post to the endpoints, so the caps above are the abuse control; the cost exposure is just Upstash free-tier commands (10k/day), so the rate limits should stay conservative.
