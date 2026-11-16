# PR-002 — AI Sommelier · Status
_Maintained by the Conductor. Agents update this every cycle._

**Goal:** "Somm" PWA (live at https://eshcharb-dot.github.io/somm/) with Vera the AI sommelière is validated by real phone use, with feedback folded back into Vera's prompts and UX, and backend AI costs kept under control.
**Phase:** Post-build polish / awaiting real-device user test (12+ polish rounds done; latest commit "Match the Tonight greeting's question to the time of day")   **Tracker status:** Review

## Today's Goals
_Set by the Conductor 2026-11-16 09:21._
- Android passes 1-3 are live; the owner re-test is the gate (Conductor relays the link in today's brief). No Pages re-checks.
- One agent-doable step: dark-mode + prefers-reduced-motion check at 360x800 and 412x915 on the live app (screenshots to ~/.dev-browser/tmp/android/p4*). Fix only clear defects, run tests, push, verify live once.
- On relayed re-test feedback: triage via docs/FEEDBACK-TRIAGE.md, fix the top 1-2 items, run frontend tests (+ prompt-test --live if prompt-related), push, verify live.

## Next Steps
- [x] (2026-11-15) Android UI pass 1: fixed Vera tab double-padding/ragged right edge + page scroll, 44px tap targets (chips, starters, budget inputs, Find online), min 11px mono labels; 360x800 & 412x915 show 0 h-scroll, 0 small targets; tests 27/27; pushed (Pages auto-deploys). Screenshots in ~/.dev-browser/tmp/android/{before,after}-*.png; capture script output/android-capture.js.
- [x] (2026-11-15) Live Pages verified: HTTP 200, live css/app.css byte-identical to pushed src. Owner re-test + before/after screenshots (~/.dev-browser/tmp/android/{before,after}-*.png) to be relayed by owner/Conductor.
- [x] (2026-11-15) Android UI pass 2: onboarding/quiz/scan-result at 360/412/360@200% font: fixed card scales + head overflow at large fonts, 44px age-gate and privacy link; 0 h-scroll; tests 28/28; pushed. Screenshots ~/.dev-browser/tmp/android/p2{before,after}-*.png; script output/android-capture2.js.
- [x] (2026-11-15) Live Pages verified to serve pass 2 (css byte-identical, deploy success). Owner link https://eshcharb-dot.github.io/somm/ + screenshots ~/.dev-browser/tmp/android/{p2before,p2after}-*.png ready for Conductor to relay.
- [x] (2026-11-15) Android pass 3: Tonight/Scan/You at 360/412/360@200%: only defect was You-tab budget row overflowing 7px at 200% font; fixed (flex-wrap). 0 h-scroll, 0 small targets everywhere; tests pass. Screenshots ~/.dev-browser/tmp/android/p3{before,after}-*.png; script output/android-capture3.js.
- [x] (2026-11-15) Live Pages serves pass 3 css (deploy success, diff identical). Conductor to relay https://eshcharb-dot.github.io/somm/ + screenshots ~/.dev-browser/tmp/android/{p3before,p3after}-*.png to owner for re-test.
- [ ] Await owner Android re-test feedback; triage via docs/FEEDBACK-TRIAGE.md.
- [x] (2026-11-15) Audited PWA Android basics: viewport-fit=cover, 10 safe-area rules, theme-color, standalone manifest, maskable icon all present; nothing to fix.
- [x] (2026-11-16) Dark/reduced-motion check 360/412: app is light-only (no dark theme; 0 h-scroll in dark emulation); added <meta color-scheme=light> to stop Chrome forced-dark, reduced-motion now stops typing dots + slows spinner; tests 27/27; pushed 69e9764, live verified. Screenshots ~/.dev-browser/tmp/android/p4-*; script output/android-capture4.js.
- [ ] (2026-11-13) Read prod KV feedback/ratings: BLOCKED, `vercel env pull` returns KV vars empty (sensitive) and the backend has no read endpoint -> Q-PR002-008.
- [x] (2026-11-13) docs/FEEDBACK-TRIAGE.md written: feedback type -> ai.js section / file -> re-test command (frontend tests 27/27).
- [x] (2026-11-10) Precise one-question check (sentence-final ? in prose only, --samples=N); live 3x/mode: tonight [1,1,1], store [2,1,1], restaurant [1,0,1], chat [3,1,2]. Store fails 1/3, restaurant 0/3 -> below the 2-of-3 bar, prompt FROZEN until owner phone test (chat mode 2/3 over, not in scope; revisit in triage).
- [x] (2026-11-10) scheduled-health-check already targets the current alias; GitHub auto-disabled it (disabled_inactivity), cannot dispatch. Re-enabling = hourly real /api/ai call (small spend) -> Q-PR002-007.
- [x] (2026-11-10) Forwardable 3-line friend invite added at top of docs/USER-TEST.md; stale owner note on feedback storage fixed.
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
- [ ] (in progress, Android UI feedback 2026-11-15) Triage test feedback into prompt/UX fixes and iterate on Vera prompts (after owner feedback)

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

- [x] Q-PR002-007 (low): Scheduled Health Check was auto-disabled by GitHub (inactivity); re-enabling runs hourly incl. one real /api/ai call (a few hundred tokens/hr). Options: (a) leave disabled until after the beta, (b) re-enable via `gh workflow enable` during the beta. Recommend (a) — smoke-test.js can be run by hand.
- [x] Q-PR002-008 (low): Agents can't read prod KV feedback (Vercel sensitive env vars pull empty). Options: (a) you relay feedback after the phone test, (b) I add a token-guarded read-only GET /api/admin/feedback using SOMM_TOKEN and deploy. Recommend (a) until real testers exist.

## Run Log
- 2026-11-16 12:05 — No new work: DECISIONS.md unchanged (last 11-15 12:42), no relayed re-test feedback; Today's Goals done; waiting on owner Android re-test.
- 2026-11-16 11:15 — No new work: DECISIONS.md unchanged (last 11-15 12:42), no relayed re-test feedback; Android passes 1-4 live; waiting on owner re-test.
- 2026-11-16 11:05 — Dark-mode/reduced-motion check done: color-scheme light meta + reduced-motion for typing dots/spinner; pushed 69e9764, live verified; still waiting on owner Android re-test.
- 2026-11-16 04:05 — No new work: DECISIONS.md unchanged since 11-15 12:42; waiting on owner Android re-test feedback.
- 2026-11-15 21:05 — No new work: DECISIONS.md unchanged since 12:42; audited PWA/safe-area basics (all fine); waiting on owner Android re-test feedback.
- 2026-11-15 14:05 — No new work: DECISIONS.md unchanged since 12:42; Android passes 1-3 live; waiting on owner Android re-test feedback.
- 2026-11-15 13:23 — No new work: Android passes 1-3 shipped and verified live; DECISIONS.md unchanged; waiting on owner Android re-test feedback.
- 2026-11-15 13:22 — Verified live Pages serves Android pass 3 (css identical after deploy finished); ready for owner re-test.
- 2026-11-15 13:21 — Android pass 3 (Tonight/Scan/You): fixed You-tab budget row overflow at 200% font; pushed.
- 2026-11-15 13:24 — Verified live Pages serves Android pass 2 (css identical); pass 3 (Tonight/You tabs) is next.
- 2026-11-15 13:18 — Android UI pass 2 (onboarding, quiz, scan result, large-font overflow) fixed and pushed; tests 28/28.
- 2026-11-15 13:16 — Verified live Pages serves the Android pass-1 CSS (identical to pushed); pass 2 is next.
- 2026-11-15 13:05 — Android UI pass 1 (owner feedback): fixed Vera chat layout, tap targets, tiny labels; verified at 360/412, tests 27/27, pushed.
- 2026-11-15 10:05 — No new work: DECISIONS.md unchanged, Today's Goals say no cycles; Q-PR002-007/008 still open, waiting on owner phone test.
- 2026-11-15 03:05 — No new work: DECISIONS.md unchanged, Q-PR002-007/008 still open; waiting on owner phone test.
- 2026-11-14 20:05 — No new work: DECISIONS.md unchanged, Q-PR002-007/008 still open; waiting on owner phone test.
- 2026-11-14 19:30 — No new work: Pages 200, tree clean, DECISIONS unchanged; only owner phone test and Q-PR002-007/008 remain.
- 2026-11-13 12:05 — No new work: Pages 200, tree clean; only owner phone test and Q-PR002-007/008 remain.
- 2026-11-13 11:14 — No new work: Pages 200, tree clean; only owner phone test and Q-PR002-007/008 remain.
- 2026-11-13 11:05 — Wrote docs/FEEDBACK-TRIAGE.md; KV feedback unreadable by agent (env pull returns empty secrets) -> Q-PR002-008.
- 2026-11-13 04:05 — No new work: prod smoke 4/4 and Pages 200 re-verified; only owner phone test (and Q-PR002-007) remain.
- 2026-11-12 21:32 — No new work: prod smoke 4/4 and Pages 200 re-verified; only owner phone test (and Q-PR002-007) remain.
- 2026-11-12 11:09 — No new work: prod smoke 4/4 and Pages 200 re-verified; only owner phone test (and Q-PR002-007) remain.
