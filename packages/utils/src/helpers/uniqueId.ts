/**
 * 唯一ID生成
 */

let counter = 0;

export function uniqueId(prefix = ''): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nanoid(size = 21): string {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  let id = '';
  for (let i = 0; i < size; i++) {
    id += alphabet[(Math.random() * 64) | 0];
  }
  return id;
}
