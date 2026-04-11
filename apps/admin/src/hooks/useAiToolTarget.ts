import { useState, useCallback, useEffect, useRef } from 'react';
import { postService, Post, PostListItem, CreatePostRequest } from '@/services/postService';
import { tagService } from '@/services/tagService';
import { toast } from 'sonner';

/**
 * AI 工具箱的"目标文章"抽象：所有"应用到文章"动作都通过该 hook 调度。
 *
 * 设计要点：
 * - targetPostId 通过 localStorage 持久化，避免重载时丢失。
 * - `applySummary / applyTitle / applyTags` 使用 PATCH
 *   (`postService.updateProperties`) 语义做局部字段更新。
 * - `applyContent` 使用 PUT (`postService.update`) 语义做正文写入，但
 *   **必须**从缓存的 `targetPost` 重建一个完整的 `CreatePostRequest`
 *   负载（Go 端 `PostService.Update` 会把请求之外的字段置空并重置
 *   tags/category——这是一个历史陷阱，详见 `service/post_service.go:186`）。
 *   正文级操作（polish / translate / outline）均为破坏性，由调用方先用
 *   ConfirmModal 确认，本 hook 只做"执行"。
 * - 无 target 时，apply 动作会 toast 错误并返回 `false`；调用方在无
 *   target 情况下应改用 `copyToClipboard` 作为 fallback（见 ToolResultRenderer）。
 * - tag 追加：名称统一 lowercase 去重，缺失的批量并行创建，与现有 tagIds 合并。
 */

export type ContentApplyMode = 'replace' | 'append';

export interface AiToolTargetApi {
  targetPostId: number | null;
  targetPost: Post | null;
  isLoading: boolean;
  recentPosts: PostListItem[];
  setTargetPostId: (id: number | null) => void;
  refreshTarget: () => Promise<void>;
  refreshRecentPosts: () => Promise<void>;

  applySummary: (summary: string) => Promise<boolean>;
  applyTitle: (title: string) => Promise<boolean>;
  applyTags: (tagNames: string[]) => Promise<boolean>;
  applyContent: (text: string, mode: ContentApplyMode) => Promise<boolean>;

  copyToClipboard: (text: string, label?: string) => Promise<void>;
  /**
   * 按 ID 获取目标文章的正文字符串，不做任何额外处理（不写剪贴板）。
   * 命名上避免和 `copyToClipboard` 混淆。
   */
  loadPostContent: (id: number) => Promise<string | null>;
}

const TARGET_KEY = 'ai-tools:target-post-id';

const readStoredTarget = (): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(TARGET_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const persistTarget = (id: number | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (id === null) {
      window.localStorage.removeItem(TARGET_KEY);
    } else {
      window.localStorage.setItem(TARGET_KEY, String(id));
    }
  } catch {
    /* ignore quota / privacy errors */
  }
};

/**
 * 将缓存的 `Post` 重建为 `CreatePostRequest` 负载，供 `postService.update`
 * 使用。关键：必须覆盖全部字段——否则 Go 端 PostService.Update 会把遗漏的
 * 字段置空（title/summary 变 ""，tags 被 `SetTags([])` 清空）。
 */
function rebuildFullUpdatePayload(
  post: Post,
  overrides: Partial<CreatePostRequest>,
): Partial<CreatePostRequest> {
  // PUBLISHED / DRAFT 都允许直接透传；ARCHIVED 不在 CreatePostRequest 枚举
  // 内，此种情况下不改动 status（让后端保留 existing.Status）。
  const status =
    post.status === 'PUBLISHED' || post.status === 'DRAFT' ? post.status : undefined;

  const base: Partial<CreatePostRequest> = {
    title: post.title,
    content: post.content || '',
    summary: post.summary || '',
    coverImage: post.coverImage || undefined,
    categoryId: post.categoryId ?? undefined,
    tagIds: (post.tags || []).map((t) => t.id),
    status,
  };
  return { ...base, ...overrides };
}

export function useAiToolTarget(): AiToolTargetApi {
  const [targetPostId, setTargetPostIdState] = useState<number | null>(() => readStoredTarget());
  const [targetPost, setTargetPost] = useState<Post | null>(null);
  const [recentPosts, setRecentPosts] = useState<PostListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Guard against stale responses when the user switches targets rapidly.
  const requestSeqRef = useRef(0);

  const setTargetPostId = useCallback((id: number | null) => {
    setTargetPostIdState(id);
    persistTarget(id);
  }, []);

  const refreshTarget = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    if (targetPostId === null) {
      setTargetPost(null);
      return;
    }
    setIsLoading(true);
    try {
      const res = await postService.getById(targetPostId);
      if (seq !== requestSeqRef.current) return;
      if (res.code === 200 && res.data) {
        setTargetPost(res.data);
      } else {
        setTargetPost(null);
      }
    } catch {
      if (seq === requestSeqRef.current) {
        setTargetPost(null);
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [targetPostId]);

  const refreshRecentPosts = useCallback(async () => {
    try {
      const res = await postService.getList({ pageNum: 1, pageSize: 20 });
      if (res.code === 200 && res.data) {
        setRecentPosts(res.data.list || []);
      }
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    refreshTarget();
  }, [refreshTarget]);

  useEffect(() => {
    refreshRecentPosts();
  }, [refreshRecentPosts]);

  const requireTarget = useCallback((): number | null => {
    if (targetPostId === null) {
      toast.error('请先在工作台顶部选择目标文章');
      return null;
    }
    return targetPostId;
  }, [targetPostId]);

  const applySummary = useCallback(async (summary: string) => {
    const id = requireTarget();
    if (id === null) return false;
    try {
      const res = await postService.updateProperties(id, { summary });
      if (res.code === 200) {
        toast.success('已更新文章摘要');
        await refreshTarget();
        return true;
      }
      toast.error(res.message || '更新摘要失败');
      return false;
    } catch {
      toast.error('更新摘要失败');
      return false;
    }
  }, [requireTarget, refreshTarget]);

  const applyTitle = useCallback(async (title: string) => {
    const id = requireTarget();
    if (id === null) return false;
    try {
      const res = await postService.updateProperties(id, { title });
      if (res.code === 200) {
        toast.success('已更新文章标题');
        await refreshTarget();
        return true;
      }
      toast.error(res.message || '更新标题失败');
      return false;
    } catch {
      toast.error('更新标题失败');
      return false;
    }
  }, [requireTarget, refreshTarget]);

  const applyTags = useCallback(async (tagNames: string[]) => {
    const id = requireTarget();
    if (id === null) return false;
    if (!targetPost) {
      toast.error('目标文章尚未加载完成，请稍后重试');
      return false;
    }

    // Case-insensitive dedupe with original casing preserved (first occurrence wins).
    // 防止 ["AI", "ai"] 被当作两个不同的标签导致重复创建。
    const seenLower = new Set<string>();
    const normalized: string[] = [];
    for (const raw of tagNames) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.length > 50) continue;
      const key = trimmed.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      normalized.push(trimmed);
    }
    if (normalized.length === 0) {
      toast.error('没有可应用的标签');
      return false;
    }

    try {
      const listRes = await tagService.getList();
      if (listRes.code !== 200) {
        toast.error(listRes.message || '获取标签列表失败');
        return false;
      }
      const byName = new Map(
        (listRes.data || []).map((t) => [t.name.trim().toLowerCase(), t]),
      );

      // 先一次性分出"已存在 / 需新建"两组，避免 N 次串行 create。
      const resolvedIds: number[] = [];
      const missingNames: string[] = [];
      for (const name of normalized) {
        const existing = byName.get(name.toLowerCase());
        if (existing) {
          resolvedIds.push(existing.id);
        } else {
          missingNames.push(name);
        }
      }

      // 批量并行创建缺失的标签；网络较慢时比串行快 N 倍。
      if (missingNames.length > 0) {
        const createResults = await Promise.all(
          missingNames.map((name) =>
            tagService
              .create({ name })
              .catch((err): { code: number; message?: string; data?: undefined } => ({
                code: -1,
                message: err?.message,
              })),
          ),
        );
        for (const createRes of createResults) {
          if (createRes.code === 200 && createRes.data) {
            resolvedIds.push(createRes.data.id);
          }
        }
      }

      if (resolvedIds.length === 0) {
        toast.error('标签解析失败');
        return false;
      }

      const existingIds = (targetPost.tags || []).map((t) => t.id);
      const merged = Array.from(new Set([...existingIds, ...resolvedIds]));
      const res = await postService.updateProperties(id, { tagIds: merged });
      if (res.code === 200) {
        const addedCount = merged.length - existingIds.length;
        toast.success(
          addedCount > 0
            ? `已追加 ${addedCount} 个标签到文章`
            : '所选标签已存在于文章中',
        );
        await refreshTarget();
        return true;
      }
      toast.error(res.message || '应用标签失败');
      return false;
    } catch {
      toast.error('应用标签失败');
      return false;
    }
  }, [requireTarget, refreshTarget, targetPost]);

  const applyContent = useCallback(async (text: string, mode: ContentApplyMode) => {
    const id = requireTarget();
    if (id === null) return false;
    if (!targetPost) {
      toast.error('目标文章尚未加载完成，请稍后重试');
      return false;
    }

    const existingContent = targetPost.content || '';
    // Empty-post edge case: 对空文章不添加前导 \n\n，避免新文档一上来就两个空行。
    let nextContent: string;
    if (mode === 'replace') {
      nextContent = text;
    } else if (existingContent.trim().length === 0) {
      nextContent = text;
    } else {
      nextContent = `${existingContent.replace(/\s+$/, '')}\n\n${text}`;
    }

    try {
      // 必须重建完整负载——Go PostService.Update 用 req 构建 model.Post 并
      // 无条件覆盖全部列（见 apps/server-go/internal/service/post_service.go:186）。
      // 仅传 `{content: ...}` 会把 title / summary / tagIds / category 等全部置空。
      const fullPayload = rebuildFullUpdatePayload(targetPost, { content: nextContent });
      const res = await postService.update(id, fullPayload);
      if (res.code === 200) {
        toast.success(mode === 'replace' ? '已替换文章正文' : '已追加到文章末尾');
        await refreshTarget();
        return true;
      }
      toast.error(res.message || '写入文章失败');
      return false;
    } catch {
      toast.error('写入文章失败');
      return false;
    }
  }, [requireTarget, refreshTarget, targetPost]);

  const copyToClipboard = useCallback(async (text: string, label = '结果') => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        toast.error('当前环境不支持剪贴板');
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制到剪贴板`);
    } catch {
      toast.error('复制失败');
    }
  }, []);

  const loadPostContent = useCallback(async (id: number): Promise<string | null> => {
    try {
      const res = await postService.getById(id);
      if (res.code === 200 && res.data) {
        return res.data.content || '';
      }
    } catch {
      /* best-effort */
    }
    return null;
  }, []);

  return {
    targetPostId,
    targetPost,
    isLoading,
    recentPosts,
    setTargetPostId,
    refreshTarget,
    refreshRecentPosts,
    applySummary,
    applyTitle,
    applyTags,
    applyContent,
    copyToClipboard,
    loadPostContent,
  };
}
