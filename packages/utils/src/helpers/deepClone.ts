/**
 * 深拷贝工具
 */

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Map) {
    const result = new Map();
    obj.forEach((value, key) => {
      result.set(deepClone(key), deepClone(value));
    });
    return result as T;
  }

  if (obj instanceof Set) {
    const result = new Set();
    obj.forEach((value) => {
      result.add(deepClone(value));
    });
    return result as T;
  }

  const result = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (result as Record<string, unknown>)[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
  }
  return result;
}
