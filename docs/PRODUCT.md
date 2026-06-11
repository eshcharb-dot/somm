# Somm — AI Sommelier · Product Spec

**Persona:** Vera — warm, sharp, witty sommelière. Knows everything, judges nothing. Speaks in short text messages, asks one question at a time.

## The two cores

### 1. Taste Profile Engine (local, always works)
- **Palate vector** — 6 dimensions, each 0–1: body, sweetness, acidity, tannin, fruit, oak
- **Type affinities** — red / white / rosé / sparkling / orange / dessert
- **Adventure score** — stick-to-favorites ↔ always-something-new
- **Budget bands** — separate for home, store, restaurant
- **Hard nos** — dislikes that filter everything
- **Learning loop** — every wine card has 3 feedback buttons (Loved it / It was fine / Not for me). Each rating nudges the palate vector toward/away from that wine's attribute vector with a decaying learning rate. Confidence % grows with rating count.
- Built from an 8-step onboarding quiz (proxy questions: coffee, chocolate, dinner pick...) — no wine knowledge required.

### 2. AI Layer (Claude API, key in Settings)
- **Vera chat** — full conversational sommelier, profile injected into system prompt, mode-aware
- **Photo analysis** — snap a bottle / shelf / wine list / food menu → vision analysis → ranked picks scored against the user's profile and budget, each as a rateable wine card
- Wine cards come back as `<wine>{json}</wine>` blocks parsed into UI cards with feedback buttons → feeds the learning loop

## Three contexts
| Mode | Question it answers | Without API key | With API key |
|---|---|---|---|
| Tonight | "What do I open / pair with dinner?" | Local engine: pairing rules + palate match from 48-style knowledge base | Vera, personalized |
| Store | "Which bottle do I buy?" | Local engine: best style matches in budget + shopping list | Shelf photo → top 3 picks |
| Restaurant | "What do I order?" | Local cheat-sheet by cuisine | Wine list photo → best value picks for your meal |

## Stack
Static PWA (no build) → GitHub Pages. localStorage for profile/history/key. Claude API direct from browser (`anthropic-dangerous-direct-browser-access`), model `claude-opus-4-8`, vision via base64, images downscaled client-side to ≤1568px.

## Launch checklist
- [x] Onboarding → initial profile
- [x] Learning loop wired to every card
- [x] 3 modes usable offline + AI-enhanced
- [x] Photo flows (bottle/shelf/menu)
- [x] Persona consistent everywhere
- [x] Syntax validated + runtime tested + UX pass
