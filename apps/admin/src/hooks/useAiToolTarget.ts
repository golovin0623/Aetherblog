import { useState, useCallback, useEffect, useRef } from 'react';
import { postService, Post, PostListItem } from '@/services/postService';
import { tagService } from '@/services/tagService';
import { toast } from 'sonner';

/**
 * AI 工具箱的"目标文章"抽象：所有"应用到文章"动作都通过该 hook 调度。
 *
 * 设计要点：
 * - targetPostId 通过 localStorage 持久化，避免重载时丢失。
 * - 所有 applyX 动作在没有 target 时降级为复制到剪贴板 + toast 提示。
 * - tag 追加时会按名称解析为 ID（不存在则自动创建），保持与现有 tagIds 合并。
 * - 内容级替换（polish / translate / outline）为破坏性操作，由调用方先用
 *   ConfirmModal 确认，本 hook 只做"执行"。
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
  loadPostIntoClipboard: (id: number) => Promise<string | null>;
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
    const normalized = Array.from(
      new Set(
        tagNames
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && name.length <= 50),
      ),
    );
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
      const resolvedIds: number[] = [];
      for (const name of normalized) {
        const existing = byName.get(name.toLowerCase());
        if (existing) {
          resolvedIds.push(existing.id);
          continue;
        }
        const createRes = await tagService.create({ name });
        if (createRes.code === 200 && createRes.data) {
          resolvedIds.push(createRes.data.id);
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
    const nextContent =
      mode === 'replace'
        ? text
        : `${(targetPost.content || '').replace(/\s+$/, '')}\n\n${text}`;
    try {
      const res = await postService.update(id, { content: nextContent });
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

  const loadPostIntoClipboard = useCallback(async (id: number): Promise<string | null> => {
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
    loadPostIntoClipboard,
  };
}
