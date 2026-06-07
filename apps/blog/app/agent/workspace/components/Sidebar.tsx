'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  MessageSquare,
  Search,
  LogOut,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  MoreHorizontal,
  AlertTriangle,
  Home,
  Sun,
  Moon,
  UserCircle,
} from 'lucide-react';
import { useTheme } from '@aetherblog/hooks';
import { CachedAvatarImage } from '@/app/components/CachedAvatarImage';
import type { AgentSession } from '../../lib/agentSessions';
import { groupSessionsByRecency } from '../../lib/agentSessions';
import type { AgentUser } from '../../lib/agentAuth';

interface Props {
  user: AgentUser;
  sessions: AgentSession[];
  activeId: string | null;
  /** 移动端 drawer 打开状态。桌面端忽略，sidebar 始终常驻。 */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** 桌面端是否隐藏 sidebar（topbar 的 collapse 按钮控制）。 */
  desktopHidden?: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}

/**
 * Workspace 左侧栏 ——
 *
 * 桌面端 (md+)：常驻 280px，与主区平铺；
 * 移动端：默认隐藏，由 WorkspaceClient 通过 hamburger 触发 mobileOpen=true 后
 *         以 fixed drawer 形式从左侧滑入，叠 backdrop 拦截背景滚动。
 *
 * 视觉走 surface-raised + Aether Codex token 体系，与 /design §S4 一致。
 */
export default function Sidebar({
  user,
  sessions,
  activeId,
  mobileOpen = false,
  onMobileClose,
  desktopHidden = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onLogout,
}: Props) {
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  // 哪个会话当前打开了"..."菜单 —— 同一时间只能开一个
  const [menuId, setMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, filter]);

  const groups = useMemo(() => groupSessionsByRecency(filtered), [filtered]);

  // 移动端 drawer 打开时禁背景滚动 + 监听 ESC 关闭
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen, onMobileClose]);

  // 移动端选中会话后自动关闭 drawer
  const wrappedSelect = (id: string) => {
    onSelect(id);
    onMobileClose?.();
  };
  const wrappedCreate = () => {
    onCreate();
    onMobileClose?.();
  };

  const startRename = (s: AgentSession) => {
    setDraftTitle(s.title);
    setRenamingId(s.id);
    setMenuId(null);
  };
  const commitRename = (s: AgentSession) => {
    const t = draftTitle.trim();
    if (t && t !== s.title) onRename(s.id, t);
    setRenamingId(null);
  };

  const SidebarBody = (
    // rounded-none 强制覆盖 surface-raised 自带的 1rem 圆角 —— 移动端 drawer
    // 由外层 motion.aside 的 rounded-r-2xl + overflow-hidden 接管"右侧圆角、
    // 左侧贴屏"的几何，内层不能再有任何 border-radius，否则 surface-raised
    // 的 1rem 圆角会在 overflow-hidden 边界内露出 1rem×1rem 的"扣角"，背后
    // 的 backdrop 透出形成两道月牙缝（用户截图证据）。桌面端常驻 rail 也
    // 不需要圆角，因为 sidebar 高度 100% 占满，顶/底贴边。
    <div className="surface-raised rounded-none h-full w-full md:w-[280px] flex-shrink-0 border-r border-[var(--ink-subtle)]/15 flex flex-col">
      {/* 头部：wordmark + 新对话
          顶部 padding 走 safe-area-inset-top，避免 drawer 被 iOS 状态栏区
          压在底下；移动端 drawer top:0 是物理 0，状态栏区会被 OS UI 占据。
          左侧 padding 同步 safe-area-inset-left，配合外层 drawer 让 wordmark
          在 iPhone Pro 系刘海/灵动岛屏的左侧弧形安全区外渲染。 */}
      <div
        className="px-4 pb-3 space-y-3 border-b border-[var(--ink-subtle)]/12"
        style={{
          paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
          paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          {/* 前台灵境从这里回到站点首页，不再表达为"返回工作台"。 */}
          <Link
            href="/"
            className="group/home -ml-2 inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]"
          >
            <Home className="h-4 w-4 text-[var(--ink-muted)] transition-colors group-hover/home:text-[var(--aurora-1)]" />
            <span className="text-[13px] font-medium">首页</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center text-right">
            <div className="aurora-text truncate font-display text-[17px] leading-none tracking-[-0.01em]">
              灵境
            </div>
          </div>
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="关闭侧栏"
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors active:scale-90 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={wrappedCreate}
          data-interactive
          className="group/new w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/45 hover:text-[var(--aurora-1)] transition-all text-[13px] font-medium active:scale-[0.98] active:translate-y-px"
        >
          <Plus className="w-3.5 h-3.5 transition-transform group-hover/new:rotate-90" />
          新对话
        </button>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索对话…"
            className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-[var(--bg-raised)]/70 border border-[var(--ink-subtle)]/15 text-[var(--ink-secondary)] placeholder-[var(--ink-muted)]/60 text-[12px] outline-none focus:border-[var(--aurora-1)]/40 focus:ring-1 focus:ring-[var(--aurora-1)]/15"
          />
        </div>
      </div>

      {/* 会话列表 */}
      <div className="agent-thumb-scroll flex-1 overflow-y-auto py-2 -webkit-overflow-scrolling-touch">
        {groups.length === 0 ? (
          <div className="px-4 pt-10 text-center space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--ink-muted)]/85">
              No conversations yet
            </div>
            <div className="text-[12px] text-[var(--ink-muted)]">点击「新对话」开始</div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-3">
              <div className="px-4 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)]/85 flex items-center gap-1.5">
                <ChevronDown className="w-3 h-3" />
                {g.label}
              </div>
              <ul className="space-y-0.5 px-2">
                {g.sessions.map((s) => {
                  const isActive = s.id === activeId;
                  const isEditing = renamingId === s.id;
                  const menuOpen = menuId === s.id;
                  return (
                    <li key={s.id}>
                      <div
                        className={`group/sess relative rounded-lg flex items-center gap-2 px-2.5 py-2 text-[12.5px] cursor-pointer transition-all ${
                          !isEditing && !menuOpen ? 'active:scale-[0.985] active:bg-[var(--bg-raised)]' : ''
                        } ${
                          isActive
                            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
                            : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                        } ${menuOpen ? 'bg-[var(--bg-raised)]/80' : ''}`}
                        onClick={() => !isEditing && !menuOpen && wrappedSelect(s.id)}
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-80" />
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => commitRename(s)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename(s);
                              } else if (e.key === 'Escape') {
                                setRenamingId(null);
                              }
                            }}
                            className="flex-1 bg-transparent outline-none text-[var(--ink-primary)] min-w-0 border-b border-[var(--aurora-1)]/35 pb-0.5"
                          />
                        ) : (
                          <span className="flex-1 truncate">{s.title}</span>
                        )}
                        {!isEditing && (
                          <SessionMenu
                            open={menuOpen}
                            isActive={isActive}
                            onToggle={() =>
                              setMenuId((curr) => (curr === s.id ? null : s.id))
                            }
                            onClose={() => setMenuId(null)}
                            onRename={() => startRename(s)}
                            onDelete={() => {
                              onDelete(s.id);
                              setMenuId(null);
                            }}
                            sessionTitle={s.title}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* 底部用户卡 —— 移动端整张可点开 ProfileMenu（功能浮窗），桌面端
          维持 avatar + name + 独立 logout 三件套（横向 hover-friendly）。
          padding-right/left 同时走 safe-area-inset，避免 iPhone Pro 系
          屏角把内容裁切；padding-bottom 防止 home indicator 撞底。 */}
      <ProfileBar
        user={user}
        onLogout={onLogout}
        onCloseDrawer={onMobileClose}
      />
    </div>
  );

  return (
    <>
      {/* 桌面端常驻 —— desktopHidden 下用 width 0 + overflow hidden 平滑收起 */}
      <aside
        className={`hidden md:flex h-full transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
          desktopHidden ? 'w-0' : 'w-[280px]'
        }`}
      >
        <div className={`h-full ${desktopHidden ? 'pointer-events-none opacity-0' : 'opacity-100'} transition-opacity duration-200`}>
          {SidebarBody}
        </div>
      </aside>

      {/* 移动端 drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onMobileClose}
              className="md:hidden fixed inset-0 z-[80] bg-black/55 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="对话侧栏"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              // 右侧加圆角让 drawer 与剩余 backdrop 形成柔和边界（适配 iPhone
              // Pro 圆角屏的视觉一致性）；overflow-hidden 让 SidebarBody 的
              // surface-raised 跟随圆角剪裁。左侧紧贴屏幕边（left:0）不留缝。
              className="md:hidden fixed left-0 top-0 bottom-0 w-[82vw] max-w-[320px] z-[81] rounded-r-2xl overflow-hidden"
            >
              {SidebarBody}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/* ============================================================================
 * SessionMenu —— 单条会话的"..."操作菜单
 * ----------------------------------------------------------------------------
 * 视觉策略：
 *   · 默认隐藏，hover row 时浮出（active 行常驻）；菜单展开时也常驻。
 *   · 菜单展开是 surface-overlay 小卡，包含 Rename / Delete。
 *   · Delete 不弹 native confirm —— 改成 inline 双击确认：第一次点显示"确认删除"
 *     红色 banner + 一个 "Delete" 按钮，再点一次才真正调用 onDelete。这样既符合
 *     设计系统硬规则 §3.5（禁用 native confirm），又不引入额外 modal。
 *   · ESC / 点击外部关闭菜单。
 * ============================================================================
 */
function SessionMenu({
  open,
  isActive,
  onToggle,
  onClose,
  onRename,
  onDelete,
  sessionTitle,
}: {
  open: boolean;
  isActive: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  sessionTitle: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 菜单关闭时重置 confirm 状态
  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  // 点击外部 / ESC 关闭。
  // 历史方案用 document.addEventListener('pointerdown') 检测 target 是否在
  // wrapRef 内 —— iOS Safari 上"第一次点删除按钮无反应、第二次才出确认条"
  // 反复出现。根因是 pointerdown 早于 React 提交时序，加上"删除按钮 → 确认
  // banner"是同一坐标位置的 unmount/remount，target 检测在两帧之间丢失，
  // 兜底逻辑误判成"点了外部"立刻 onClose 把菜单关掉。
  // 现切到 backdrop overlay：菜单展开时铺一张全屏透明 div 接住所有点击，
  // 菜单本身渲染在 backdrop 上方（更高 z-index），所有 menu 内按钮天然排
  // 除在 backdrop 命中范围外，没有 target 检测竞态。ESC 仍走全局监听。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="会话操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        // 触控区：移动端 32×32（drawer 内单手操作触达；桌面 hover-friendly
        // 24×24）。移动端不启用 hover-only 显隐，始终常驻可见。
        className={`inline-flex items-center justify-center w-8 h-8 md:w-6 md:h-6 rounded transition-all active:scale-90 ${
          open
            ? 'bg-[var(--bg-raised)] text-[var(--ink-primary)]'
            : isActive
            ? 'text-[var(--aurora-1)]/85 hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]'
            : 'text-[var(--ink-muted)] opacity-100 md:opacity-0 md:group-hover/sess:opacity-100 hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]'
        }`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* 全屏透明 backdrop —— 任何菜单外点击落在这里，onClick 立刻 onClose。
                菜单本身渲染在 backdrop 之上的 z-50，菜单内按钮天然不命中 backdrop。
                这条路径替代了"document.pointerdown + target 检测"的脆弱方案，
                解决 iOS 上"第一次点删除无反应"竞态。 */}
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-hidden="true"
            />
            <motion.div
              ref={wrapRef}
              role="menu"
              aria-label={`「${sessionTitle}」会话菜单`}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              // 实色背景兜底（inline style 优先级最高，覆盖 surface-overlay 自带
              // 的半透明 + backdrop-filter）：drawer 内弹层透明会让背后的会话
              // 列表 + ... 按钮穿透显形（特别是删除二次确认 banner 时），削弱
              // 菜单的视觉权重。实色让信息层级清晰，且消除 backdrop-filter 在
              // 部分 iOS 设备上对触控命中的干扰。
              style={{ background: 'var(--bg-leaf)' }}
              className="absolute right-0 top-full mt-1 w-44 surface-overlay rounded-xl border border-[var(--ink-subtle)]/22 z-50 overflow-hidden shadow-[0_18px_40px_-16px_rgba(0,0,0,0.32)]"
              onClick={(e) => e.stopPropagation()}
            >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] active:scale-[0.985] transition-all"
            >
              <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
              重命名
            </button>

            <div className="h-px bg-[var(--ink-subtle)]/15" aria-hidden="true" />

            {!confirmDelete ? (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--signal-danger)]/85 hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)] active:scale-[0.985] transition-all"
              >
                <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
                删除会话
              </button>
            ) : (
              <div className="px-3 py-2.5 bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)]">
                <div className="flex items-start gap-1.5 mb-2 text-[var(--signal-danger)]">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span className="text-[11.5px] leading-snug">
                    删除后无法恢复，确认？
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(false);
                    }}
                    className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--ink-secondary)] bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-all active:scale-95"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="flex-1 px-2 py-1 rounded-md text-[11px] text-white bg-[var(--signal-danger)] hover:brightness-110 transition-all active:scale-95"
                  >
                    删除
                  </button>
                </div>
              </div>
            )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================================
 * ProfileBar —— 侧栏底部的用户资料块
 * ----------------------------------------------------------------------------
 * 桌面端：avatar + name 三件套 + 独立 logout 按钮（横向 hover-friendly）。
 * 移动端：整张 user 区域是 tappable，点开 ProfileMenu（功能浮窗），里面承载
 *   主题切换 / 登出 等次级动作。原本平铺在底部的 logout 按钮在移动端被收纳
 *   到 menu 中，让头像可以放大并左移到 iPhone Pro 系圆角屏的安全区。
 * ============================================================================
 */
function ProfileBar({
  user,
  onLogout,
  onCloseDrawer,
}: {
  user: AgentUser;
  onLogout: () => void;
  onCloseDrawer?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ESC 关闭 —— 外部点击靠下方 backdrop 拦截
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const avatarNode = (
    <div className="w-11 h-11 md:w-8 md:h-8 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 flex items-center justify-center text-[var(--ink-primary)] text-sm font-medium overflow-hidden flex-shrink-0">
      {user.avatar ? (
        <CachedAvatarImage
          src={user.avatar}
          alt=""
          className="w-full h-full object-cover"
          fallback={(user.nickname || user.username || '?').slice(0, 1).toUpperCase()}
        />
      ) : (
        (user.nickname || user.username || '?').slice(0, 1).toUpperCase()
      )}
    </div>
  );

  return (
    <div
      className="relative border-t border-[var(--ink-subtle)]/12"
      style={{
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        paddingLeft: 'max(0.5rem, env(safe-area-inset-left, 0px))',
        paddingTop: '0.75rem',
      }}
    >
      {/* 移动端：整块可点开 ProfileMenu */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="账户菜单"
        className="md:hidden w-full flex items-center gap-3 px-1.5 py-1 rounded-xl hover:bg-[var(--bg-raised)]/50 active:scale-[0.985] transition-all"
      >
        {avatarNode}
        <div className="min-w-0 flex-1 text-left">
          <div className="text-[13.5px] text-[var(--ink-primary)] truncate">{user.nickname || user.username}</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] truncate">{user.role}</div>
        </div>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[var(--ink-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* 桌面端：原 avatar + name + 独立 logout 三件套 */}
      <div className="hidden md:flex items-center gap-3 px-1">
        {avatarNode}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-[var(--ink-primary)] truncate">{user.nickname || user.username}</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] truncate">{user.role}</div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="登出"
          title="登出"
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--signal-danger)] active:scale-90 transition-all flex-shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* 移动端 ProfileMenu —— 上拉浮窗，承载主题切换 + 登出。 */}
      <AnimatePresence>
        {open && (
          <>
            <div
              className="md:hidden fixed inset-0 z-[82]"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              role="menu"
              aria-label="账户菜单"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              style={{ background: 'var(--bg-leaf)' }}
              className="md:hidden absolute left-2 right-2 bottom-[calc(100%-0.25rem)] z-[83] surface-overlay rounded-xl border border-[var(--ink-subtle)]/22 overflow-hidden shadow-[0_22px_48px_-18px_rgba(0,0,0,0.45)]"
            >
              <ProfileMenuHeader user={user} />
              <div className="h-px bg-[var(--ink-subtle)]/15" aria-hidden="true" />
              <ProfileMenuThemeToggle />
              <div className="h-px bg-[var(--ink-subtle)]/15" aria-hidden="true" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCloseDrawer?.();
                  onLogout();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-[var(--signal-danger)]/90 hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)] active:scale-[0.985] transition-all"
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                登出当前账户
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProfileMenuHeader({ user }: { user: AgentUser }) {
  return (
    <div className="px-3.5 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 flex items-center justify-center text-[var(--ink-primary)] text-sm font-medium overflow-hidden flex-shrink-0">
        {user.avatar ? (
          <CachedAvatarImage
            src={user.avatar}
            alt=""
            className="w-full h-full object-cover"
            fallback={<UserCircle className="w-5 h-5 text-[var(--ink-muted)]" aria-hidden="true" />}
          />
        ) : (
          <UserCircle className="w-5 h-5 text-[var(--ink-muted)]" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[var(--ink-primary)] truncate">{user.nickname || user.username}</div>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] truncate">
          {user.role} · @{user.username}
        </div>
      </div>
    </div>
  );
}

function ProfileMenuThemeToggle() {
  const { isDark, toggleThemeWithAnimation } = useTheme();
  return (
    <button
      type="button"
      role="menuitem"
      data-theme-toggle
      onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
      className="w-full flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
    >
      {isDark ? (
        <Sun className="w-4 h-4 flex-shrink-0 text-[var(--aurora-2)]" />
      ) : (
        <Moon className="w-4 h-4 flex-shrink-0 text-[var(--aurora-1)]" />
      )}
      <span className="flex-1 text-left">切换到{isDark ? '亮' : '暗'}主题</span>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
        {isDark ? 'light' : 'dark'}
      </span>
    </button>
  );
}
