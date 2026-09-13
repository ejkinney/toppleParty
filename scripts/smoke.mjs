#!/usr/bin/env node
/**
 * End-to-end smoke test: boots the production build, opens the TV page in a
 * real browser, joins two phones, readies up, and asserts that the party gets
 * all the way through a minigame, a scoreboard, a tower pull and back.
 *
 * This exists because every interesting failure in this game lives in the
 * seams - WebGL init, the wasm load, the relay handshake, the scene promises -
 * and none of them are visible to a type checker.
 *
 *   node scripts/smoke.mjs [--headed] [--keep]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';

// Playwright is deliberately not a dependency: cloning this repo to play a
// party game should not pull a browser down with it.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  process.stdout.write(
    [
      'The smoke test needs Playwright, which is not installed by default.',
      '',
      '  npm install --no-save playwright',
      '  npx playwright install chromium',
      '',
      'Then run it again with: npm run smoke',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const PORT = Number(process.env.SMOKE_PORT ?? 3111);
const BASE = 'http://127.0.0.1:' + PORT;
const HEADED = process.argv.includes('--headed');
const KEEP = process.argv.includes('--keep');

const log = (message) => process.stdout.write('  ' + message + '\n');

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    log('PASS  ' + label);
  } else {
    failures++;
    log('FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
}

/** Waits for a predicate, polling. Returns false on timeout rather than throwing. */
async function until(predicate, timeoutMs = 20000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

const server = spawn('node', ['apps/server/dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write('  [relay] ' + chunk));
server.stderr.on('data', (chunk) => process.stdout.write('  [relay] ' + chunk));

const stop = () => {
  if (!KEEP) server.kill('SIGTERM');
};
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

let browser;
try {
  const up = await until(async () => {
    try {
      const response = await fetch(BASE + '/healthz');
      return response.ok;
    } catch {
      return false;
    }
  }, 15000);
  check('relay answers /healthz', up);
  if (!up) process.exit(1);

  // Some sandboxes ship a Chromium that does not match the pinned Playwright
  // build; use it when it is there rather than downloading a second one.
  const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
  browser = await chromium.launch({
    headless: !HEADED,
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    // WebGL has to actually work: the whole point is catching renderer faults.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  /* ---------------- host ---------------- */

  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const tvErrors = [];
  tv.on('pageerror', (error) => tvErrors.push(String(error)));
  tv.on('console', (message) => {
    if (message.type() === 'error') tvErrors.push(message.text());
  });

  await tv.goto(BASE + '/host', { waitUntil: 'domcontentloaded' });

  const gotCode = await until(async () => {
    const text = await tv.locator('.join .code').first().textContent().catch(() => null);
    return Boolean(text && /^[A-Z0-9]{4}$/.test(text.trim()));
  }, 30000);
  check('host boots physics and opens a room', gotCode);
  if (!gotCode) throw new Error('no room code: ' + tvErrors.join(' | '));

  const code = (await tv.locator('.join .code').first().textContent()).trim();
  log('room code: ' + code);

  check('lobby renders a QR code', (await tv.locator('.join img').count()) === 1);

  /* ---------------- phones ---------------- */

  const phones = [];
  for (const name of ['ALEX', 'BAILEY']) {
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    phone.on('pageerror', (error) => tvErrors.push(name + ': ' + error));
    await phone.goto(BASE + '/?c=' + code, { waitUntil: 'domcontentloaded' });
    await phone.locator('input.field.name').fill(name);
    await phone.locator('button.primary').click();
    phones.push({ name, page: phone });
  }

  const bothJoined = await until(async () => (await tv.locator('.seat').count()) >= 2, 15000);
  check('two phones appear on the lobby board', bothJoined);

  /* ---------------- reconnect ---------------- */

  // Reload one phone. The resume token in localStorage has to put it back in
  // the same seat without showing the join form again, and the host must not
  // see it as a new player - a fast reconnect races the old socket's close.
  const first = phones[0];
  await first.page.reload({ waitUntil: 'domcontentloaded' });
  const resumed = await until(
    async () => (await first.page.locator('.bar .who').count()) > 0,
    15000,
  );
  check('a reloaded phone resumes its seat', resumed);

  const seatsAfterReload = await tv.locator('.seat').count();
  check('the reload did not create a second seat', seatsAfterReload === 2, 'seats=' + seatsAfterReload);

  const stillOnline = await until(async () => {
    // playerOffline greys the seat out; it must not stick after a resume.
    return (await tv.locator('.seat.offline').count()) === 0;
  }, 10000);
  check('the resumed player is not left marked offline', stillOnline);

  for (const phone of phones) {
    const ready = await phone.page.locator('button.primary').filter({ hasText: 'READY' }).first();
    await ready.click();
  }

  /* ---------------- a round ---------------- */

  const started = await until(async () => {
    const kicker = await tv.locator('.kicker').first().textContent().catch(() => '');
    return Boolean(kicker && kicker.toLowerCase().startsWith('round'));
  }, 20000);
  check('readying up starts round 1', started);

  const title = (await tv.locator('.title').first().textContent().catch(() => '')) ?? '';
  log('minigame: ' + title.trim());

  const controlsMounted = await until(async () => {
    const counts = await Promise.all(
      phones.map((phone) =>
        phone.page.locator('.pad, .sling, .mash, .tilt, .stick-zone, .center-card').count(),
      ),
    );
    return counts.every((count) => count > 0);
  }, 20000);
  check('both phones mount a control surface', controlsMounted);

  // Ride out the round. Every minigame has a hard duration cap, so the
  // scoreboard has to appear whether or not anybody actually plays well.
  const scoreboard = await until(
    async () => (await tv.locator('.scoreboard .score-row').count()) >= 2,
    70000,
  );
  check('round ends and the scoreboard appears', scoreboard);

  const meetup = await until(async () => {
    const text = await tv.locator('.title').first().textContent().catch(() => '');
    return Boolean(text && text.includes('MEETUP'));
  }, 30000);
  check('meetup scene follows the scoreboard', meetup);

  const towerOpened = await until(async () => {
    const counts = await Promise.all(phones.map((phone) => phone.page.locator('.jenga canvas').count()));
    return counts.some((count) => count > 0);
  }, 25000);
  check('the loser gets a tower to pull', towerOpened);

  const towerReady = await until(async () => {
    for (const phone of phones) {
      const status = await phone.page.locator('.jenga-foot .hintline').first().textContent().catch(() => '');
      if (status && status.toLowerCase().includes('pull')) return true;
    }
    return false;
  }, 30000);
  check('the tower simulation finishes loading', towerReady);

  const mirrored = await until(async () => {
    // The TV mirrors towers as soon as a phone streams transforms.
    const fps = await tv.evaluate(() => document.querySelector('.perf')?.textContent ?? '');
    return fps.includes('fps');
  }, 10000);
  check('host keeps rendering during the meetup', mirrored);

  const realErrors = tvErrors.filter(
    (text) => !/favicon|WebGL|SwiftShader|GroupMarkerNotSet|Automatic fallback/i.test(text),
  );
  check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures++;
  log('FAIL  threw: ' + (error instanceof Error ? error.message : String(error)));
} finally {
  if (browser && !KEEP) await browser.close();
  stop();
}

process.stdout.write('\n' + (failures === 0 ? 'smoke test passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
