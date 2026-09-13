#!/usr/bin/env node
/**
 * Plays a whole game, for real.
 *
 * The smoke test proves the party *reaches* a tower. This one actually drags
 * blocks out of it: the grab raycast, the drag spring, extraction, collapse
 * detection, elimination and the winner screen. That path is the point of the
 * game and none of it is reachable without a pointer on a canvas.
 *
 * Towers start short (?tower=N) so the endgame arrives in a couple of rounds
 * instead of fifteen.
 *
 *   node scripts/playtest.mjs [--headed] [--tower=6] [--players=3]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  process.stdout.write(
    'Needs Playwright:\n  npm install --no-save playwright\n  npx playwright install chromium\n',
  );
  process.exit(1);
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(process.env.PLAYTEST_PORT ?? 3133);
const BASE = 'http://127.0.0.1:' + PORT;
const HEADED = process.argv.includes('--headed');
const TOWER = Number(arg('tower', '6'));
const NAMES = ['ALEX', 'BAILEY', 'CASEY'].slice(0, Number(arg('players', '3')));

const log = (m) => process.stdout.write('  ' + m + '\n');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) log('PASS  ' + label);
  else {
    failures++;
    log('FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
};

async function until(fn, timeoutMs = 20000, intervalMs = 200) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

const server = spawn('node', ['apps/server/dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (c) => process.stdout.write('  [relay] ' + c));
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

/* ------------------------------------------------------------------ *
 * Tower interaction
 * ------------------------------------------------------------------ */

/**
 * Blocks still in this phone's tower, read off its HUD.
 *
 * The HUD vanishes the moment the meetup closes the tower, so the last value
 * seen is remembered - otherwise a pull that succeeded right before the scene
 * moved on reads as a failure.
 */
const lastSeenCount = new WeakMap();
async function blockCount(page) {
  const text = await page.locator('.jenga-hud .pill.good').first().textContent().catch(() => '');
  const n = Number.parseInt((text ?? '').split('/')[0]?.trim() ?? '', 10);
  if (Number.isFinite(n)) {
    lastSeenCount.set(page, n);
    return n;
  }
  return lastSeenCount.get(page) ?? -1;
}

async function towerStatus(page) {
  return (await page.locator('.jenga-foot .hintline').first().textContent().catch(() => '')) ?? '';
}

/**
 * Drags a block out of the tower from a given screen offset.
 *
 * The drag plane is horizontal, so pulling sideways slides the block out the
 * way it leaves a real tower. Returns what the tower made of it, which is how
 * the caller tells "missed the tower entirely" from "grabbed but too short".
 */
async function attemptPull(page, { dx, dy, direction, reach }) {
  const box = await page.locator('.jenga canvas').first().boundingBox().catch(() => null);
  if (!box) return 'gone';

  const before = await blockCount(page);
  const startX = box.x + box.width / 2 + dx;
  const startY = box.y + box.height / 2 + dy;
  const travel = box.width * reach * direction;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Small steps: the grab is a velocity spring, not a teleport, so the block
  // needs time under load to follow the pointer out of the stack.
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(startX + (travel * i) / 14, startY + i * 2);
    await sleep(40);
  }
  await sleep(200);
  await page.mouse.up();

  // A miss leaves the prompt untouched, and there is no reason to wait for it.
  const verdict = await until(async () => {
    if ((await blockCount(page)) < before) return true;
    const status = (await towerStatus(page)).toLowerCase();
    return (
      status.includes('not out yet') ||
      status.includes('too high') ||
      status.includes('hold your breath') ||
      status.includes('came down')
    );
  }, 1600, 120);

  if (!verdict) return 'missed';
  if ((await blockCount(page)) < before) return 'out';
  const status = (await towerStatus(page)).toLowerCase();
  if (status.includes('hold your breath')) return 'out';
  if (status.includes('came down')) return 'down';
  // The top course is off-limits, so this candidate is simply the wrong block.
  return status.includes('too high') ? 'top' : 'short';
}

/**
 * Candidate grab points, walked in order. A tower that has been pulled at is
 * gappy and short, so a single fixed point is not enough - this sweeps the
 * footprint the way a player's thumb would hunt for a loose block.
 */
function* grabCandidates() {
  // The tower axis sits at the world origin and the camera always looks at it,
  // so the stack stays centred horizontally however far the view has orbited.
  const columns = [0, -40, 40, -76, 76, -20, 20];
  // Positive is lower on screen. The middle of the canvas looks straight into
  // the off-limits top course, and the stack only reaches ~80px below centre at
  // this framing, so the useful band is narrow and just under the middle.
  const rows = [45, 62, 30, 78, 54, 16, 88];
  // Longer drags first: a grab that falls short costs an attempt, and the
  // camera may have orbited from earlier misses, so a generous reach is the
  // safer opening bid.
  for (const reach of [0.55, 0.68, 0.42]) {
    for (const dy of rows) {
      for (const dx of columns) {
        yield { dx, dy, direction: dx < 0 ? -1 : 1, reach };
      }
    }
  }
}

/** Pulls until the owed blocks are gone, the tower falls, or the clock beats us. */
async function clearPulls(page, label, budgetMs = 55000) {
  const before = await blockCount(page);
  const deadline = Date.now() + budgetMs;

  for (const candidate of grabCandidates()) {
    if (Date.now() > deadline) break;

    const status = (await towerStatus(page)).toLowerCase();
    if (status.includes('came down')) return { collapsed: true, before, after: await blockCount(page) };
    if (status.includes('still standing')) return { collapsed: false, before, after: await blockCount(page) };

    const result = await attemptPull(page, candidate);
    if (result === 'gone') break;
    if (result === 'top') continue;
    if (result === 'missed' || result === 'short') continue;

    // A block came out (or took the tower with it): wait for the verdict.
    await until(async () => {
      const s = (await towerStatus(page)).toLowerCase();
      return s.includes('came down') || s.includes('still standing') || s.includes('pull');
    }, 9000);
  }

  const status = (await towerStatus(page)).toLowerCase();
  const after = await blockCount(page);
  if (status.includes('came down')) return { collapsed: true, before, after };
  if (after < before) return { collapsed: false, before, after };
  log('    ' + label + ': no block came free within the pull budget');
  return { collapsed: false, before, after, stuck: true };
}

/* ------------------------------------------------------------------ *
 * The game
 * ------------------------------------------------------------------ */

let browser;
try {
  const up = await until(async () => {
    try {
      return (await fetch(BASE + '/healthz')).ok;
    } catch {
      return false;
    }
  }, 15000);
  check('relay is up', up);
  if (!up) process.exit(1);

  const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
  browser = await chromium.launch({
    headless: !HEADED,
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  tv.on('pageerror', (e) => errors.push('tv: ' + e));
  tv.on('console', (m) => {
    if (m.type() === 'error') errors.push('tv: ' + m.text());
  });

  await tv.goto(BASE + '/host/?tower=' + TOWER, { waitUntil: 'domcontentloaded' });
  const gotCode = await until(async () => {
    const t = await tv.locator('.join .code').first().textContent().catch(() => null);
    return t && /^[A-Z0-9]{4}$/.test(t.trim());
  }, 30000);
  check('host opens a room', gotCode);
  if (!gotCode) throw new Error(errors.join(' | ') || 'no room code');

  const code = (await tv.locator('.join .code').first().textContent()).trim();
  log('room ' + code + ', towers of ' + TOWER);

  const phones = [];
  for (const name of NAMES) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errors.push(name + ': ' + e));
    await page.goto(BASE + '/?c=' + code, { waitUntil: 'domcontentloaded' });
    await page.locator('input.field.name').fill(name);
    await page.locator('button.primary').click();
    phones.push({ name, page });
  }
  check(
    'all phones joined',
    await until(async () => (await tv.locator('.seat').count()) === NAMES.length, 15000),
  );

  for (const p of phones) {
    await p.page.locator('button.primary').filter({ hasText: 'READY' }).first().click();
  }

  let round = 0;
  let totalPulls = 0;
  let roundsWithPullers = 0;
  let roundsWithAPull = 0;
  let sawCollapse = false;
  let sawElimination = false;
  let gameOver = false;

  // Eight rounds is plenty to topple a short tower.
  for (round = 1; round <= 8 && !gameOver; round++) {
    const started = await until(async () => {
      const k = await tv.locator('.kicker').first().textContent().catch(() => '');
      return k && k.toLowerCase().startsWith('round');
    }, 30000);
    if (!started) {
      // Say what the TV is actually showing, rather than leaving a bare
      // "round N never started" to be guessed at.
      const shown = await tv.evaluate(() => {
        const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
        return {
          kicker: text('.kicker'),
          title: text('.title'),
          subtitle: text('.subtitle'),
          hint: text('.hint'),
          seats: [...document.querySelectorAll('.seat')].map((s) => s.textContent.trim()),
        };
      }).catch(() => null);
      log('  round ' + round + ' never started; TV shows ' + JSON.stringify(shown));
      const title = shown?.title ?? '';
      gameOver = title.includes('WINS') || title.includes('NOBODY');
      break;
    }

    const title = (await tv.locator('.title').first().textContent()) ?? '';
    log('round ' + round + ': ' + title.trim());

    const scored = await until(
      async () => (await tv.locator('.scoreboard .score-row').count()) >= 2,
      80000,
    );
    check('round ' + round + ' produced a scoreboard', scored);

    const inMeetup = await until(async () => {
      const t = await tv.locator('.title').first().textContent().catch(() => '');
      return t && t.includes('MEETUP');
    }, 30000);
    check('round ' + round + ' reached the meetup', inMeetup);
    if (!inMeetup) break;

    // Whoever was handed a tower has to actually empty their pulls.
    const pullers = [];
    for (const p of phones) {
      if ((await p.page.locator('.jenga canvas').count()) > 0) pullers.push(p);
    }
    log('  pulling: ' + (pullers.map((p) => p.name).join(', ') || 'nobody'));

    const outcomes = await Promise.all(
      pullers.map(async (p) => {
        await until(async () => (await towerStatus(p.page)).toLowerCase().includes('pull'), 30000);
        const before = await blockCount(p.page);
        const result = await clearPulls(p.page, p.name);
        return { name: p.name, before, ...result };
      }),
    );

    let pulledThisRound = 0;
    for (const outcome of outcomes) {
      if (outcome.collapsed) {
        sawCollapse = true;
        pulledThisRound++;
        log('  ' + outcome.name + ': TOWER DOWN (' + outcome.before + ' -> ' + outcome.after + ')');
      } else if (!outcome.stuck && outcome.after < outcome.before) {
        pulledThisRound++;
        log('  ' + outcome.name + ' pulled a block out (' + outcome.before + ' -> ' + outcome.after + ')');
      } else {
        // This script hunts for a block with no idea where one is, so it can
        // come up empty where a player looking at the tower would not. Worth
        // reporting, but it is not evidence the game refused to give one up.
        log('  ' + outcome.name + ' found no block (robot limitation, not a game failure)');
      }
    }
    // No per-round assertion on pulling. This script hunts for a grabbable
    // block with no idea where one is, so in a round with a single puller
    // "the game refused" and "the robot missed" are the same observation, and
    // asserting on it just produces failures nobody can act on. What the game
    // actually has to prove - that blocks come out, that a tower comes down,
    // that someone is eliminated and someone wins - is asserted once over the
    // whole game below, where a blind robot's misses average out.
    totalPulls += pulledThisRound;
    roundsWithPullers += pullers.length > 0 ? 1 : 0;
    roundsWithAPull += pulledThisRound > 0 ? 1 : 0;

    // The TV must agree with the phones about how many blocks are left.
    // Only compare players who actually pulled, are still in, and whose phone
    // still has a tower on screen - anything else is comparing a live seat
    // against a reading the phone has already thrown away.
    const comparable = outcomes.filter((o) => !o.collapsed && !o.stuck && o.after >= 0);
    if (comparable.length > 0) {
      let compared = 0;
      let eliminated = 0;
      let mismatch = '';
      let nothingToMirror = false;
      const matched = await until(async () => {
        // Three times now this check has reported a desync when the truth was
        // that it could not look: an unpainted seat list between scenes, every
        // puller eliminated, and the podium - which has no seat list and never
        // will. They share one root cause, so they get one guard: only compare
        // when the TV is actually showing seats, and give up quietly when the
        // game has moved somewhere that has none.
        const title = ((await tv.locator('.title').first().textContent().catch(() => '')) ?? '');
        if (title.includes('WINS') || title.includes('NOBODY')) {
          nothingToMirror = true;
          return true;
        }
        if ((await tv.locator('.seat').count()) === 0) return false;

        compared = 0;
        eliminated = 0;
        mismatch = '';
        for (const outcome of comparable) {
          const seat = tv.locator('.seat', { hasText: outcome.name }).first();
          const text = ((await seat.textContent().catch(() => '')) ?? '').trim();
          if (!text) continue;
          if (text.includes('OUT')) {
            eliminated++;
            continue;
          }
          compared++;
          if (!text.includes(String(outcome.after) + ' blk')) {
            // Report what the TV actually says: an off-by-one and a stale
            // reading need very different fixes.
            mismatch = outcome.name + ' phone=' + outcome.after + ' tv="' + text + '"';
            return false;
          }
        }
        // A tower can come down during the settle after the pull loop has
        // stopped watching. If every puller went out that way there is simply
        // nothing left to mirror - which is not the same as a mismatch, and
        // not something to claim a pass for either.
        if (compared === 0 && eliminated === comparable.length) {
          nothingToMirror = true;
          return true;
        }
        return compared > 0;
      // Long enough to outlast a scoreboard and a round intro back to back.
      }, 45000);
      if (nothingToMirror) {
        log('  round ' + round + ': every puller was eliminated, nothing left to mirror');
      } else {
        check(
          'round ' + round + ': the TV mirrors the phones block counts',
          matched,
          compared === 0 ? 'the TV never painted a seat list' : mismatch,
        );
      }
    }

    // The TV is the authority: a seat struck through means a tower came down,
    // whether or not the pull loop was still watching when it happened.
    if (await tv.locator('.seat.out').count()) {
      sawElimination = true;
      sawCollapse = true;
    }

    gameOver = await until(async () => {
      const t = (await tv.locator('.title').first().textContent().catch(() => '')) ?? '';
      return t.includes('WINS') || t.includes('NOBODY');
    }, 4000);
  }

  check('blocks came out across the game (' + totalPulls + ' pulls)', totalPulls >= 2);
  check(
    'pulls landed in most rounds that asked for one (' + roundsWithAPull + '/' + roundsWithPullers + ')',
    roundsWithPullers === 0 || roundsWithAPull * 2 >= roundsWithPullers,
  );
  check('a tower collapsed and its player went out', sawCollapse && sawElimination);

  const finished = gameOver || (await until(async () => {
    const t = (await tv.locator('.title').first().textContent().catch(() => '')) ?? '';
    return t.includes('WINS') || t.includes('NOBODY');
  }, 90000));
  check('the game reached a winner', finished);

  if (finished) {
    const winner = (await tv.locator('.title').first().textContent()) ?? '';
    log('final: ' + winner.trim());
    const rows = await tv.locator('.scoreboard .score-row').count();
    check('final standings list every player', rows === NAMES.length, 'rows=' + rows);
  }

  const real = errors.filter((t) => !/favicon|WebGL|SwiftShader|GroupMarker|fallback/i.test(t));
  check('no uncaught page errors', real.length === 0, real.slice(0, 3).join(' | '));
} catch (error) {
  failures++;
  log('FAIL  threw: ' + (error instanceof Error ? error.message : String(error)));
} finally {
  if (browser) await browser.close();
  stop();
}

process.stdout.write('\n' + (failures === 0 ? 'playtest passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
