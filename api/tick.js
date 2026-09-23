const { getRedis, loadState, saveState, savePacket, acquireLock, releaseLock } = require('../lib/store');
const { createState, advance } = require('../lib/simulation');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // Protects the write endpoint from randoms on the internet spamming it.
  // Set CRON_SECRET in Vercel env vars and configure your external cron
  // to call /api/tick?secret=YOUR_SECRET (or an Authorization header).
  const secret = process.env.CRON_SECRET;
  const provided = req.query.secret || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (secret && provided !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  const got = await acquireLock(redis, 25000);
  if (!got) {
    res.status(200).json({ ok: true, skipped: true, reason: 'lock held by another tick' });
    return;
  }

  try {
    let state = await loadState(redis);
    const now = Date.now();

    if (!state) {
      state = createState();
      await saveState(redis, state);
      res.status(200).json({ ok: true, created: true, gameTime: state.gameTime });
      return;
    }

    const elapsed = now - state.lastTickAt;
    const result = advance(state, elapsed, { record: true });
    state.lastTickAt = now;

    await saveState(redis, state);
    if (result.packet) {
      result.packet.createdAt = now;
      await savePacket(redis, result.packet);
    }

    res.status(200).json({
      ok: true,
      requestedMs: elapsed,
      appliedMs: result.appliedMs,
      eventCount: result.packet ? result.packet.events.length : 0,
      gameTime: state.gameTime,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseLock(redis);
  }
};
