const { getRedis, saveState } = require('../lib/store');
const { createState } = require('../lib/simulation');

module.exports = async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = req.query.secret;
  if (!secret || provided !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const redis = getRedis();
  const state = createState();
  await saveState(redis, state);
  res.status(200).json({ ok: true, startedAt: state.startedAt });
};
