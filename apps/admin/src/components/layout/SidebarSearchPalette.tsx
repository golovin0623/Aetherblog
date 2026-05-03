import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CornerDownLeft, FileText, FolderTree, Hash, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { postService, PostListItem } from '@/services/postService';
import { mediaService, MediaItem } from '@/services/mediaService';
import { categoryService, Category } from '@/services/categoryService';
import { tagService, Tag } from '@/services/tagService';
import { logger } from '@/lib/logger';

interface SidebarSearchPaletteProps {
  query: string;
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

type ResultGroup = 'post' | 'media' | 'category' | 'tag' | 'all';

interface ResultItem {
  key: string;
  label: string;
  meta?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: ResultGroup;
  path: string;
}

const GROUP_LABEL: Record<Exclude<ResultGroup, 'all'>, string> = {
  post: '文章',
  media: '媒体',
  category: '分类',
  tag: '标签',
};

const GROUP_ORDER: ResultGroup[] = ['post', 'media', 'category', 'tag', 'all'];

export function SidebarSearchPalette({
  query,
  isOpen,
  anchorRef,
  onClose,
  onNavigate,
}: SidebarSearchPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 锚定输入框: 因 motion.aside 上有 transform 与 overflow-hidden, position:fixed 会被
  // 包含块裁剪 —— 走 portal 到 document.body 才能完整溢出.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) {
        setPos(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // collapsed 态宽度为 0; 移动抽屉关闭时整个锚点 translate 出屏 — 都不渲染
      if (
        r.width === 0 ||
        r.height === 0 ||
        r.right < 8 ||
        r.left > window.innerWidth - 8
      ) {
        setPos(null);
        return;
      }
      setPos({ top: r.bottom + 8, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, anchorRef]);

  // 250ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // 分类/标签全量列表 (体量小, 一次加载, 本地过滤)
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([categoryService.getList(), tagService.getList()])
      .then(([c, t]) => {
        if (cancelled) return;
        if (c.status === 'fulfilled' && c.value.code === 200) {
          setAllCategories(c.value.data);
        }
        if (t.status === 'fulfilled' && t.value.code === 200) {
          setAllTags(t.value.data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 文章 / 媒体: 后端搜索, 各通道独立失败不连坐
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setPosts([]);
      setMedia([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      postService.getList({ pageNum: 1, pageSize: 5, keyword: q }),
      mediaService.getList({ pageNum: 1, pageSize: 3, keyword: q }),
    ]).then(([p, m]) => {
      if (cancelled) return;
      if (p.status === 'fulfilled' && p.value.code === 200) {
        setPosts(p.value.data.list);
      } else {
        setPosts([]);
        if (p.status === 'rejected') logger.error('侧边栏搜索 · 文章通道失败', p.reason);
      }
      if (m.status === 'fulfilled' && m.value.code === 200) {
        setMedia(m.value.data.list);
      } else {
        setMedia([]);
        if (m.status === 'rejected') logger.error('侧边栏搜索 · 媒体通道失败', m.reason);
      }
      if (p.status === 'rejected' && m.status === 'rejected') {
        setError('搜索请求失败,请稍后重试');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const filteredCategories = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return allCategories
      .filter(c => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q))
      .slice(0, 3);
  }, [allCategories, debouncedQuery]);

  const filteredTags = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return allTags
      .filter(t => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
      .slice(0, 3);
  }, [allTags, debouncedQuery]);

  const items = useMemo<ResultItem[]>(() => {
    const q = debouncedQuery.trim();
    if (!q) return [];
    const out: ResultItem[] = [];
    posts.forEach(p =>
      out.push({
        key: `post-${p.id}`,
        label: p.title || '(无标题)',
        meta:
          p.status === 'PUBLISHED' ? '已发布' : p.status === 'DRAFT' ? '草稿' : '归档',
        icon: FileText,
        group: 'post',
        path: `/posts/${p.id}/edit`,
      })
    );
    media.forEach(m =>
      out.push({
        key: `media-${m.id}`,
        label: m.originalName || m.filename,
        meta: m.fileType,
        icon: ImageIcon,
        group: 'media',
        path: '/media',
      })
    );
    filteredCategories.forEach(c =>
      out.push({
        key: `cat-${c.id}`,
        label: c.name,
        meta: `${c.postCount} 篇`,
        icon: FolderTree,
        group: 'category',
        path: '/categories',
      })
    );
    filteredTags.forEach(t =>
      out.push({
        key: `tag-${t.id}`,
        label: t.name,
        meta: `${t.postCount} 篇`,
        icon: Hash,
        group: 'tag',
        path: '/categories',
      })
    );
    out.push({
      key: 'all',
      label: `查看 "${q}" 的全部文章`,
      icon: ArrowRight,
      group: 'all',
      path: `/posts?search=${encodeURIComponent(q)}`,
    });
    return out;
  }, [debouncedQuery, posts, media, filteredCategories, filteredTags]);

  // 重置 active 指针: 关键词变化或结果集刷新都回到首项
  useEffect(() => {
    setActiveIdx(0);
  }, [debouncedQuery, items.length]);

  // 键盘导航 + Esc 关闭. 仅在锚点可见时绑定, 避免移动/桌面双实例都监听 Enter.
  useEffect(() => {
    if (!isOpen || !pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => (i + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Enter') {
        const item = items[activeIdx];
        if (item) {
          e.preventDefault();
          onNavigate(item.path);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pos, items, activeIdx, onClose, onNavigate]);

  // 点击外部关闭. mousedown 优先于 click, 不抢按钮的点击.
  useEffect(() => {
    if (!isOpen || !pos) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (paletteRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen, pos, anchorRef, onClose]);

  if (typeof document === 'undefined') return null;

  const trimmedQuery = debouncedQuery.trim();
  const hasContent = items.some(it => it.group !== 'all');

  const groups = GROUP_ORDER.map(g => ({
    group: g,
    list: items.filter(it => it.group === g),
  }));

  return createPortal(
    <AnimatePresence>
      {isOpen && pos && (
        <motion.div
          ref={paletteRef}
          id="sidebar-search-palette"
          role="listbox"
          aria-label="侧边栏搜索结果"
          initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.98 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="surface-overlay fixed z-[60] overflow-hidden rounded-xl"
          style={{
            top: pos.top,
            left: pos.left,
            width: Math.max(pos.width, 280),
            maxWidth: 'calc(100vw - 1rem)',
          }}
        >
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {loading && !hasContent && (
              <div className="px-3 py-3 space-y-2" aria-live="polite">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="h-9 rounded-lg bg-[var(--bg-card-hover)] animate-pulse"
                  />
                ))}
              </div>
            )}

            {error && !loading && (
              <div className="px-4 py-3" role="alert">
                <p className="text-sm text-[var(--signal-warn,#F59E0B)]">{error}</p>
              </div>
            )}

            {!loading && !error && trimmedQuery && !hasContent && (
              <div className="px-4 pt-5 pb-3 text-center">
                <p className="font-editorial italic text-sm text-[var(--text-secondary)] mb-1">
                  未找到与 "{trimmedQuery}" 匹配的内容
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  仍可在文章管理中按更宽条件搜索
                </p>
              </div>
            )}

            {groups.map(({ group, list }) => {
              if (!list.length) return null;
              if (group === 'all') {
                return (
                  <div
                    key={group}
                    className={cn(hasContent && 'border-t border-[var(--border-subtle)] mt-1 pt-1')}
                  >
                    {list.map(item => renderRow(item, items.indexOf(item), activeIdx, setActiveIdx, onNavigate))}
                  </div>
                );
              }
              return (
                <div key={group} className="pb-1">
                  <div className="px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]/70">
                    {GROUP_LABEL[group]}
                  </div>
                  {list.map(item => renderRow(item, items.indexOf(item), activeIdx, setActiveIdx, onNavigate))}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="px-1 rounded bg-[var(--bg-card)]">↑</kbd>{' '}
                <kbd className="px-1 rounded bg-[var(--bg-card)]">↓</kbd>
              </span>
              <span>
                <kbd className="px-1 rounded bg-[var(--bg-card)]">↵</kbd> 进入
              </span>
              <span>
                <kbd className="px-1 rounded bg-[var(--bg-card)]">esc</kbd>
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function renderRow(
  item: ResultItem,
  globalIdx: number,
  activeIdx: number,
  setActiveIdx: (i: number) => void,
  onNavigate: (path: string) => void
) {
  const active = globalIdx === activeIdx;
  const Icon = item.icon;
  return (
    <button
      key={item.key}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={() => setActiveIdx(globalIdx)}
      onClick={() => onNavigate(item.path)}
      className={cn(
        'group relative w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
        active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1,#818CF8)_14%,transparent)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-gradient-to-b from-[var(--aurora-1,#818CF8)] via-[var(--aurora-2,#A78BFA)] to-[var(--aurora-3,#F0ABFC)]"
        />
      )}
      <Icon
        className={cn('w-4 h-4 shrink-0', active && 'text-[var(--aurora-1,#818CF8)]')}
      />
      <span className="flex-1 text-sm truncate">{item.label}</span>
      {item.meta && (
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] shrink-0">
          {item.meta}
        </span>
      )}
      {active && item.group !== 'all' && (
        <CornerDownLeft className="w-3 h-3 text-[var(--aurora-1,#818CF8)] shrink-0" />
      )}
    </button>
  );
}

export default SidebarSearchPalette;
