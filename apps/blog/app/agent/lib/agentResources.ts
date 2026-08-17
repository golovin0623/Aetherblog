'use client';

/**
 * Agent picker 用的资源拉取（文章 / 标签）
 *
 * 目的：@ 与 # 按钮分别打开"文章选择器"与"标签选择器"，需要在前端拉到
 * 真实数据。两个端点都走 `/api/v1/agent/*`（已登录鉴权），由 Go handler
 * 直接读本地 DB —— 这部分不经过 ai-service，纯只读名录查询。
 */

import { useEffect, useState } from 'react';

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

/** 分页响应信封 —— 与后端 articleListResponse 对齐。 */
interface ArticleListPayload {
  items?: AgentArticle[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/** picker 默认每页 10 条 —— 与 ArticlePicker 的 UI 固定行数对齐。 */
export const ARTICLE_PAGE_SIZE = 10;

/**
 * 文章 picker 数据源：支持搜索 + 分页。
 *
 *  - query 变化触发 200ms debounce 后重新请求；
 *  - page 变化（同 query）会发新请求拿对应页；
 *  - 搜索路径（query 非空）后端固定不分页：返回单页结果，total = items.length。
 *
 * 切换 query 时由调用方负责把 page 重置为 1（避免在 hook 内做带状态的修正
 * 逻辑导致 effect 抖动）。
 */
export function useArticleSearch(
  query: string,
  enabled: boolean,
  page: number = 1,
  pageSize: number = ARTICLE_PAGE_SIZE,
) {
  const [items, setItems] = useState<AgentArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebouncedValue(query, 200);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (debounced.trim()) params.set('q', debounced.trim());
    const url = `/api/v1/agent/articles?${params.toString()}`;
    fetch(url, { credentials: 'include', signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<ArticleListPayload | AgentArticle[]>;
        if (json?.success === false) throw new Error(json.message || '加载失败');
        const data = json?.data;
        // 兼容旧格式（裸数组）—— 部署滚动期间允许后端先回旧形态。
        if (Array.isArray(data)) {
          setItems(data);
          setTotal(data.length);
          return;
        }
        const list = Array.isArray(data?.items) ? (data!.items as AgentArticle[]) : [];
        setItems(list);
        setTotal(typeof data?.total === 'number' ? data!.total! : list.length);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '未知错误');
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, debounced, page, pageSize]);

  return { items, total, loading, error };
}

export function useAllTags(enabled: boolean) {
  const [items, setItems] = useState<AgentTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch('/api/v1/agent/tags', {
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<AgentTag[]>;
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
  }, [enabled]);

  return { items, loading, error };
}

/** 按 query 在已加载的 tags 里做客户端过滤。 */
export function filterTags(tags: AgentTag[], query: string): AgentTag[] {
  const q = query.trim().toLowerCase();
  if (!q) return tags;
  return tags.filter(
    (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
  );
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
 *
 * 每个命令带 `kind` 标记：
 *   - 'local'  纯前端语义（清屏 / 重发等），不走 LLM；
 *   - 'remote' 把命令模板插入 composer，让用户补完后发送给 LLM。
 *
 * 后续要扩展工作流（例如 /summary 自动总结整段对话）时把对应 handler
 * 接到 WorkspaceClient 的命令派发器即可。
 */
export interface SlashCommand {
  command: string;
  description: string;
  kind: 'local' | 'remote';
  /** remote 命令插入 composer 的模板。 */
  template?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/clear',
    description: '清空当前会话的所有消息（保留会话本身）',
    kind: 'local',
  },
  {
    command: '/context',
    description: '清除上下文 —— 保留消息，模型从此处重新开始记忆',
    kind: 'local',
  },
  {
    command: '/export',
    description: '把当前会话导出为 Markdown 文件',
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

// 保留以备将来：把命令拼回 textarea 时也走同一份模板，避免标签字面与模板分裂。
export function commandTemplate(cmd: SlashCommand): string {
  return cmd.template ?? cmd.command;
}
