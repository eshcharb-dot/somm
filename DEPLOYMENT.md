# Somm Backend Deployment Guide

The Somm app now uses a **backend proxy** to serve AI to all users without needing API keys. Here's how to deploy it.

## Architecture

```
User Browser (GitHub Pages)
    ↓
Frontend (calls /api/ai endpoint)
    ↓
Backend Server (Express)
    ↓
Claude / Groq API (your paid key, kept secret)
```

## Auto-deploy (recommended — keeps production from drifting behind the repo)

`.github/workflows/deploy-backend.yml` deploys `backend/` to Vercel automatically on every push
to `main` that touches `backend/`: it runs the backend test suite as a pre-deploy gate, deploys,
then runs `backend/scripts/smoke-test.js` against the **live** deployment (checks that a request
with no shared token is rejected 403/503, and that a cross-origin CORS preflight is blocked) —
so a stale or misconfigured deploy fails the workflow loudly instead of silently running in
production for weeks (which is what happened before this existed).

One-time setup:

1. `cd backend && vercel link` (creates `backend/.vercel/project.json` — not committed, see
   `.gitignore`) and note the `orgId`/`projectId` it prints.
2. In the GitHub repo, add these under **Settings → Secrets and variables → Actions**:
   - `VERCEL_TOKEN` — from https://vercel.com/account/tokens
   - `VERCEL_ORG_ID` — from step 1
   - `VERCEL_PROJECT_ID` — from step 1
3. Set the backend env vars (below) directly in the Vercel project dashboard — they're never
   read from the repo/CI.

After that, every push to `main` touching `backend/` redeploys automatically. You can also
trigger it manually from the Actions tab (`workflow_dispatch`).

`.github/workflows/deploy-frontend.yml` does the same for `src/`, and additionally stamps
`src/sw.js`'s `CACHE_NAME` with the deploying commit SHA before publish (see the "Stamp service
worker cache with build SHA" step). This is load-bearing: a service worker's bytes must change
for the browser to re-run install/activate at all, so if `CACHE_NAME` ever stops changing on
deploy, already-installed users silently freeze on old cached JS/CSS with no error and no way to
tell. **CI checklist — if you ever touch `src/sw.js` or the deploy workflow:**
- `CACHE_NAME` in `src/sw.js` must still contain the literal `__BUILD_ID__` placeholder (the
  stamp step's `grep -q` guard fails the build if it's missing).
- Don't reintroduce a hardcoded cache name — the whole point is that it changes every deploy
  without a human remembering to bump it.
- After deploying, confirm in devtools (Application → Service Workers) that a new SW installs
  and the old cache is evicted, on a browser tab that already had the app installed pre-deploy.

## Option 1: Manual deploy to Vercel (initial setup, or if you're not using the GitHub Action)

Vercel handles Node.js backends and free tier has enough capacity for a small app.

### Step 1: Push backend to GitHub

```bash
# From backend/ directory
cd backend
git init
git add .
git commit -m "Initial Somm backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/somm-backend.git
git push -u origin main
```

### Step 2: Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

When prompted:
- **Project name:** `somm-backend`
- **Framework:** `Other`
- **Root directory:** `backend`
- **Build:** leave blank (no build needed)
- **Environment variables:** Add these:
  - `ANTHROPIC_API_KEY` → your Claude key from console.anthropic.com
  - (optional) `GROQ_API_KEY` → free Groq key from console.groq.com

### Step 3: Update frontend backend URL

In `src/js/ai.js`, change:

```javascript
const BACKEND_URL = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://somm-backend.vercel.app"; // ← your Vercel URL
```

Then redeploy frontend:

```bash
git add src/js/ai.js
git commit -m "Update backend URL to Vercel"
git subtree push --prefix src origin gh-pages
```

## Option 2: Deploy to Railway (free tier, 5GB/month)

1. Go to railway.app → Login
2. New Project → Deploy from GitHub
3. Select `somm-backend` repo
4. Add environment variables (same as Vercel above)
5. Deploy

Then update frontend `BACKEND_URL` to your Railway URL.

## Option 3: Deploy to Fly.io (free tier, 3 shared-cpu-1x)

```bash
npm install -g flyctl
flyctl auth login
flyctl launch --name somm-backend
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-...
flyctl deploy
```

Then update frontend `BACKEND_URL` to your Fly URL.

## Option 4: Local development (test before deploy)

```bash
cd backend
cp .env.example .env
# Edit .env and add your API keys
npm start
```

Then in frontend, `BACKEND_URL` is already `http://localhost:3000`.

## Testing

1. Start backend locally or deploy to Vercel/Railway/Fly
2. Open frontend at https://eshcharb-dot.github.io/somm/
3. Go to Vera tab → ask a question
4. Check backend logs for requests (no API key exposed)

### Automated tests

- `cd backend && npm test` — runs the cost-control test suite (`backend/test/`): rate
  limiting, daily token budgets, and Supabase JWT verification, including the in-memory,
  Upstash-backed, and fail-closed-serverless code paths, plus an integration check of
  `/api/ai`'s fail-closed behavior over real HTTP.
- `node --test "src/js/__tests__/*.test.js"` — the frontend suite (27 tests: quiz→profile
  logic, rating learning, wine-card/scan-result parsing).
- Both run in CI on every push/PR via `.github/workflows/ci.yml`.
- `node backend/scripts/smoke-test.js <url>` — post-deploy smoke test against a **live**
  backend URL (used automatically by `deploy-backend.yml`, see above): confirms a request
  without the shared token is rejected and that cross-origin CORS is blocked.

## Security Notes

- **API keys are NEVER sent to the frontend** — only the backend has them
- **Backend enforces rate limiting** (100 req/min per IP, hard-required via Upstash Redis
  in production — see required env vars below) to prevent abuse
- **All requests are proxied** — users can't see or intercept API calls
- **Logs may contain user messages** — be careful with sensitive data
- **Supabase tables are RLS-scoped to `auth.uid()`** — the client uses only the public
  anon key, so Row Level Security is the only thing stopping one user from reading/writing
  another user's rows. Policies are checked into `supabase/migrations/` (not just the live
  dashboard) — see `supabase/migrations/README.md`. Apply them and re-run the Supabase
  security advisors before going live, and again after any schema change.

### Required backend env vars (fail-closed — the API refuses requests without these)

- `ANTHROPIC_API_KEY` and/or `GROQ_API_KEY` — at least one AI provider
- `SOMM_TOKEN` — shared secret checked against the client's `x-somm-token` header;
  requests are now **rejected** if this is unset, rather than silently allowed through
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — durable, cross-instance rate
  limiting and per-day token budget enforcement. Required in production (Vercel); without
  them the backend refuses requests instead of silently falling back to a per-instance
  in-memory limiter that doesn't actually cap anything on serverless
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — optional but recommended: lets the backend verify
  a signed-in user's session JWT (sent as `Authorization: Bearer <token>` by the client) so
  abuse budgets can be scoped per-account instead of only per-IP

## Troubleshooting

**"Can't reach AI backend"** → 
- Check BACKEND_URL in `ai.js` is correct
- Verify backend is running (`curl https://your-backend-url/health`)
- Check API keys are set in environment variables

**"Rate limited"** →
- Backend limits 100 requests/minute per IP
- Wait 60 seconds or restart backend

**High costs** →
- Monitor API usage via console.anthropic.com
- Add stricter rate limits in `server.js`
- Switch to Groq (free tier) as primary provider

## Future Improvements

- [x] Redis-based rate limiting (Upstash, required in production — see Security Notes)
- [x] Per-user/day token budget, scoped by verified Supabase session JWT when present
- [x] Git-based auto-deploy + post-deploy smoke test (see "Auto-deploy" above) so a stale/
      insecure deployment can't silently persist
- [x] Automated test coverage for the cost-control logic (rate limit / daily budget / JWT
      verification), wired into CI alongside the frontend suite
- [ ] Full backend enforcement that EVERY request carries a verified Supabase JWT (currently
      the JWT strengthens the abuse budget when present; anonymous/guest use is still
      allowed via the shared `SOMM_TOKEN`, matching the app's guest-mode UX)
- [ ] Caching common wine questions
- [ ] Usage analytics dashboard
- [ ] Multi-provider failover (Claude → Groq if Claude fails)
- [ ] Streaming responses for faster perceived UX
