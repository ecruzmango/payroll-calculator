/**
 * Random id generator that also works outside a secure context.
 *
 * crypto.randomUUID() is specified as [SecureContext], so it exists on
 * https:// and on http://localhost but is undefined on a plain LAN address
 * like http://192.168.1.115. Calling it there throws and takes the whole app
 * down, which is exactly the setup used to test on a real phone.
 *
 * crypto.getRandomValues() carries no such restriction, so the fallback builds
 * a v4 UUID from it and is just as random.
 */
export function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}
