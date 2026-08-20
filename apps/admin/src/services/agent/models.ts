import { useEffect, useState } from 'react';

/**
 * Agent 可用模型清单（admin 端复用）
 *
 * GET /api/v1/agent/models —— 后端按 enabled + chat-capable 过滤。
 */
export interface AgentModelItem {
  providerCode: string;
  providerName?: string | null;
  providerIcon?: string | null;
  modelId: string;
  displayName?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  isDefault?: boolean;
  abilities?: Record<string, boolean>;
  extendParams?: string[];
  settings?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  disabledParams?: string[];
  source?: string | null;
  releasedAt?: string | null;
  description?: string | null;
  scope?: 'user' | 'system';
  /** 每百万 token 定价（USD），/agent/models 下发；缺省时前端不展示成本。 */
  inputCostPer1M?: number | null;
  outputCostPer1M?: number | null;
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

/**
 * @param reloadToken 变化即重新拉取。灵境工作台跨路由保活后不再重挂载，而用户
 * 可能刚在 /ai-config 里启用 / 停用 / 改过模型 —— 回到灵境时靠 bump 这个值把
 * 清单刷新，否则新启用的模型不可见、已停用的仍可选，直到整页刷新。
 */
export function useAgentModels(enabled: boolean, reloadToken = 0): ModelsState {
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
  }, [enabled, reloadToken]);

  return state;
}

export function modelLabel(item: AgentModelItem): string {
  return item.displayName?.trim() || item.modelId;
}

export function providerLabel(item: AgentModelItem): string {
  return item.providerName?.trim() || item.providerCode;
}
