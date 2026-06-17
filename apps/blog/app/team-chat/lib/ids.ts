// 客户端消息幂等 ID。
// crypto.randomUUID() 仅在安全上下文（HTTPS）+ 现代浏览器可用；本地 HTTP 开发环境
// 或旧版 WebView 下 crypto.randomUUID 为 undefined，直接调用会抛 TypeError 崩溃。
// 这里提供安全回退，确保非安全上下文也能稳定生成唯一标识。
export function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 落到下方回退 */
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
