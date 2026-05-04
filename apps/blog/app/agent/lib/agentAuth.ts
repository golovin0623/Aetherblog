'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Agent 模块的鉴权 Hook —— 复用后端 `/api/v1/auth/*`，与 admin 同源。
 *
 * 与 admin 后台的差别只有一点：这里不要求 role==admin。任何已登录用户
 * （admin / editor / user）都能进入 Agent 工作台。后端 `/auth/me` 返回
 * 的 role 仅作展示用，不参与门禁逻辑。
 *
 * 凭据通过 HttpOnly Cookie（`Bearer` access token + refresh token）持有，
 * 前端永远不直接读取 token —— 只通过同源 fetch 携带 Cookie 间接使用。
 */
export interface AgentUser {
  id: number;
  username: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  role: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'authed'; user: AgentUser }
  | { status: 'guest' };

interface MeResponse {
  code?: number;
  data?: AgentUser;
  message?: string;
}

async function fetchMe(signal?: AbortSignal): Promise<AgentUser | null> {
  try {
    const res = await fetch('/api/v1/auth/me', {
      credentials: 'include',
      signal,
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as MeResponse;
    if (!json?.data || typeof json.data.id !== 'number') return null;
    return json.data;
  } catch {
    return null;
  }
}

export function useAgentAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const user = await fetchMe();
    setState(user ? { status: 'authed', user } : { status: 'guest' });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal).then((user) => {
      if (controller.signal.aborted) return;
      setState(user ? { status: 'authed', user } : { status: 'guest' });
    });
    return () => controller.abort();
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* swallow — 网络错误时也按 guest 处理 */
    }
    setState({ status: 'guest' });
  }, []);

  return { state, refresh, logout };
}

/**
 * 直接调用 /auth/login。返回 null 表示成功（cookie 已写入），string 表示错误信息。
 */
export async function loginAgent(username: string, password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return (json && typeof json.message === 'string' && json.message) || `登录失败 (HTTP ${res.status})`;
    }
    if (json?.code !== undefined && json.code !== 0 && json.code !== 200) {
      return (typeof json.message === 'string' && json.message) || '登录失败';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : '网络错误';
  }
}
