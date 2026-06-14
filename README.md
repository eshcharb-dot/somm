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

## Setup (2 minutes)

1. Open the app, do the quiz.
2. The Tonight tab works immediately — no key needed.
3. For Vera chat + photo scanning:
   - **Free**: Get a Groq API key at [console.groq.com](https://console.groq.com) (no credit card, 5,000 requests/month) → paste in **You → Settings**
   - **Premium**: Get a Claude key at [console.anthropic.com](https://console.anthropic.com) → paste in **You → Settings** (for best wine analysis quality)
   - Keys are stored only in your browser's localStorage; calls go directly from your device to the AI provider

## Architecture

Static PWA-style app, no build, no backend.

```
src/
  index.html      app shell, 4 tabs, onboarding screen
  css/app.css     dark-cellar design system (Fraunces + Karla)
  js/data.js      48 wine styles w/ attribute vectors, pairing synonyms, quiz, cheat sheet
  js/profile.js   taste engine: quiz→profile, rating→learning, local recommender
  js/ai.js        Claude API layer (browser-direct), Vera system prompt, image downscale
  js/app.js       screens, router, chat, scan, journal, settings
```

- Profile, journal, chat, and API key persist in `localStorage`
- AI replies embed `<wine>{json}</wine>` cards parsed into rateable UI cards — AI recommendations train the same profile as local ones
- Photos are downscaled client-side to ≤1568px before upload

## Dev

```powershell
# run tests
node --check src/js/*.js
dev-browser --headless run output/browser-test.js
dev-browser --headless run output/pairing-test.js
```

Deployed via GitHub Pages from the `gh-pages` branch (`git subtree push --prefix src origin gh-pages`).
