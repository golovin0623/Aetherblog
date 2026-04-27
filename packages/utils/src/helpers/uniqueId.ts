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
  // 现代运行时自带 Crypto.randomUUID —— 免费获得 RFC 4122 v4。
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兜底:从 CSPRNG 字节手动构建 v4（禁用 Math.random）。
  if (crypto && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // 版本 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // 变体 10
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // 仅在完全无 crypto 的环境下使用最终兜底（裸 SSR）。故意输出
  // 可见前缀以便调用方察觉降级。
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
  // 裸 SSR 兜底；理由同 uuid()。
  let id = '';
  for (let i = 0; i < size; i++) id += alphabet[(Date.now() + i) & 63];
  return `nocrypto-${id}`;
}
