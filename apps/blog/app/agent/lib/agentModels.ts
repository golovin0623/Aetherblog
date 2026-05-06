'use client';

import { useEffect, useState } from 'react';

/**
 * Agent 可用模型清单
 *
 * 来自 GET /api/v1/agent/models —— 后端按 enabled + chat-capable 过滤。
 * 前端 ModelPicker 直接展示给用户，选中后保存到 session.modelId / providerCode。
 */
export interface AgentModelItem {
  providerCode: string;
  providerName?: string | null;
  modelId: string;
  displayName?: string | null;
  contextWindow?: number | null;
  isDefault?: boolean;
  /** 来源：'user' 表示当前登录用户在该 provider 下有自己的凭证；
   *  'system' 表示用的是管理员配置的系统级凭证。 */
  scope?: 'user' | 'system';
}

interface ModelsResponse {
  code?: number;
  success?: boolean;
  data?: AgentModelItem[];
  message?: string;
}

export type ModelsState =
  | { status: 'loading' }
  | { status: 'ready'; items: AgentModelItem[] }
  | { status: 'error'; message: string };

export function useAgentModels(enabled: boolean): ModelsState {
  const [state, setState] = useState<ModelsState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/v1/agent/models', {
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 80)}` : ''}`);
        }
        const json = (await res.json()) as ModelsResponse;
        if (json?.success === false) {
          throw new Error(json.message || '加载失败');
        }
        const items = Array.isArray(json?.data) ? json.data : [];
        setState({ status: 'ready', items });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : '未知错误',
        });
      });
    return () => controller.abort();
  }, [enabled]);

  return state;
}
