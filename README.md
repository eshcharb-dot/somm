# Somm — your pocket sommelier 🍷

**PR-002** · An AI sommelier that learns your palate and helps you pick wine — at home, at the store, and at a restaurant.

**Live app:** https://eshcharb-dot.github.io/somm/

## What it does

- **Vera**, your in-app sommelière, chats with you in text — warm, sharp, zero snobbery
- **Onboarding quiz** (8 questions, no wine knowledge needed) builds your initial taste profile
- **Learning loop** — every wine card has *Loved it / Fine / Not for me* buttons; each rating sharpens your 6-dimension palate vector (body, sweetness, acidity, tannin, fruit, oak). Watch your profile confidence % grow.
- **Three modes:**
  - **Tonight** — what to open at home + food pairing (works fully offline via the local engine)
  - **Store** — snap a shelf or bottle photo → best buys for your palate and budget
  - **Restaurant** — snap the wine list or menu → best value picks for your meal
- **Photo analysis** — bottle, shelf, wine list, or food menu. Uses **Groq** (free tier) by default, or **Claude** (premium) if you bring your key.

## Setup (instant)

1. Open the app at https://eshcharb-dot.github.io/somm/ 
2. Do the quiz → boom, you're ready
3. **Vera AI is already enabled** — no setup needed, all users get free access
   - Tonight tab works offline (local profile-based recommendations)
   - Chat + photo scanning use backend-proxied Claude API (secure, no client-side keys)
   - App works on mobile, no install needed

## For your own deployment

To run Somm on your own domain with your own API key:

1. Deploy backend (Express server) to Vercel, Railway, or Fly.io — see [DEPLOYMENT.md](DEPLOYMENT.md)
2. Set `ANTHROPIC_API_KEY` env var on your backend
3. Update `BACKEND_URL` in `src/js/ai.js` to your deployed backend
4. Redeploy frontend to GitHub Pages

All users then get free AI instantly, with no API key management.

## Architecture

Static PWA-style app, no build, no backend.

```
src/
  index.html      app shell, 4 tabs, onboarding screen
  css/app.css     dark-cellar design system (Fraunces + Karla)
  js/data.js      48 wine styles w/ attribute vectors, pairing synonyms, quiz, cheat sheet
  js/profile.js   taste engine: quiz→profile, rating→learning, local recommender
  js/ai.js        AI layer (calls backend /api/ai endpoint), Vera system prompt, image downscale
  js/app.js       screens, router, chat, scan, journal, settings

backend/
  server.js       Express backend, proxies Claude/Groq calls, rate limiting
  .env.example    template for API keys (never committed)
  package.json    dependencies (express, cors, dotenv, node-fetch)
```

- Profile, journal, and chat history persist in `localStorage`
- **API keys never touch the frontend** — backend holds them securely
- AI replies embed `<wine>{json}</wine>` cards parsed into rateable UI cards
- Photos downscaled client-side to ≤1568px, base64 sent via backend
- Backend enforces 100 req/minute per IP to prevent abuse

## Dev

```powershell
# frontend tests (27 tests: profile/quiz logic, wine-card & scan-result parsing)
node --test "src/js/__tests__/*.test.js"

# backend tests (cost-control logic: rate limiting, daily budgets, JWT verification)
cd backend; npm test

# quick syntax check
node --check src/js/*.js
dev-browser --headless run output/browser-test.js
dev-browser --headless run output/pairing-test.js
```

Both suites run automatically in CI on every push/PR (`.github/workflows/ci.yml`), and
`backend/` auto-deploys with a post-deploy smoke test on every push to `main`
(`.github/workflows/deploy-backend.yml` — see [DEPLOYMENT.md](DEPLOYMENT.md)).

Deployed via GitHub Pages from the `gh-pages` branch (`git subtree push --prefix src origin gh-pages`).
