# PR-002 — AI Sommelier · Status
_Maintained by the Conductor. Agents update this every cycle._

**Goal:** "Somm" PWA (live at https://eshcharb-dot.github.io/somm/) with Vera the AI sommelière is validated by real phone use, with feedback folded back into Vera's prompts and UX, and backend AI costs kept under control.
**Phase:** Post-build polish / awaiting real-device user test (12+ polish rounds done; latest commit "Match the Tonight greeting's question to the time of day")   **Tracker status:** Review

## Today's Goals
- Root-cause why `deploy-backend.yml` fails on every push since 2026-07-03: re-run the workflow (`gh run rerun`) to get fresh logs, fix if it is config/secret-name drift; use the Vercel CLI per DECISIONS, not the MCP.
- Prototype (branch only, not deployed) a fail-closed-safe fallback so /api/ai can run without Upstash (small in-memory per-instance limiter + existing daily budget cap); write the cost-risk trade-off into Q-PR002-003 as option (b).
- Close Q-PR002-002 as superseded by Q-PR002-003. Then stop: remaining items need the owner — do not log idle hourly checks.

## Next Steps
- [x] Root-caused `deploy-backend.yml` CI failure (2026-11-07): fresh workflow_dispatch run 42354062954 fails at `vercel pull` — repo secrets VERCEL_TOKEN/VERCEL_ORG_ID/VERCEL_PROJECT_ID are empty/missing (`gh secret list` is empty). Needs owner: Q-PR002-005.
- [x] (2026-11-07) Branch-only prototype `proto/no-upstash-fallback` (commit fb41b87, not pushed/deployed): opt-in env ALLOW_DEGRADED_LIMITER=1 lets serverless use per-instance in-memory limiter with daily budgets x0.25; default stays fail-closed. 24/24 backend tests pass. Added as option (b) to Q-PR002-003.
- [x] (resolved 2026-11-07 by owner session; KV_* live, smoke 4/4; stale UPSTASH_* env vars removed 2026-11-08) restore prod /api/ai (503 "Rate limiting temporarily unavailable") — check Upstash env vars on Vercel project `backend` and why `deploy-backend.yml` fails on every push since 2026-07-03 (logs expired; re-run workflow or use `vercel logs` CLI); re-run smoke test after fix. Also scheduled-health-check last ran 2026-09-03 (stale?)
- [x] Browser suites run 2026-11-06: pairing-test OK; browser-test OK after fixing stale steps (age-gate checkbox, removed #set-key). Note: tests need a clean localStorage (dev-browser profile persists) and `--timeout 200`
- [x] Fix stale docs (done 2026-11-06): `docs/PRODUCT.md` still describes user-supplied key in Settings, direct-from-browser Claude calls and model `claude-opus-4-8`; README says "no backend" in Architecture but the backend proxy exists. Align both with the current backend-proxy architecture and the actual model in `backend/server.js`
- [x] Reviewed Vera's prompt vs persona (aligned: short texts, one question, no snobbery, <=120 words, max 3 cards); added `output/prompt-test.js` (offline: 39 checks across 4 modes pass; `--live` runs sample chats once /api/ai is restored). Note: `output/` is gitignored, so the script is local only
- [x] Drafted `docs/USER-TEST.md` (script + feedback template). End-to-end feedback check NOT done: Supabase project `somm` is INACTIVE (paused), see Q-PR002-004
- [x] (2026-11-08) Q-PR002-001 answered (b): rewrote docs/USER-TEST.md as a 5-min, 6-step phone test.
- [x] (2026-11-08) Q-PR002-006 approved (b): audited Supabase usage and wrote docs/STORAGE-PLAN.md (key schema, endpoints, client migration)
- [x] (2026-11-08) Implemented backend POST /api/rating, /api/feedback, DELETE /api/me (KV, size caps, rate limits) + backend/test/storage.test.js; 31/31 tests pass. NOT yet deployed.
- [x] (2026-11-08) Deployed backend via Vercel CLI (prod, alias backend-nu-ashen-76); smoke-test.js 4/4 and manual /api/rating, /api/feedback, DELETE /api/me OK on prod KV (one 'smoke test, ignore' feedback entry left in KV)
- [x] (2026-11-08) Client switched: new js/device.js (device ID + SommAuth guest shim), db.js -> backend endpoints (verified against prod from node: feedback/rating/delete ok), sign-in UI entry points removed, supabase script dropped, SW list updated. Committed locally, NOT pushed yet.
- [x] (2026-11-08) Browser-verified client (clear localStorage first; browser-test.js passes, only file:// CORS/SW console noise) and pushed c341c57 to Pages. TODO: re-check on live https URL once Pages rebuilds
- [x] (2026-11-08) Cleaned dead auth code (modal HTML/JS, sign-in nudge, supabase refs), rewrote privacy.html for anonymous device-ID storage; browser-test passes. Left: unused .auth-* CSS, backend verifySupabaseUser (harmless).
- [x] (2026-11-08) Live Pages re-checked via HTTP: index/device.js/db.js/privacy 200, no supabase refs, db.js uses backend endpoints, CORS preflight 204. Full in-browser console check not done.
- [x] (2026-11-08) Live in-browser check of Pages: no page errors; found FX API api.frankfurter.app now 301s without CORS (live rates silently failing) -> switched to api.frankfurter.dev/v1, pushed 0bd5a30.
- [x] (2026-11-08) Removed unused .auth-*/.google-btn CSS from app.css (braces balanced), pushed 537bfb5.
- [ ] Run the phone test on a real device with the live app (needs owner)
- [x] (2026-11-08) Live prompt-test showed 2-question replies in ~2/3 store runs; tightened ai.js rule to "at most ONE question per reply" (pushed 1cbeba1). Live samples still noisy (heuristic counts any ?): re-sample after owner test.
- [ ] Triage test feedback into prompt/UX fixes and iterate on Vera prompts (after owner feedback)

## Blockers
- (Vercel MCP 403 note is obsolete; Vercel CLI works.)
- Vercel MCP returns 403 for team menugenieai-9885s-projects (owner must approve authorize_team_access) so env vars/deploy logs are unreadable; GitHub Actions logs expired (410). Prod /api/ai fix needs owner (Q-PR002-002).
- Real-device user test and feedback require the owner (no agent access to a phone).

## Open Questions
- [x] Q-PR002-006 (normal): Supabase replacement for auth/ratings/feedback. Options: (a) Neon Postgres via Vercel Marketplace + own simple auth endpoints in backend, (b) Upstash Redis only (ratings/feedback as keys, anonymous device IDs, drop accounts). Recovering old data needs a temporary restore, which you vetoed — OK to skip recovery? Recommend (b) + skip recovery for a small beta; (a) if accounts matter.
- [x] Q-PR002-001 (normal): Who runs the phone test and when? Options: (a) owner tests alone with the script in docs/USER-TEST.md, (b) owner plus 2-3 friends/wine-casual users. Recommendation: (b), as the app targets people with no wine knowledge. Also note: AI is free for all users via the backend proxy — OK to keep the current daily budget/rate limits during testing?
- [x] (superseded by Q-PR002-003, 2026-11-07) Q-PR002-002 (urgent): Live Somm AI (chat/scan) returns 503 — Upstash Redis creds likely missing/expired on Vercel project `backend`, and Deploy Backend CI fails. Can you re-issue UPSTASH_REDIS_REST_URL/TOKEN (free tier fine) and set them in Vercel, or approve me doing it? Recommend: you re-issue and paste into Vercel env, then I redeploy and re-run the smoke test.

- [x] Q-PR002-003 (urgent): Root cause of /api/ai 503 found via Vercel CLI: env vars exist but Upstash host stable-peacock-69238.upstash.io no longer resolves (NXDOMAIN) — the free DB was deleted (inactivity). Can you create a new free Upstash Redis DB (console.upstash.com) and give me the REST URL + token? I then set them on Vercel `backend`, redeploy, re-run smoke test. Recommend: yes. **Option (b)** if you don't want to create a DB: I deploy branch `proto/no-upstash-fallback` with ALLOW_DEGRADED_LIMITER=1 — per-instance in-memory limits, NOT a global cap; worst-case spend = concurrent instances x (25k tokens/IP/day anon, 37.5k/user), so a distributed abuser could exceed the intended cap; fine for a small beta, weak against abuse. Reply "a" (new Upstash) or "b" (degraded).

- [x] Q-PR002-004 (urgent): Supabase project `somm` (lnrkstvkbpgjfjdwfgik) is INACTIVE/paused, so auth, ratings and in-app feedback are down for real users. OK for me to restore it (free tier, no cost expected)? Recommend: yes.

- [x] Q-PR002-005 (normal): Deploy Backend CI fails because GitHub repo secrets VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID are not set. Options: (a) you create a Vercel token (vercel.com/account/tokens) and I set all three via `gh secret set`; (b) skip CI deploy and keep deploying manually via Vercel CLI. Recommend (b) for now — low value until Q-PR002-003 is resolved.

## Run Log
- 2026-11-08 21:05 — Re-sampled live Vera after the 1cbeba1 rule: store/restaurant modes still sometimes show 2 questions (heuristic counts any '?', noisy); no more prompt churn, fold into owner-test triage.
- 2026-11-08 20:06 — Live-sampled Vera (store asked 2 questions in 2/3 runs); hardened ai.js one-question rule, frontend tests 27/27, pushed 1cbeba1; waiting on owner phone test.
- 2026-11-08 20:05 — Fixed live Vera prompt test harness (AbortController/fetch globals); live run vs prod: replies on-persona, store mode once asked 2 questions (single sample, fold into feedback triage).
- 2026-11-08 19:08 — Prod backend smoke test 4/4 re-verified; nothing else agent-doable, waiting on owner phone test.
- 2026-11-08 19:07 — Removed dead auth-modal CSS (40 lines) from app.css, pushed 537bfb5; remaining items need the owner (phone test).
- 2026-11-08 19:05 — Live browser check of Pages clean except dead FX endpoint (301, no CORS); fixed to frankfurter.dev, node-checked, pushed 0bd5a30.
- 2026-11-08 18:26 — Verified live Pages serves migrated client (200s, no Supabase refs, CORS preflight OK); only the owner phone test remains.
- 2026-11-08 18:24 — Removed dead Supabase auth code from client, updated privacy copy; browser-test passes; pushed 472bb42.
- 2026-11-08 18:30 — Browser-verified migrated client (browser-test passes; console errors only file:// artifacts) and pushed to GitHub Pages.
- 2026-11-08 18:17 — Migrated client off Supabase to anonymous device ID + backend endpoints (device.js, db.js, app.js You tab); node-checked, prod API calls OK; committed locally, push pending browser verification.
- 2026-11-08 18:14 — Deployed backend with new storage endpoints to prod via Vercel CLI; smoke 4/4 + manual endpoint checks pass.
- 2026-11-08 18:25 — Implemented /api/rating, /api/feedback, DELETE /api/me + storage tests (31/31 pass); committed, not yet deployed.
- 2026-11-08 18:08 — Audited Supabase usage; wrote docs/STORAGE-PLAN.md (Upstash keys, /api/rating|feedback|me, client migration order).
- 2026-11-08 18:05 — Acted on Q-001/006 answers: shortened USER-TEST.md to 5-min phone script; queued Upstash-only storage migration (plan, endpoints, client switch).
- 2026-11-08 06:53 — Removed stale UPSTASH_* Vercel env vars, gitignored .vercel/, added Q-PR002-006 (Supabase replacement plan).
- 2026-11-07 10:09 — Prototyped opt-in no-Upstash degraded limiter on branch proto/no-upstash-fallback (tests 24/24); added option (b) to Q-PR002-003. Remaining items need owner.
- 2026-11-07 10:05 — Root-caused Deploy Backend CI failure (empty Vercel secrets in GitHub repo, Q-PR002-005). Old run not rerunnable; dispatched fresh run.
- 2026-11-06 19:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 18:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 17:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 16:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 15:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 14:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 13:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; waiting on owner.
- 2026-11-06 12:05 — No actionable step: DECISIONS.md unchanged, Q-PR002-001/003/004 still open; all remaining items need the owner.
- 2026-11-06 11:10 — No actionable step: all remaining items need the owner (Q-PR002-001/003/004 open, no new DECISIONS). Supabase `somm` re-checked: still INACTIVE.
- 2026-11-06 11:20 — Drafted docs/USER-TEST.md; found Supabase project `somm` paused (Q-PR002-004).
- 2026-11-06 11:05 — Reviewed Vera prompt vs persona (aligned); added output/prompt-test.js (offline 39/39 pass; --live ready once /api/ai is back).
