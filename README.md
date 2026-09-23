# Snake Evolution — Live Broadcast

One Red-vs-Blue snake simulation, started once, that keeps running on the
server forever. Every visitor sees the *same* live state — nobody can
start, pause, or configure it. It's a broadcast, not a toy.

## How it stays running on free Vercel

Vercel serverless functions don't run continuously — they wake up per
request and get killed shortly after. So instead of "one process running
for years," this works by:

1. The full simulation state (every snake, every apple, the clock) lives
   as one JSON blob in **Upstash Redis** (free tier via Vercel's Storage
   tab), not in memory.
2. **`/api/tick`** loads that state, advances it by however much real
   time has passed since the last tick (usually ~60s), and saves it
   back. While it's doing that, it also **records everything that
   happened** — every move, birth, death, and apple spawn, each tagged
   with the exact simulated moment it occurred — into a compact "replay
   packet," saved alongside the state. It's meant to be pinged **once a
   minute** by an external scheduler.
3. **`/api/state`** is what the viewer page fetches. It's a cheap,
   cacheable read: one Redis GET, no writes, no locking. It returns the
   latest replay packet along with the current authoritative snapshot.
4. The **browser replays that packet locally**, in real time, using
   `requestAnimationFrame` — applying each move/birth/death/apple event
   at the exact moment it's timestamped for. That's what makes the
   motion look smooth even though the browser only fetches a new packet
   every ~20 seconds: it's not just showing you a snapshot, it's
   replaying a recorded minute of actual simulation history, the same
   way a video player buffers a chunk and then plays it smoothly rather
   than redrawing only when a new chunk arrives.
5. Vercel's own free Cron only fires **once a day** on the Hobby plan —
   nowhere near often enough — so an external free cron service pings
   `/api/tick` every minute instead. Everything else stays on Vercel.

This design keeps Redis usage low on purpose: roughly **one write per
minute** (from the cron tick) and **one read per ~20 seconds per
viewer** (well within Upstash's free 500K-commands/month quota even with
several people watching at once), because the expensive part — replaying
motion smoothly — happens for free in the visitor's own browser instead
of costing a database request every frame.

## Setup

### 1. Push this to GitHub
Create a new repo and push this folder as-is.

### 2. Import into Vercel
New Project → import the repo → **Framework Preset: Other** → leave
Build Command / Output Directory blank → Deploy.

### 3. Add a free Redis database
In the Vercel project → **Storage** tab → **Create Database** → choose
**Upstash Redis** (or "KV", which is Upstash-backed) → connect it to
this project. Vercel will auto-inject the env vars. Check which names it
used (`UPSTASH_REDIS_REST_URL`/`TOKEN` or `KV_REST_API_URL`/`TOKEN`) —
`lib/store.js` already checks both, so either works.

### 4. Add two secrets
Project → Settings → Environment Variables:
- `CRON_SECRET` — any random string, protects `/api/tick`
- `ADMIN_SECRET` — any random string, protects `/api/reset`

Redeploy after adding them (env var changes need a redeploy to take effect).

### 5. Set up the free external cron
Go to **[cron-job.org](https://cron-job.org)** (free, no card needed) →
create an account → create a new cron job:
- URL: `https://YOUR-APP.vercel.app/api/tick?secret=YOUR_CRON_SECRET`
- Schedule: every 1 minute
- Save and enable it

(GitHub Actions' `schedule:` trigger is a free alternative if you'd
rather keep it inside GitHub, but it can't reliably go faster than
~every 5 minutes on the free tier, so cron-job.org is the better fit here.)

### 6. Visit your site
`https://YOUR-APP.vercel.app` — the first visit creates the simulation
(genesis). Within a minute of the cron job firing, you'll see it moving.
As long as the cron job keeps running and Upstash's free tier holds the
data, it keeps going indefinitely — years, in principle.

## If you ever want to restart it
Visit `https://YOUR-APP.vercel.app/api/reset?secret=YOUR_ADMIN_SECRET`
(POST or just GET in a browser both work here) — wipes the saved state
and starts a fresh genesis with the same baked-in parameters.

## Changing the starting parameters
They're intentionally not viewer-configurable — that was the point. To
change species speed/agility, board size, apple count, etc., edit
`DEFAULT_CFG` in `lib/simulation.js`, then hit `/api/reset` (above) to
apply it to a fresh run.

## Free-tier limits worth knowing
- **Upstash Redis free tier** is 500,000 commands/month and 256MB
  storage. This design uses roughly 1,440 writes/day (one per cron tick)
  plus one read every ~20s per active viewer — a handful of people
  watching around the clock stays comfortably inside the free quota. If
  you ever expect a big crowd of simultaneous viewers, you can widen the
  viewer poll interval in `index.html` (`setInterval(poll, 20000)`) to
  reduce reads further, since each packet already covers ~60s of replay.
- **If nobody pings `/api/tick` and nobody is viewing the page**, the
  simulation simply doesn't advance during that gap — there's no free
  way around this on Vercel serverless (no persistent process = no
  ticking with zero requests). The cron job is what guarantees it keeps
  moving even with zero visitors.
- Each replay packet is roughly 300–400KB of JSON (gzip-compressed to
  well under 100KB over the wire by Vercel automatically), covering a
  full minute of simulated history for up to 60 snakes. If you raise
  `maxSnakes` in `lib/simulation.js`, packet size and `/api/tick`'s
  compute time both grow roughly proportionally — keep an eye on it if
  you do.
"# SurvivalOfTheFittest" 
