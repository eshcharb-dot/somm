# Somm — 10-minute phone test

**Before you start:** open https://eshcharb-dot.github.io/somm/ on your phone (Safari/Chrome). Optionally "Add to Home Screen". Don't read ahead; narrate what you think out loud. Tester needs no wine knowledge.

## Script (about 10 min)
| # | Task | What to watch for | OK? |
|---|------|-------------------|-----|
| 1 | Open the app, pass the age gate | Is it clear what Somm is in 5 seconds? | |
| 2 | Take the taste quiz | Any confusing question? Does it feel too long? | |
| 3 | Rate 5 wines (You/Scan tab) | Is rating easy? Does it feel rewarding? | |
| 4 | Tonight tab: ask for a pairing ("pasta with mushrooms") | Are Vera's answers short, friendly, 1 question, max 3 cards? | |
| 5 | Scan tab: photograph a bottle/shelf | Recognition right? Speed? Error handling? | |
| 6 | Scan tab: photograph a restaurant wine list | Sensible picks for budget/taste? | |
| 7 | Restaurant mode: ask "what should I order with the fish?" | Useful, non-snobby? | |
| 8 | Chat with Vera for 2 min (free talk) | Tone, jargon, wrong facts | |
| 9 | You tab > "Tell Vera →": send one feedback message | Does it confirm sent? (see check below) | |

## Feedback capture template (one per tester)
- Tester (first name / wine experience 1-5):
- Device + browser:
- First impression (one sentence):
- Most confusing moment:
- Best moment:
- Wrong / weird Vera answers (quote them):
- Would you use it again? When?
- Bugs (screen, what you tapped):
- Severity of each issue: blocker / annoying / nice-to-have

## Feedback path check
In-app feedback writes to the Supabase table `public.feedback` (`src/js/db.js#saveFeedback`, RLS insert-only). After step 9, confirm the row appears in the Supabase dashboard (project "somm"). Note: failures are swallowed with a console warning, so the UI may not show a problem.

## Prerequisites
- Backend `/api/ai` must be working (steps 4-8 depend on it).
- Supabase project "somm" must be active (free projects pause after inactivity).
