# Somm Backend Deployment Guide

The Somm app now uses a **backend proxy** to serve AI to all users without needing API keys. Here's how to deploy it.

## Architecture

```
User Browser (GitHub Pages)
    ↓
Frontend (calls /api/ai endpoint)
    ↓
Backend Server (Express)
    ↓
Claude / Groq API (your paid key, kept secret)
```

## Option 1: Deploy to Vercel (Recommended — free tier works)

Vercel handles Node.js backends and free tier has enough capacity for a small app.

### Step 1: Push backend to GitHub

```bash
# From backend/ directory
cd backend
git init
git add .
git commit -m "Initial Somm backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/somm-backend.git
git push -u origin main
```

### Step 2: Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

When prompted:
- **Project name:** `somm-backend`
- **Framework:** `Other`
- **Root directory:** `backend`
- **Build:** leave blank (no build needed)
- **Environment variables:** Add these:
  - `ANTHROPIC_API_KEY` → your Claude key from console.anthropic.com
  - (optional) `GROQ_API_KEY` → free Groq key from console.groq.com

### Step 3: Update frontend backend URL

In `src/js/ai.js`, change:

```javascript
const BACKEND_URL = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://somm-backend.vercel.app"; // ← your Vercel URL
```

Then redeploy frontend:

```bash
git add src/js/ai.js
git commit -m "Update backend URL to Vercel"
git subtree push --prefix src origin gh-pages
```

## Option 2: Deploy to Railway (free tier, 5GB/month)

1. Go to railway.app → Login
2. New Project → Deploy from GitHub
3. Select `somm-backend` repo
4. Add environment variables (same as Vercel above)
5. Deploy

Then update frontend `BACKEND_URL` to your Railway URL.

## Option 3: Deploy to Fly.io (free tier, 3 shared-cpu-1x)

```bash
npm install -g flyctl
flyctl auth login
flyctl launch --name somm-backend
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-...
flyctl deploy
```

Then update frontend `BACKEND_URL` to your Fly URL.

## Option 4: Local development (test before deploy)

```bash
cd backend
cp .env.example .env
# Edit .env and add your API keys
npm start
```

Then in frontend, `BACKEND_URL` is already `http://localhost:3000`.

## Testing

1. Start backend locally or deploy to Vercel/Railway/Fly
2. Open frontend at https://eshcharb-dot.github.io/somm/
3. Go to Vera tab → ask a question
4. Check backend logs for requests (no API key exposed)

## Security Notes

- **API keys are NEVER sent to the frontend** — only the backend has them
- **Backend enforces rate limiting** (100 req/min per IP) to prevent abuse
- **All requests are proxied** — users can't see or intercept API calls
- **Logs may contain user messages** — be careful with sensitive data

## Troubleshooting

**"Can't reach AI backend"** → 
- Check BACKEND_URL in `ai.js` is correct
- Verify backend is running (`curl https://your-backend-url/health`)
- Check API keys are set in environment variables

**"Rate limited"** →
- Backend limits 100 requests/minute per IP
- Wait 60 seconds or restart backend

**High costs** →
- Monitor API usage via console.anthropic.com
- Add stricter rate limits in `server.js`
- Switch to Groq (free tier) as primary provider

## Future Improvements

- [ ] Redis-based rate limiting (per user, not per IP)
- [ ] Caching common wine questions
- [ ] Usage analytics dashboard
- [ ] Multi-provider failover (Claude → Groq if Claude fails)
- [ ] Streaming responses for faster perceived UX
