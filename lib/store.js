const { Redis } = require('@upstash/redis');

// Works with either the Upstash-native env var names or Vercel's older
// "Vercel KV" naming (which is Upstash under the hood) — whichever your
// integration set, this picks it up. See README for details.
function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Missing Redis env vars. Add the Upstash Redis integration to this ' +
      'Vercel project (Storage tab) so UPSTASH_REDIS_REST_URL / ' +
      'UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN) are set.'
    );
  }
  return new Redis({ url, token });
}

const STATE_KEY = 'snake-broadcast:state';
const PACKET_KEY = 'snake-broadcast:packet';
const LOCK_KEY = 'snake-broadcast:lock';

async function loadState(redis) {
  const raw = await redis.get(STATE_KEY);
  if (!raw) return null;
  // @upstash/redis auto-parses JSON-looking strings sometimes; handle both.
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveState(redis, state) {
  await redis.set(STATE_KEY, JSON.stringify(state));
}

async function loadPacket(redis) {
  const raw = await redis.get(PACKET_KEY);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function savePacket(redis, packet) {
  await redis.set(PACKET_KEY, JSON.stringify(packet));
}

// Best-effort lock: only one tick/catch-up should mutate state at a time.
// Returns true if the lock was acquired.
async function acquireLock(redis, ttlMs) {
  const res = await redis.set(LOCK_KEY, String(Date.now()), { nx: true, px: ttlMs });
  return res === 'OK' || res === true;
}

async function releaseLock(redis) {
  await redis.del(LOCK_KEY);
}

module.exports = { getRedis, loadState, saveState, loadPacket, savePacket, acquireLock, releaseLock, STATE_KEY, PACKET_KEY, LOCK_KEY };
