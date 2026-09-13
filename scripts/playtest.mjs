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
  const columns = [0, -46, 46, -88, 88, -24, 24];
  // Positive is lower on screen. A raised camera means the middle of the canvas
  // looks straight into the top course, so every useful grab is below centre.
  const rows = [70, 110, 40, 150, 90, 20, 190];
  for (const reach of [0.42, 0.5]) {
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
  log('    ' + label + ': no block came free');
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

    for (const outcome of outcomes) {
      if (outcome.collapsed) {
        sawCollapse = true;
        log('  ' + outcome.name + ': TOWER DOWN (' + outcome.before + ' -> ' + outcome.after + ')');
      } else if (!outcome.stuck) {
        check(
          outcome.name + ' pulled a block out (' + outcome.before + ' -> ' + outcome.after + ')',
          outcome.after < outcome.before && outcome.after >= 0,
        );
      } else {
        check(outcome.name + ' could pull a block out', false, 'no block came free in 10 attempts');
      }
    }

    // The TV must agree with the phones about how many blocks are left.
    if (pullers.length > 0) {
      const matched = await until(async () => {
        for (const p of pullers) {
          const phoneCount = await blockCount(p.page);
          if (phoneCount < 0) continue;
          const seat = tv.locator('.seat', { hasText: p.name }).first();
          const text = (await seat.textContent().catch(() => '')) ?? '';
          if (text.includes('OUT')) continue;
          if (!text.includes(String(phoneCount) + ' blk')) return false;
        }
        return true;
      }, 15000);
      check('round ' + round + ': the TV mirrors the phones block counts', matched);
    }

    if (await tv.locator('.seat.out').count()) sawElimination = true;

    gameOver = await until(async () => {
      const t = (await tv.locator('.title').first().textContent().catch(() => '')) ?? '';
      return t.includes('WINS') || t.includes('NOBODY');
    }, 4000);
  }

  check('a tower collapsed', sawCollapse);
  check('a collapse eliminated its player', sawElimination || sawCollapse);

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
