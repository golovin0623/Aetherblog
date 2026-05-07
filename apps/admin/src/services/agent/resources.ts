import { useEffect, useState } from 'react';

/**
 * Agent picker 用的资源拉取（admin 端）
 *
 * - 文章搜索：GET /api/v1/agent/articles?q=&limit=
 * - 标签清单：GET /api/v1/agent/tags
 *
 * 与 blog 端 lib/agentResources.ts 共用同一组后端端点（agent_handler.go 注册的
 * /articles 与 /tags 均接受任意已登录用户）。
 */

export interface AgentArticle {
  id: number;
  slug: string;
  title: string;
  summary?: string;
  category?: string;
  publishedAt?: string;
}

export interface AgentTag {
  id: number;
  slug: string;
  name: string;
  postCount: number;
}

interface ApiEnvelope<T> {
  code?: number;
  success?: boolean;
  data?: T;
  message?: string;
}

export function useArticleSearch(query: string, enabled: boolean) {
  const [items, setItems] = useState<AgentArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebouncedValue(query, 200);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const url = debounced.trim()
      ? `/api/v1/agent/articles?q=${encodeURIComponent(debounced.trim())}&limit=20`
      : `/api/v1/agent/articles?limit=12`;
    fetch(url, { credentials: 'include', signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<AgentArticle[]>;
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

function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/**
 * Agent 工作台内置斜杠命令清单
 *   - 'local'  纯前端语义（清屏 / 重发等），不走 LLM
 *   - 'remote' 把命令模板插入 composer，让用户补完后发送
 */
export interface SlashCommand {
  command: string;
  description: string;
  kind: 'local' | 'remote';
  template?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/clear',
    description: '清空当前会话的所有消息（保留会话本身）',
    kind: 'local',
  },
  {
    command: '/new',
    description: '新建一个对话',
    kind: 'local',
  },
  {
    command: '/regen',
    description: '重新生成上一条 Agent 回复',
    kind: 'local',
  },
  {
    command: '/summarize',
    description: '让 Agent 总结当前对话',
    kind: 'remote',
    template: '请用 3-5 个要点总结我们刚才的讨论。',
  },
  {
    command: '/explain',
    description: '解释一个概念（@ 选文章后再用）',
    kind: 'remote',
    template: '请基于上面引用的文章，给我一个简明的解释。',
  },
  {
    command: '/translate',
    description: '把上一条用户消息翻译成英文',
    kind: 'remote',
    template: '请把我刚才发送的中文翻译成自然的英文。',
  },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) =>
      c.command.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
  );
}
