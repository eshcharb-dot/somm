# Feedback triage — phone-test result -> fix in one cycle

Prompt lives in `src/js/ai.js` (`VERA_SYSTEM_BASE`, `buildSystemPrompt` mode blocks, `SCAN_PROMPTS` for photos).
Prompt is **frozen** until real tester feedback exists; change only what the table says.

| Feedback | Change here | Re-test |
|---|---|---|
| Replies too long / wall of text | `VERA_SYSTEM_BASE` > STYLE RULES: "under ~120 words" (lower to ~80); PERSONA "short messages" | `node output/prompt-test.js --live --samples=3` (word-count check) |
| Too many questions | PERSONA "at most ONE question" line; per-mode `modeCtx` text (store/restaurant are the weak modes: 1/3 and 0/3 passing on 2026-11-10); add "end with a recommendation, not a question" | same, look at the one-question line per mode |
| Wrong wine / ignores my taste | YOUR JOB "ground truth" + hard-nos lines; check `SommProfile.profileForPrompt` in `src/js/profile.js` actually sends the nos/budget; card `match` rules | live run with a profile that has a hard no; verify no card violates it |
| Snobbish / jargon | PERSONA "zero snobbery", "NEVER make the user feel ignorant"; add an explicit "no jargon unless the user uses it" rule | `--live`, scan for jargon manually |
| Wrong/missing price, wrong currency | PRICING INTELLIGENCE + STYLE RULES currency line; FX block `buildFxBlock` / `initFxRates` in ai.js | `node --test src/js/__tests__/ai.test.js`, then live |
| Cards broken / not rendering | WINE CARDS section in prompt; parser `parseWineCards` in ai.js; render in app.js | `__tests__/ai.test.js` |
| Photo scan wrong / unreadable | `SCAN_PROMPTS` + `buildScanSystemPrompt`; image size in `prepareImage` | `output/scan-one.js`, `output/shelf-test.js` |
| Tonight greeting odd | `renderTonightGreeting` in `src/js/app.js` | browser test below |
| UX bug (layout, tap, offline) | `src/css/app.css`, `src/index.html`, `src/js/app.js`; cache list in `src/sw.js` (bump cache version) | `node output/browser-test.js --timeout 200` (clear localStorage first) |
| Feedback/rating didn't save | `backend/server.js` `/api/rating`, `/api/feedback`; client `src/js/db.js`, `device.js` | `cd backend && npm test`; `node backend/scripts/smoke-test.js` |

## Workflow
1. Group feedback by row above; fix the most-repeated one first (one change per cycle).
2. Offline check: `node output/prompt-test.js` (39 checks); frontend tests: `node --test src/js/__tests__/*.test.js`.
3. Live check vs prod: `node output/prompt-test.js --live --samples=3`.
4. `node --check` edited JS, commit, push (Pages deploys `src`); verify live URL.
5. Log result in STATUS.md; record owner-visible changes in DECISIONS-worthy questions only if they change persona.

## Reading feedback
Stored in prod Upstash KV: list `somm:feedback` (LRANGE), ratings `somm:rating:<deviceId>`. Note: `vercel env pull` returns the KV vars **empty** (sensitive), so agents cannot read KV directly; see Q-PR002-008.
