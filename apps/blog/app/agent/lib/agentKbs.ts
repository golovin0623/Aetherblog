'use client';

import { useEffect, useState } from 'react';
import { useDebounce } from '@aetherblog/hooks';

/**
 * Agent 知识库 picker 数据源
 *
 * GET /api/v1/agent/knowledge-bases?q=<keyword> —— 只返回当前用户
 * EffectivePermission ∈ {USE, EDIT, MANAGE} 的知识库（后端 kb_service 过滤）。
 * SYSTEM_POSTS 是站点文章库（永远可用）；CUSTOM 需要 activeProfile 且
 * chunkCount > 0 才真正可召回 —— picker 里把"未就绪"的库降级展示。
 */

export type AgentKbKind = 'SYSTEM_POSTS' | 'CUSTOM';

/** picker 列表项（后端 AgentKnowledgeBaseVO 的前端子集）。 */
export interface AgentKnowledgeBase {
  id: number;
  slug: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  kind: AgentKbKind;
  fileCount?: number;
  chunkCount?: number;
  /** 后端返回 activeProfile 对象；这里只关心"有没有"。 */
  activeProfile?: unknown;
}

/** 存进会话 / 消息的轻量引用 —— 不携带统计与 profile，避免 localStorage 膨胀。 */
export interface AgentKbRef {
  id: number;
  slug: string;
  name: string;
  kind: AgentKbKind;
}

export function toKbRef(kb: AgentKnowledgeBase): AgentKbRef {
  return { id: kb.id, slug: kb.slug, name: kb.name, kind: kb.kind };
}

/** CUSTOM 库没有就绪索引时召回必然为空 —— picker 用它标注"未就绪"。 */
export function isKbReady(kb: AgentKnowledgeBase): boolean {
  if (kb.kind === 'SYSTEM_POSTS') return true;
  return kb.activeProfile != null && (kb.chunkCount ?? 0) > 0;
}

interface ApiEnvelope<T> {
  code?: number;
  success?: boolean;
  data?: T;
  message?: string;
}

export function useAgentKnowledgeBases(enabled: boolean, query: string) {
  const [items, setItems] = useState<AgentKnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebounce(query, 200);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (debounced.trim()) params.set('q', debounced.trim());
    const qs = params.toString();
    fetch(`/api/v1/agent/knowledge-bases${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<AgentKnowledgeBase[]>;
        if (json?.success === false) throw new Error(json.message || '加载失败');
        setItems(Array.isArray(json?.data) ? json.data : []);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '未知错误');
        setItems([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, debounced]);

  return { items, loading, error };
}
