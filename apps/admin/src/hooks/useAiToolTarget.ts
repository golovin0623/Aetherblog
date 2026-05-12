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
export type TagApplyMode = 'replace' | 'append';

/**
 * `applyTags` 的输入项。两种形态:
 *   - 字符串: 仅名字 → 走"按名字查现有, 没有就新建"的旧路径;
 *   - 对象: 含可选 `tagId` → 命中已知现有标签, 跳过查找直接复用 (零 N+1)。
 *
 * 新版 AI Tagger UX 会优先传带 `tagId` 的形态 (matches 项), 与不带的形态
 * (suggestions 项) 混合, 让 hook 在一次调用里同时处理"复用 + 新建"。
 */
export type ApplyTagInput = string | { name: string; tagId?: number };

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
  /**
   * 应用标签到目标文章。
   *   `append`（默认）：与现有标签合并（去重）；
   *   `replace`：用列表完全替换，未列出的现有标签会被移除。
   *
   * 输入项可以是纯字符串 (旧调用) 或 `{name, tagId?}` 对象 (新调用)。
   * 提供 `tagId` 时跳过 tag 列表查询 + 创建逻辑, 直接复用。
   */
  applyTags: (items: ApplyTagInput[], mode?: TagApplyMode) => Promise<boolean>;
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
    /* 忽略配额 / 隐私错误 */
  }
};

/**
 * 将缓存的 `Post` 重建为 `CreatePostRequest` 负载，供 `postService.update`
 * 使用。正文更新仍需携带标题、摘要、分类、标签等内容元数据；访问密码、
 * 手工 slug、封面图等未提交属性由 Go 端 PostService.Update 保留。
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
  // 防止用户快速切换目标时收到过期响应。
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
      // 仅作 dropdown 打开瞬间的快速 fallback；真正的分页/搜索由消费方
      // (AIToolsWorkspace 目标文章下拉) 自管，按需调 postService.getList
      // 翻任意页。
      const res = await postService.getList({ pageNum: 1, pageSize: 20 });
      if (res.code === 200 && res.data) {
        setRecentPosts(res.data.list || []);
      }
    } catch {
      /* 尽力执行，失败忽略 */
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

  const applyTags = useCallback(async (items: ApplyTagInput[], mode: TagApplyMode = 'append') => {
    const id = requireTarget();
    if (id === null) return false;
    if (!targetPost) {
      toast.error('目标文章尚未加载完成，请稍后重试');
      return false;
    }

    // 大小写不敏感去重 + 归一化为 {name, tagId?}, 同时保留首次出现的元数据。
    // 防止 ["AI", "ai"] / [{name:"AI", tagId:5}, "ai"] 等组合造成重复或冲突。
    const seenLower = new Set<string>();
    const normalized: { name: string; tagId?: number }[] = [];
    for (const raw of items) {
      const item = typeof raw === 'string' ? { name: raw } : raw;
      const trimmed = (item.name || '').trim();
      if (!trimmed || trimmed.length > 50) continue;
      const key = trimmed.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      normalized.push({ name: trimmed, tagId: item.tagId });
    }
    if (normalized.length === 0) {
      toast.error('没有可应用的标签');
      return false;
    }

    try {
      // 已带 tagId 的项直接落地, 不再触发列表拉取。仅当存在"裸名字"项时
      // 才去拉一次现有标签列表 —— 这是新 UX 的常见路径 (matches 全带 tagId,
      // suggestions 全无 tagId, 旧 UX 不带 tagId 全走查询)。
      const resolvedIds: number[] = [];
      const namesNeedLookup: string[] = [];
      for (const item of normalized) {
        if (item.tagId !== undefined) resolvedIds.push(item.tagId);
        else namesNeedLookup.push(item.name);
      }

      if (namesNeedLookup.length > 0) {
        const listRes = await tagService.getList();
        if (listRes.code !== 200) {
          toast.error(listRes.message || '获取标签列表失败');
          return false;
        }
        const byName = new Map(
          (listRes.data || []).map((t) => [t.name.trim().toLowerCase(), t]),
        );

        const missingNames: string[] = [];
        for (const name of namesNeedLookup) {
          const existing = byName.get(name.toLowerCase());
          if (existing) resolvedIds.push(existing.id);
          else missingNames.push(name);
        }

        // 批量并行创建缺失的标签；网络较慢时比串行快 N 倍。
        // 失败项必须显式上报 toast —— 否则用户会以为"全部应用成功"但实际
        // 部分新标签未挂上 (例如 rate limit / unique 冲突 / 离线)。
        if (missingNames.length > 0) {
          const createResults = await Promise.all(
            missingNames.map((name) =>
              tagService
                .create({ name })
                .then((res) => ({ ...res, name }))
                .catch((err): { code: number; message?: string; data?: undefined; name: string } => ({
                  code: -1,
                  message: err?.message || '请求失败',
                  name,
                })),
            ),
          );
          const failedCreates: { name: string; message?: string }[] = [];
          for (const createRes of createResults) {
            if (createRes.code === 200 && createRes.data) {
              resolvedIds.push(createRes.data.id);
            } else {
              failedCreates.push({ name: createRes.name, message: createRes.message });
            }
          }
          if (failedCreates.length > 0) {
            // 单条 vs 多条不同的展示密度。聚合在一行避免 toast 队列被淹没。
            const head = failedCreates.slice(0, 3).map((f) => f.name).join('、');
            const moreSuffix = failedCreates.length > 3 ? ` 等 ${failedCreates.length} 项` : '';
            const reason = failedCreates[0].message;
            toast.error(
              `部分标签创建失败: ${head}${moreSuffix}${reason ? ` (${reason})` : ''}`,
            );
          }
        }
      }

      if (resolvedIds.length === 0 && mode === 'append') {
        // replace 模式允许把标签清空（resolvedIds 为空 → tagIds 也为空）
        toast.error('标签解析失败');
        return false;
      }

      const existingIds = (targetPost.tags || []).map((t) => t.id);
      const nextIds =
        mode === 'replace'
          ? Array.from(new Set(resolvedIds))
          : Array.from(new Set([...existingIds, ...resolvedIds]));
      const res = await postService.updateProperties(id, { tagIds: nextIds });
      if (res.code === 200) {
        if (mode === 'replace') {
          toast.success(`已替换为 ${nextIds.length} 个标签`);
        } else {
          const addedCount = nextIds.length - existingIds.length;
          toast.success(
            addedCount > 0
              ? `已追加 ${addedCount} 个标签到文章`
              : '所选标签已存在于文章中',
          );
        }
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
    // 空文章的边缘情况：对空文章不添加前导 \n\n，避免新文档一上来就两个空行。
    let nextContent: string;
    if (mode === 'replace') {
      nextContent = text;
    } else if (existingContent.trim().length === 0) {
      nextContent = text;
    } else {
      nextContent = `${existingContent.replace(/\s+$/, '')}\n\n${text}`;
    }

    try {
      // 正文更新必须重建内容负载；后端会保留未提交的受保护属性。
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
      /* 尽力执行，失败忽略 */
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
