import { useEffect, useMemo, useRef, useState, useCallback, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  LayoutDashboard,
  FileText,
  Image,
  FolderTree,
  MessageSquare,
  Link2,
  Sparkles,
  Bot,
  Activity,
  Settings,
  PenLine,
  LogOut,
  Sun,
  Moon,
  CornerDownLeft,
} from 'lucide-react';
import { useTheme } from '@/hooks';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: 'NAVIGATE' | 'CREATE' | 'SYSTEM';
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { isDark, toggleThemeWithAnimation } = useTheme();
  const { logout } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const go = useCallback((path: string) => {
    // 先 urgent 关闭命令面板，再把路由切换降级为低优先级更新，
    // 避免老页面(媒体库/AI 配置等)的 unmount 阻塞面板的收起 paint。
    onClose();
    startTransition(() => {
      navigate(path);
    });
  }, [navigate, onClose]);

  const items = useMemo<CommandItem[]>(() => [
    { id: 'nav-dashboard', label: '前往 · 仪表盘', group: 'NAVIGATE', icon: LayoutDashboard, keywords: ['dashboard', 'home', '首页'], run: () => go('/dashboard') },
    { id: 'nav-analytics', label: '前往 · 数据分析', group: 'NAVIGATE', icon: Activity, keywords: ['analytics', 'stats'], run: () => go('/analytics') },
    { id: 'nav-posts', label: '前往 · 文章管理', group: 'NAVIGATE', icon: FileText, keywords: ['posts', 'articles'], run: () => go('/posts') },
    { id: 'nav-media', label: '前往 · 媒体库', group: 'NAVIGATE', icon: Image, keywords: ['media', 'images'], run: () => go('/media') },
    { id: 'nav-categories', label: '前往 · 分类标签', group: 'NAVIGATE', icon: FolderTree, keywords: ['categories', 'tags'], run: () => go('/categories') },
    { id: 'nav-comments', label: '前往 · 评论管理', group: 'NAVIGATE', icon: MessageSquare, keywords: ['comments'], run: () => go('/comments') },
    { id: 'nav-friends', label: '前往 · 友情链接', group: 'NAVIGATE', icon: Link2, keywords: ['friends', 'links'], run: () => go('/friends') },
    { id: 'nav-ai-tools', label: '前往 · AI 工具', group: 'NAVIGATE', icon: Sparkles, keywords: ['ai', 'tools'], run: () => go('/ai-tools') },
    { id: 'nav-ai-config', label: '前往 · AI 配置', group: 'NAVIGATE', icon: Bot, keywords: ['ai', 'config'], run: () => go('/ai-config') },
    { id: 'nav-search', label: '前往 · 搜索配置', group: 'NAVIGATE', icon: Search, keywords: ['search'], run: () => go('/search-config') },
    { id: 'nav-monitor', label: '前往 · 系统监控', group: 'NAVIGATE', icon: Activity, keywords: ['monitor'], run: () => go('/monitor') },
    { id: 'nav-settings', label: '前往 · 系统设置', group: 'NAVIGATE', icon: Settings, keywords: ['settings'], run: () => go('/settings') },
    { id: 'create-post', label: '新建文章', hint: 'New Post', group: 'CREATE', icon: PenLine, keywords: ['new', 'create', 'write'], run: () => go('/posts/new') },
    {
      id: 'sys-theme',
      label: isDark ? '切换到亮色模式' : '切换到暗色模式',
      group: 'SYSTEM',
      icon: isDark ? Sun : Moon,
      keywords: ['theme', 'dark', 'light'],
      run: () => {
        toggleThemeWithAnimation(window.innerWidth / 2, window.innerHeight / 2);
        onClose();
      },
    },
    {
      id: 'sys-logout',
      label: '退出登录',
      group: 'SYSTEM',
      icon: LogOut,
      keywords: ['logout', 'signout'],
      run: async () => {
        try { await authService.logout(); } finally { logout(); navigate('/login'); onClose(); }
      },
    },
  ], [go, isDark, toggleThemeWithAnimation, logout, navigate, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => {
      const hay = [it.label, it.hint ?? '', ...(it.keywords ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const groups: Record<CommandItem['group'], CommandItem[]> = { NAVIGATE: [], CREATE: [], SYSTEM: [] };
    filtered.forEach(it => groups[it.group].push(it));
    return groups;
  }, [filtered]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(filtered.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter') {
        const item = filtered[activeIdx];
        if (item) { e.preventDefault(); void item.run(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, filtered, activeIdx, onClose]);

  const flatOrder = filtered;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="cmdk-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            key="cmdk-panel"
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={{ opacity: 0, y: -12, scale: 0.98, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: -8, scale: 0.98, x: '-50%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-[12%] z-[101] w-[calc(100%-2rem)] max-w-xl surface-overlay overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
              <Search className="w-4 h-4 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入命令或搜索页面…"
                className="flex-1 bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <span className="cmd-chip font-mono text-[10px] uppercase tracking-[0.16em]">⌘K</span>
            </div>

            <div className="max-h-[52vh] overflow-y-auto py-1">
              {flatOrder.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">无匹配命令</div>
              ) : (
                (['NAVIGATE', 'CREATE', 'SYSTEM'] as const).map(groupKey => {
                  const list = grouped[groupKey];
                  if (!list.length) return null;
                  return (
                    <div key={groupKey} className="pb-1">
                      <div className="px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]/70">
                        {groupKey}
                      </div>
                      {list.map(item => {
                        const globalIdx = flatOrder.indexOf(item);
                        const active = globalIdx === activeIdx;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onClick={() => item.run()}
                            className={cn(
                              'group relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
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
                            <Icon className={cn('w-4 h-4 shrink-0', active && 'text-[var(--aurora-1,#818CF8)]')} />
                            <span className="flex-1 text-sm">{item.label}</span>
                            {item.hint && (
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                {item.hint}
                              </span>
                            )}
                            {active && <CornerDownLeft className="w-3.5 h-3.5 text-[var(--aurora-1,#818CF8)]" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <div className="flex items-center gap-4">
                <span><kbd className="px-1 rounded bg-[var(--bg-card)]">↑</kbd> <kbd className="px-1 rounded bg-[var(--bg-card)]">↓</kbd> 导航</span>
                <span><kbd className="px-1 rounded bg-[var(--bg-card)]">↵</kbd> 执行</span>
                <span><kbd className="px-1 rounded bg-[var(--bg-card)]">ESC</kbd> 关闭</span>
              </div>
              <span>AETHER · CMDK</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default CommandPalette;
