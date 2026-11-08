# PR-002 — Decisions
_Append-only log of the owner's answers (from Telegram). Newest at the bottom. Overrides STATUS.md._

- 2026-11-06 09:43 — Owner is giving the agent Vercel access. The Vercel CLI on this machine is logged in with access to team menugenieai-9885s-projects: use it (not the Vercel MCP) to inspect deployments and logs and to redeploy the backend. If new Upstash credentials are needed, ask the owner.

- 2026-11-07 19:08 — Q-PR002-005: b: skip the CI deploy and deploy manually with the Vercel CLI.

- 2026-11-07 19:08 — Q-PR002-004: No - do not restore Supabase for Somm (the free plan's slots go to other projects). Find a different free backend for Somm's auth, ratings and feedback (e.g. a Vercel Marketplace Postgres such as Neon, or Upstash). Recover existing data from the paused project if possible. Propose the plan as a question before switching users' auth.

- 2026-11-07 19:15 — Q-PR002-003: Resolved by the owner's session: a new free Upstash Redis (somm-ratelimit, via the Vercel Marketplace) is connected to the backend project as KV_REST_API_URL/TOKEN. server.js now prefers KV_* (commit 0ceedb6), it's deployed to prod, and the smoke test passes 4/4, including a real AI reply. Follow-ups: remove the stale UPSTASH_REDIS_REST_* env vars, add .vercel/ to .gitignore at the repo root (it was created for the CLI deploy), and move auth/ratings/feedback off Supabase per Q-PR002-004.

- 2026-11-08 17:41 — Q-PR002-006: (b) Upstash Redis only: ratings and feedback as keys with anonymous device IDs, no accounts. Skip recovering old data.

- 2026-11-08 17:43 — Q-PR002-001: (b) Owner plus 2-3 friends; keep the current daily budget/rate limits. Make the test script short and phone-friendly.
