#!/usr/bin/env node
/**
 * One command to run a party locally: the relay, the TV page and the phone
 * page, with a banner that tells you the exact URL to point a phone at.
 *
 * Kept as a plain script rather than a task runner so there is nothing between
 * a fresh clone and a playable game.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/** Best guess at the address a phone on the same Wi-Fi can reach. */
function lanAddress() {
  const candidates = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && String(entry.family) !== '4') continue;
      const address = entry.address;
      let score = 1;
      if (address.startsWith('192.168.')) score = 4;
      else if (address.startsWith('10.')) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score = 2;
      else if (address.startsWith('169.254.')) score = 0;
      candidates.push({ address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? '127.0.0.1';
}

const parts = [
  { name: 'relay ', args: ['run', 'dev', '-w', '@topple/server'] },
  { name: 'host  ', args: ['run', 'dev', '-w', '@topple/host'] },
  { name: 'phone ', args: ['run', 'dev', '-w', '@topple/controller'] },
];

const children = parts.map((part) => {
  const child = spawn('npm', part.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  // Prefix every line so three servers in one terminal stay readable.
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) process.stdout.write('[' + part.name + '] ' + line + '\n');
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
});

const ip = lanAddress();
setTimeout(() => {
  process.stdout.write(
    [
      '',
      '  TOPPLE PARTY',
      '  ------------',
      '  TV / host display   http://localhost:5173/',
      '  Phones join at      http://' + ip + ':5174/',
      '  Relay               ws://' + ip + ':3000/ws',
      '',
      '  Phones must be on the same Wi-Fi as this machine.',
      '',
      '',
    ].join('\n'),
  );
}, 2500);

const shutdown = () => {
  for (const child of children) child.kill('SIGINT');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
