# PR-002 — AI Sommelier · Status
_Maintained by the Conductor. Agents update this every cycle._

**Goal:** "Somm" PWA (live at https://eshcharb-dot.github.io/somm/) with Vera the AI sommelière is validated by real phone use, with feedback folded back into Vera's prompts and UX, and backend AI costs kept under control.
**Phase:** Post-build polish / awaiting real-device user test (12+ polish rounds done; latest commit "Match the Tonight greeting's question to the time of day")   **Tracker status:** Review

## Today's Goals
- (set by the Conductor each morning)

## Next Steps
- [ ] URGENT (BLOCKED on Q-PR002-003: needs new Upstash DB): restore prod /api/ai (503 "Rate limiting temporarily unavailable") — check Upstash env vars on Vercel project `backend` and why `deploy-backend.yml` fails on every push since 2026-07-03 (logs expired; re-run workflow or use `vercel logs` CLI); re-run smoke test after fix. Also scheduled-health-check last ran 2026-09-03 (stale?)
- [x] Browser suites run 2026-11-06: pairing-test OK; browser-test OK after fixing stale steps (age-gate checkbox, removed #set-key). Note: tests need a clean localStorage (dev-browser profile persists) and `--timeout 200`
- [x] Fix stale docs (done 2026-11-06): `docs/PRODUCT.md` still describes user-supplied key in Settings, direct-from-browser Claude calls and model `claude-opus-4-8`; README says "no backend" in Architecture but the backend proxy exists. Align both with the current backend-proxy architecture and the actual model in `backend/server.js`
- [x] Reviewed Vera's prompt vs persona (aligned: short texts, one question, no snobbery, <=120 words, max 3 cards); added `output/prompt-test.js` (offline: 39 checks across 4 modes pass; `--live` runs sample chats once /api/ai is restored). Note: `output/` is gitignored, so the script is local only
- [ ] Draft a 10-minute phone test script (quiz, rate 5 wines, Tonight pairing, shelf photo, wine-list photo, restaurant mode) plus a feedback capture template in `docs/USER-TEST.md`; confirm the in-app feedback path (Supabase) works end to end
- [ ] Run the phone test on a real device with the live app (needs owner)
- [ ] Triage test feedback into prompt/UX fixes and iterate on Vera prompts (after owner feedback)

## Blockers
- Vercel MCP returns 403 for team menugenieai-9885s-projects (owner must approve authorize_team_access) so env vars/deploy logs are unreadable; GitHub Actions logs expired (410). Prod /api/ai fix needs owner (Q-PR002-002).
- Real-device user test and feedback require the owner (no agent access to a phone).

## Open Questions
- [ ] Q-PR002-001 (normal): Who runs the phone test and when? Options: (a) owner tests alone with the script in docs/USER-TEST.md, (b) owner plus 2-3 friends/wine-casual users. Recommendation: (b), as the app targets people with no wine knowledge. Also note: AI is free for all users via the backend proxy — OK to keep the current daily budget/rate limits during testing?
- [ ] Q-PR002-002 (urgent): Live Somm AI (chat/scan) returns 503 — Upstash Redis creds likely missing/expired on Vercel project `backend`, and Deploy Backend CI fails. Can you re-issue UPSTASH_REDIS_REST_URL/TOKEN (free tier fine) and set them in Vercel, or approve me doing it? Recommend: you re-issue and paste into Vercel env, then I redeploy and re-run the smoke test.

- [ ] Q-PR002-003 (urgent): Root cause of /api/ai 503 found via Vercel CLI: env vars exist but Upstash host stable-peacock-69238.upstash.io no longer resolves (NXDOMAIN) — the free DB was deleted (inactivity). Can you create a new free Upstash Redis DB (console.upstash.com) and give me the REST URL + token? I then set them on Vercel `backend`, redeploy, re-run smoke test. Recommend: yes.

## Run Log
- 2026-11-06 11:05 — Reviewed Vera prompt vs persona (aligned); added output/prompt-test.js (offline 39/39 pass; --live ready once /api/ai is back).
- 2026-11-06 10:14 — Aligned README + docs/PRODUCT.md with backend-proxy architecture (no user key, model per backend/server.js).
- 2026-11-06 10:08 — Browser suites pass (fixed stale browser-test.js: age-gate, removed Settings key step); top item still blocked on Q-PR002-003.
- 2026-11-06 10:05 — Vercel CLI: Upstash env vars present but DB host NXDOMAIN (deleted); need new creds from owner (Q-PR002-003).
- 2026-11-06 09:05 — Investigated urgent /api/ai 503: Vercel MCP 403 (team auth needed), CI logs expired; unit suites pass (frontend 27/27, backend 24/24). Fix still awaits owner (Q-PR002-002).
- 2026-11-06 08:25 — Smoke test vs live backend: /health, auth, CORS pass; /api/ai valid-token call returns 503 (rate-limit store unavailable); Deploy Backend runs failing; CI green; Vercel MCP logs 403.
- 2026-11-06 08:23 — STATUS.md created by Conductor init
