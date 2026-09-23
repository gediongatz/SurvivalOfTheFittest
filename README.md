# Snake Evolution — Live Broadcast

A Red-vs-Blue snake simulation that runs continuously on the server, forever.
Every visitor sees the same live state — nobody can start, pause, or configure it
(except via the hidden admin panel).

## Architecture

```
GitHub Actions (every 1 min, free)
        │
        ▼
  /api/tick ──── advances simulation ──── Upstash Redis (free tier)
        │
        ▼
  /api/state  ◄─── browser polls every 20s
        │
        ▼
  Browser replays the packet locally via requestAnimationFrame
```

- **Server records** each minute of simulation as a timestamped replay packet.
- **Browser plays it back** smoothly at 60fps without hitting the server every frame.
- Only ~1,440 Redis writes/day + 1 read per 20s per viewer — well within free quotas.

---

## Setup Guide

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Import into Vercel
1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo
3. **Framework Preset**: `Other`
4. Leave Build Command and Output Directory blank
5. Click **Deploy**

### 3. Add Upstash Redis
1. In your Vercel project → **Storage** tab → **Create Database** → **Upstash Redis**
2. Connect it to this project — Vercel auto-injects the env vars
3. The app handles both naming conventions:
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (new)
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (older Vercel KV style)

### 4. Add environment variables in Vercel
Project → **Settings** → **Environment Variables**:

| Variable | Value |
|---|---|
| `CRON_SECRET` | Any random string (e.g. `openssl rand -hex 20`) |

> Redeploy after adding env vars for them to take effect.

### 5. Set up GitHub Actions secrets
In your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret name | Value |
|---|---|
| `VERCEL_APP_URL` | `https://your-app.vercel.app` (no trailing slash) |
| `CRON_SECRET` | Same value you set in Vercel above |

The GitHub Actions workflow (`.github/workflows/tick.yml`) will then automatically
ping `/api/tick` every minute — keeping the simulation alive **forever**, even with
zero active viewers, **completely free**.

### 6. Visit your site
- **Viewer**: `https://your-app.vercel.app`
- **Admin panel**: `https://your-app.vercel.app/AdminGedionSnakesCoexistance`

On the first visit, the simulation is created (genesis). Within 1 minute the
GitHub Actions cron fires and the simulation starts advancing.

---

## Admin Panel

Visit `/AdminGedionSnakesCoexistance` to:
- Adjust grid size, snake speeds, agility, apple count, lifespan, and more
- Click **Start Simulation** to apply new parameters and restart from a fresh genesis
- Monitor live Red/Blue populations and the simulation clock

> ⚠️ Keep this URL private. There is no login — the obscure URL is the only protection.

---

## Restarting the simulation
Use the **Admin Panel** → **Start Simulation** button. This wipes the state and
starts fresh with whatever parameters you configure.

Alternatively, POST directly:
```bash
curl -X POST https://your-app.vercel.app/api/admin-control \
  -H "Content-Type: application/json" \
  -d '{"cols":70,"rows":45,"appleCount":6}'
```

---

## Changing parameters without a restart
Edit `DEFAULT_CFG` in `lib/simulation.js`, then use the admin panel to restart.

---

## Free-tier limits

| Resource | Free allowance | This app's usage |
|---|---|---|
| Upstash Redis | 500K commands/month | ~1,440 writes/day + 1 read/20s/viewer |
| GitHub Actions | 2,000 min/month | ~1,440 min/month (1/min × 24h × 30d) |
| Vercel Hobby | Unlimited serverless invocations | 1,440/day from cron + viewer reads |

With a handful of simultaneous viewers this stays comfortably inside all free quotas.

---

## Notes
- Each replay packet is ~300–400KB JSON (Vercel compresses automatically to <100KB).
- If you raise `maxSnakes`, packet size and tick compute time grow proportionally.
- GitHub Actions `schedule:` can lag by up to ~10 minutes under heavy GitHub load,
  but averages ~1 minute and is free indefinitely.
