// ---------------------------------------------------------------------
// Headless snake-evolution engine.
//
// This is the same rules as the original browser demo (grid movement,
// agility = forced straight-line runway, apples, growth, reproduction,
// aging/death) ported to run with no DOM, driven purely by a plain
// `state` object and a millisecond duration to advance. That's what lets
// it live inside a stateless serverless function: load state from Redis,
// advance(state, elapsedMs), save state back to Redis.
//
// The starting parameters below are the "one canonical run" — baked in
// at genesis, not configurable by viewers. If you want to change them,
// edit DEFAULT_CFG and hit /api/reset (see api/reset.js).
// ---------------------------------------------------------------------

const DIRS = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

const DEFAULT_CFG = {
  cols: 70,
  rows: 45,
  appleCount: 6,
  species: {
    red: { name: 'red', speed: 9, agility: 5 },
    blue: { name: 'blue', speed: 4, agility: 0 },
  },
  lifespan: 30 * 1000, // ms
  startLen: 3,
  startCount: 1,
  maxSnakes: 60,         // compute-cost cap; a serverless tick has to stay fast
  reseedDelay: 5000,     // ms of extinction before a species is reseeded
};

const MICRO_STEP_MS = 25;             // simulation resolution
const MAX_CATCHUP_MS = 90 * 1000;     // never simulate more than 90 real seconds in one call
const BFS_NODE_CAP = 500;             // bound pathfinding cost instead of scanning the whole board

function key(x, y) { return x + ',' + y; }
function randInt(n) { return Math.floor(Math.random() * n); }
function clampInt(v, lo, hi) { v = parseInt(v, 10); if (isNaN(v)) v = lo; return Math.min(hi, Math.max(lo, v)); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createState(cfgOverrides) {
  const cfg = Object.assign({}, DEFAULT_CFG, cfgOverrides || {});
  const now = Date.now();
  const state = {
    cfg,
    snakes: [],
    apples: [],
    appleEatenCount: 0,
    gameTime: 0,
    startedAt: now,
    lastTickAt: now,
    nextId: 1,
    extinctSince: { red: null, blue: null },
  };

  const ctx = buildCtx(state);
  for (let i = 0; i < cfg.startCount; i++) {
    spawnSnake(ctx, cfg.species.red, cfg.startLen, null);
    spawnSnake(ctx, cfg.species.blue, cfg.startLen, null);
  }
  for (let i = 0; i < cfg.appleCount; i++) spawnApple(ctx);
  flushCtx(state, ctx);
  return state;
}

// Rebuilds the working (mutable, occupancy-indexed) structures from the
// persisted plain-object state. Nothing here is stored back to Redis
// directly — flushCtx() below serializes it back down.
function buildCtx(state) {
  const cfg = state.cfg;
  const occupancy = new Map();
  const appleSet = new Set();
  const snakes = state.snakes.map(s => Object.assign({}, s, { segments: s.segments.map(p => ({ x: p.x, y: p.y })) }));
  for (const s of snakes) for (const seg of s.segments) occupancy.set(key(seg.x, seg.y), s);
  const apples = state.apples.map(a => ({ x: a.x, y: a.y }));
  for (const a of apples) appleSet.add(key(a.x, a.y));
  return {
    cfg,
    cols: cfg.cols, rows: cfg.rows,
    occupancy, appleSet, apples, snakes,
    appleEatenCount: state.appleEatenCount,
    gameTime: state.gameTime,
    nextId: state.nextId,
    extinctSince: Object.assign({}, state.extinctSince),
  };
}

function flushCtx(state, ctx) {
  state.snakes = ctx.snakes.map(s => ({
    id: s.id, species: s.species, segments: s.segments,
    dir: s.dir, stepsSinceTurn: s.stepsSinceTurn,
    birth: s.birth, deathAt: s.deathAt, nextMoveAt: s.nextMoveAt,
  }));
  state.apples = ctx.apples;
  state.appleEatenCount = ctx.appleEatenCount;
  state.gameTime = ctx.gameTime;
  state.nextId = ctx.nextId;
  state.extinctSince = ctx.extinctSince;
}

function isFree(ctx, x, y) {
  if (x < 0 || y < 0 || x >= ctx.cols || y >= ctx.rows) return false;
  if (ctx.occupancy.has(key(x, y))) return false;
  if (ctx.appleSet.has(key(x, y))) return false;
  return true;
}

function spawnApple(ctx) {
  if (ctx.apples.length >= ctx.cfg.appleCount) return;
  for (let attempts = 0; attempts < 400; attempts++) {
    const x = randInt(ctx.cols), y = randInt(ctx.rows);
    if (isFree(ctx, x, y)) {
      ctx.apples.push({ x, y });
      ctx.appleSet.add(key(x, y));
      if (ctx.events) ctx.events.push(['as', ctx.gameTime, x, y]);
      return;
    }
  }
}

function spawnSnake(ctx, species, length, parentHead) {
  for (let attempts = 0; attempts < 250; attempts++) {
    let hx, hy;
    if (parentHead) {
      const range = 6;
      hx = clampInt(parentHead.x + randInt(range * 2 + 1) - range, 0, ctx.cols - 1);
      hy = clampInt(parentHead.y + randInt(range * 2 + 1) - range, 0, ctx.rows - 1);
    } else {
      hx = randInt(ctx.cols); hy = randInt(ctx.rows);
    }
    const dir = DIRS[randInt(DIRS.length)];
    const segs = [];
    let ok = true;
    for (let i = 0; i < length; i++) {
      const sx = hx - dir.dx * i, sy = hy - dir.dy * i;
      if (!isFree(ctx, sx, sy)) { ok = false; break; }
      segs.push({ x: sx, y: sy });
    }
    if (!ok) continue;
    const snake = {
      id: ctx.nextId++,
      species: species.name,
      segments: segs,
      dir: { dx: dir.dx, dy: dir.dy },
      stepsSinceTurn: species.agility,
      birth: ctx.gameTime,
      deathAt: ctx.gameTime + ctx.cfg.lifespan,
      nextMoveAt: ctx.gameTime + 1000 / species.speed,
    };
    for (const s of segs) ctx.occupancy.set(key(s.x, s.y), snake);
    ctx.snakes.push(snake);
    if (ctx.events) {
      ctx.events.push(['b', snake.id, ctx.gameTime, snake.species, segs.map(s => [s.x, s.y])]);
    }
    return snake;
  }
  return null;
}

function removeSnake(ctx, snake) {
  for (const s of snake.segments) ctx.occupancy.delete(key(s.x, s.y));
  const idx = ctx.snakes.indexOf(snake);
  if (idx >= 0) ctx.snakes.splice(idx, 1);
  if (ctx.events) ctx.events.push(['d', snake.id, ctx.gameTime]);
}

function oppositeDir(d) { return { dx: -d.dx, dy: -d.dy }; }

function bfsDirectionToNearestApple(ctx, snake) {
  const head = snake.segments[0];
  if (ctx.apples.length === 0) return null;
  const visited = new Set([key(head.x, head.y)]);
  const queue = [{ x: head.x, y: head.y, firstDir: null }];
  let qi = 0;
  const maxNodes = BFS_NODE_CAP;
  let nodes = 0;
  while (qi < queue.length && nodes < maxNodes) {
    const cur = queue[qi++]; nodes++;
    if (ctx.appleSet.has(key(cur.x, cur.y)) && !(cur.x === head.x && cur.y === head.y)) {
      return cur.firstDir;
    }
    for (const d of DIRS) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= ctx.cols || ny >= ctx.rows) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      if (ctx.occupancy.has(k)) continue;
      visited.add(k);
      queue.push({ x: nx, y: ny, firstDir: cur.firstDir || d });
    }
  }
  return null;
}

function floodOpenSpace(ctx, x, y, dir, limit) {
  let cx = x + dir.dx, cy = y + dir.dy, count = 0;
  for (let i = 0; i < limit; i++) {
    if (cx < 0 || cy < 0 || cx >= ctx.cols || cy >= ctx.rows) break;
    if (ctx.occupancy.has(key(cx, cy))) break;
    count++;
    cx += dir.dx; cy += dir.dy;
  }
  return count;
}

function chooseDirection(ctx, snake) {
  const species = ctx.cfg.species[snake.species];
  const head = snake.segments[0];
  const canTurn = snake.stepsSinceTurn >= species.agility;

  if (!canTurn) return snake.dir;

  const rev = oppositeDir(snake.dir);
  const candidates = DIRS.filter(d => !(d.dx === rev.dx && d.dy === rev.dy));

  const bfsDir = bfsDirectionToNearestApple(ctx, snake);
  if (bfsDir && candidates.some(d => d.dx === bfsDir.dx && d.dy === bfsDir.dy)) {
    const nx = head.x + bfsDir.dx, ny = head.y + bfsDir.dy;
    if (nx >= 0 && ny >= 0 && nx < ctx.cols && ny < ctx.rows && !ctx.occupancy.has(key(nx, ny))) {
      return bfsDir;
    }
  }

  let best = null, bestScore = -1;
  for (const d of candidates) {
    const nx = head.x + d.dx, ny = head.y + d.dy;
    if (nx < 0 || ny < 0 || nx >= ctx.cols || ny >= ctx.rows) continue;
    if (ctx.occupancy.has(key(nx, ny))) continue;
    const open = floodOpenSpace(ctx, head.x, head.y, d, Math.max(3, species.agility + 2));
    if (open > bestScore) { bestScore = open; best = d; }
  }
  if (best) return best;

  const sx = head.x + snake.dir.dx, sy = head.y + snake.dir.dy;
  if (sx >= 0 && sy >= 0 && sx < ctx.cols && sy < ctx.rows && !ctx.occupancy.has(key(sx, sy))) return snake.dir;

  return null;
}

function moveSnake(ctx, snake) {
  const dir = chooseDirection(ctx, snake);
  if (!dir) { removeSnake(ctx, snake); return; }

  const turned = (dir.dx !== snake.dir.dx || dir.dy !== snake.dir.dy);
  const head = snake.segments[0];
  const nx = head.x + dir.dx, ny = head.y + dir.dy;
  if (nx < 0 || ny < 0 || nx >= ctx.cols || ny >= ctx.rows) { removeSnake(ctx, snake); return; }

  const k = key(nx, ny);
  const willEat = ctx.appleSet.has(k);
  if (ctx.occupancy.has(k)) { removeSnake(ctx, snake); return; }

  snake.dir = dir;
  snake.stepsSinceTurn = turned ? 0 : snake.stepsSinceTurn + 1;
  snake.segments.unshift({ x: nx, y: ny });
  ctx.occupancy.set(k, snake);

  const species = ctx.cfg.species[snake.species];

  if (ctx.events) ctx.events.push(['m', snake.id, ctx.gameTime, nx, ny, willEat ? 1 : 0]);

  if (willEat) {
    ctx.appleSet.delete(k);
    const idx = ctx.apples.findIndex(a => a.x === nx && a.y === ny);
    if (idx >= 0) ctx.apples.splice(idx, 1);
    ctx.appleEatenCount++;
    spawnApple(ctx);
    if (ctx.snakes.length < ctx.cfg.maxSnakes) {
      spawnSnake(ctx, species, ctx.cfg.startLen, { x: nx, y: ny });
    }
  } else {
    const tail = snake.segments.pop();
    ctx.occupancy.delete(key(tail.x, tail.y));
  }

  snake.nextMoveAt += 1000 / species.speed;
}

function countPop(ctx, speciesName) {
  return ctx.snakes.filter(s => s.species === speciesName).length;
}

// If a species has been extinct for cfg.reseedDelay, spawn a fresh one so
// the broadcast never just... stops. This is what keeps it alive forever
// instead of ending like the original browser demo did on a win/extinction.
function handleReseed(ctx) {
  for (const name of Object.keys(ctx.cfg.species)) {
    const pop = countPop(ctx, name);
    if (pop > 0) { ctx.extinctSince[name] = null; continue; }
    if (ctx.extinctSince[name] == null) { ctx.extinctSince[name] = ctx.gameTime; continue; }
    if (ctx.gameTime - ctx.extinctSince[name] >= ctx.cfg.reseedDelay) {
      const spawned = spawnSnake(ctx, ctx.cfg.species[name], ctx.cfg.startLen, null);
      if (spawned) ctx.extinctSince[name] = null;
      // if it failed to find room, leave extinctSince set — we'll just retry next tick
    }
  }
}

function microTick(ctx, dt) {
  ctx.gameTime += dt;

  for (let i = ctx.snakes.length - 1; i >= 0; i--) {
    if (ctx.gameTime >= ctx.snakes[i].deathAt) removeSnake(ctx, ctx.snakes[i]);
  }

  const due = shuffle(ctx.snakes.filter(s => ctx.gameTime >= s.nextMoveAt));
  for (const s of due) {
    if (ctx.snakes.indexOf(s) === -1) continue; // already removed this tick
    moveSnake(ctx, s);
  }

  handleReseed(ctx);
}

// Advances `state` in place by up to `ms` (capped) of simulated time, in
// small fixed steps so fast species never skip a move.
//
// With { record: true }, also returns a "replay packet": a snapshot of
// the snakes/apples at the *start* of this window, plus every move/birth
// /death/apple event that happened during it, each tagged with the exact
// simulated time it occurred. The client can then replay that whole
// window smoothly in real time (like a short video) instead of only ever
// seeing the state jump straight to its final position once per tick.
function advance(state, ms, opts) {
  const record = !!(opts && opts.record);
  const capped = Math.max(0, Math.min(ms, MAX_CATCHUP_MS));
  if (capped <= 0) return { appliedMs: 0, packet: null };

  const ctx = buildCtx(state);
  const windowStartGameTime = ctx.gameTime;
  let packet = null;
  if (record) {
    ctx.events = [];
    packet = {
      windowStartGameTime,
      baseSnakes: ctx.snakes.map(s => ({ id: s.id, species: s.species, birth: s.birth, segments: s.segments.map(p => ({ x: p.x, y: p.y })) })),
      baseApples: ctx.apples.map(a => ({ x: a.x, y: a.y })),
    };
  }

  let remaining = capped;
  while (remaining > 0) {
    const dt = Math.min(MICRO_STEP_MS, remaining);
    microTick(ctx, dt);
    remaining -= dt;
  }
  flushCtx(state, ctx);

  if (record) {
    packet.windowMs = capped;
    packet.events = ctx.events;
  }
  return { appliedMs: capped, packet };
}

function publicSnapshot(state) {
  return {
    cols: state.cfg.cols,
    rows: state.cfg.rows,
    species: state.cfg.species,
    lifespanMs: state.cfg.lifespan,
    snakes: state.snakes,
    apples: state.apples,
    appleEatenCount: state.appleEatenCount,
    gameTime: state.gameTime,
    startedAt: state.startedAt,
    serverNow: Date.now(),
  };
}

module.exports = { DEFAULT_CFG, createState, advance, publicSnapshot };
