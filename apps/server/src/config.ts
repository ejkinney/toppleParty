import { lanAddress } from './lan.js';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * In dev the phones load the controller from Vite, not from us, so the join
   * URL has to point at Vite's port. In prod we serve the controller ourselves.
   */
  dev: process.env.NODE_ENV !== 'production',
  controllerDevPort: int(process.env.CONTROLLER_PORT, 5174),
  /** Set this when tunnelling (ngrok, Cloudflare) so the QR points somewhere public. */
  publicBase: process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? '',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

/** Base URL a phone should open. Prefers an explicit tunnel, then the LAN IP. */
export function joinBase(): string {
  if (config.publicBase) return config.publicBase;
  const ip = lanAddress();
  const port = config.dev ? config.controllerDevPort : config.port;
  return 'http://' + ip + ':' + port;
}
