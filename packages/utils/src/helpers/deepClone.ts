/**
 * 深拷贝工具
 */

export function deepClone<T>(obj: T, seen = new WeakSet()): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (seen.has(obj as object)) {
    return obj;
  }
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item, seen)) as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Map) {
    const result = new Map();
    obj.forEach((value, key) => {
      result.set(deepClone(key, seen), deepClone(value, seen));
    });
    return result as T;
  }

  if (obj instanceof Set) {
    const result = new Set();
    obj.forEach((value) => {
      result.add(deepClone(value, seen));
    });
    return result as T;
  }

  const result = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (result as Record<string, unknown>)[key] = deepClone((obj as Record<string, unknown>)[key], seen);
    }
  }
  return result;
}
