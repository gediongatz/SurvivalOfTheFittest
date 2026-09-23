const { getRedis, loadState, loadPacket, saveState, acquireLock, releaseLock } = require('../lib/store');
const { createState, publicSnapshot } = require('../lib/simulation');

module.exports = async (req, res) => {
  // Short edge cache: if several viewers hit this within the same second,
  // Vercel's CDN serves them from cache instead of each one hitting Redis.
  // This is the main defense against burning through the free Redis quota.
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=10');

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  try {
    let state = await loadState(redis);

    if (!state) {
      // First-ever visit: create the genesis state. Guarded by the lock so
      // concurrent first visitors don't race to create two different runs.
      const got = await acquireLock(redis, 10000);
      if (got) {
        try {
          state = await loadState(redis); // re-check after acquiring lock
          if (!state) {
            state = createState();
            await saveState(redis, state);
          }
        } finally {
          await releaseLock(redis);
        }
      } else {
        res.status(202).json({ starting: true });
        return;
      }
    }

    const packet = await loadPacket(redis);
    const snapshot = publicSnapshot(state);
    snapshot.packet = packet || null;

    res.status(200).json(snapshot);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
