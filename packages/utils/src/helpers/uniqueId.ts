/**
 * 唯一ID生成
 *
 * SECURITY (VULN-096): 历史实现用 Math.random() 产生 uuid/nanoid。对于仅作
 * React key / 视觉性 id 无害；但业务层也用它们当作 session token / share
 * key，攻击者可预测 PRNG 序列（V8 的 XorShift128+ 状态可从少量输出逆推）。
 * 切到 crypto.getRandomValues —— 浏览器 / Node 18+ 都支持，只需一次特性
 * 探测兜底。
 */

function getCryptoSource(): Crypto | undefined {
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { crypto?: Crypto }).crypto) {
    return (globalThis as unknown as { crypto?: Crypto }).crypto;
  }
  return undefined;
}

let counter = 0;

export function uniqueId(prefix = ''): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function uuid(): string {
  const crypto = getCryptoSource();
  // Modern runtimes ship Crypto.randomUUID — RFC 4122 v4 for free.
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: build v4 manually from CSPRNG bytes (Math.random is banned).
  if (crypto && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // Last-ditch ONLY in environments without any crypto (bare SSR). Emit a
  // deliberately visible prefix so callers notice the downgrade.
  return `nocrypto-${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

export function nanoid(size = 21): string {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  const crypto = getCryptoSource();
  if (crypto && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    let id = '';
    for (let i = 0; i < size; i++) id += alphabet[bytes[i] & 63];
    return id;
  }
  // Bare-SSR fallback; same reasoning as uuid().
  let id = '';
  for (let i = 0; i < size; i++) id += alphabet[(Date.now() + i) & 63];
  return `nocrypto-${id}`;
}
