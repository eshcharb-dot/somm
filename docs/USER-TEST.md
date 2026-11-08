# Somm — 5-minute phone test

Open https://eshcharb-dot.github.io/somm/ on your phone (optional: Add to Home Screen). No wine knowledge needed. Think out loud.

## Do these 6 things
1. Open the app, pass the age gate. *Clear what it is in 5 seconds?*
2. Take the taste quiz. *Too long? Anything confusing?*
3. Tonight tab: ask "pasta with mushrooms". *Short, friendly, max 3 wines?*
4. Scan tab: photo of a bottle or a wine list. *Right wine? Fast?*
5. Chat with Vera for 1 min about anything. *Tone, jargon, wrong facts?*
6. You tab > "Tell Vera →": send one message. *Did it confirm?*

## Send back (3 lines, text is fine)
- Phone + browser:
- Best moment / most confusing moment:
- Anything Vera got wrong (quote it) or any bug (screen + what you tapped):

Plus: would you use it again, and when?

---
## For the owner (not for testers)
- Testers: you + 2-3 friends, ideally wine-casual. Current daily budget/rate limits stay as they are (DECISIONS 2026-11-08).
- Prereq: `/api/ai` works (steps 3-5). Ratings/feedback storage is being moved from Supabase to Upstash (Q-PR002-006); until that ships, in-app feedback is NOT saved server-side, so collect it via the 3 lines above.
