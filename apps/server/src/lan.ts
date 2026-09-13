import { networkInterfaces } from 'node:os';

/**
 * Best guess at the address a phone on the same Wi-Fi can reach.
 * Private ranges are preferred over anything else, and link-local is a last
 * resort - a 169.254 address in the QR code means the host is not on a network.
 */
export function lanAddress(): string {
  const candidates: { address: string; score: number }[] = [];
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
