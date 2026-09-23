const { getRedis, saveState, savePacket } = require('../lib/store');
const { createState } = require('../lib/simulation');

// No secret check here — the URL path itself is the only protection.
// Keep /AdminGedionSnakesCoexistance private.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  // Parse and validate config from request body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Expected JSON body with simulation config.' });
    return;
  }

  // Clamp helpers
  const clamp = (v, lo, hi, fallback) => {
    const n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  // Build validated config overrides
  const cfgOverrides = {
    cols:        clamp(body.cols,        20,  200, 70),
    rows:        clamp(body.rows,        15,  120, 45),
    appleCount:  clamp(body.appleCount,  1,   50,  6),
    lifespan:    clamp(body.lifespan,    5000, 300000, 30000),
    startLen:    clamp(body.startLen,    2,   10,  3),
    startCount:  clamp(body.startCount,  1,   10,  1),
    maxSnakes:   clamp(body.maxSnakes,   4,   200, 60),
    reseedDelay: clamp(body.reseedDelay, 1000, 60000, 5000),
  };

  // Species config
  const speciesBody = body.species || {};
  const red  = speciesBody.red  || {};
  const blue = speciesBody.blue || {};
  cfgOverrides.species = {
    red: {
      name: 'red',
      speed:   clamp(red.speed,   1, 30, 9),
      agility: clamp(red.agility, 0, 20, 5),
    },
    blue: {
      name: 'blue',
      speed:   clamp(blue.speed,   1, 30, 4),
      agility: clamp(blue.agility, 0, 20, 0),
    },
  };

  try {
    // Wipe old packet so the viewer doesn't replay stale data
    await redis.del('snake-broadcast:packet');

    // Create fresh state with the new config
    const state = createState(cfgOverrides);
    await redis.set('snake-broadcast:state', JSON.stringify(state));

    res.status(200).json({
      ok: true,
      startedAt: state.startedAt,
      cfg: state.cfg,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
