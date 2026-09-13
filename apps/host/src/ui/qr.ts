import QRCode from 'qrcode';

/**
 * QR codes are generated once per room and cached: regenerating on every lobby
 * repaint was the only allocation big enough to show up in a profile.
 */
const cache = new Map<string, string>();

export async function qrDataUrl(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) return hit;
  const dataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b1020ff', light: '#ffffffff' },
  });
  cache.set(url, dataUrl);
  return dataUrl;
}
