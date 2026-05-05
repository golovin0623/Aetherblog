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
  ArrowLeft,
} from 'lucide-react';
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
    <div className="surface-raised h-full w-full md:w-[280px] flex-shrink-0 border-r border-[var(--ink-subtle)]/15 flex flex-col">
      {/* 头部：wordmark + 新对话
          顶部 padding 走 safe-area-inset-top，避免 drawer 被 iOS 状态栏区
          压在底下；移动端 drawer top:0 是物理 0，状态栏区会被 OS UI 占据。 */}
      <div
        className="px-4 pb-3 space-y-3 border-b border-[var(--ink-subtle)]/12"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center justify-between gap-2">
          {/* wordmark 兼任"返回主页"入口 —— 加 ArrowLeft icon 让链接性更可见。
              桌面端 hover 着色，移动端首次接触靠图标暗示。 */}
          <Link
            href="/agent"
            className="group/home font-display text-[17px] leading-none tracking-[-0.01em] text-[var(--ink-primary)] inline-flex items-center gap-2 hover:text-[var(--aurora-1)] transition-colors min-w-0"
          >
            <ArrowLeft className="w-4 h-4 flex-shrink-0 text-[var(--ink-muted)] group-hover/home:text-[var(--aurora-1)] transition-colors" />
            <span className="aurora-text">灵境</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-[var(--ink-muted)] mt-0.5">workspace</span>
          </Link>
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="关闭侧栏"
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={wrappedCreate}
          data-interactive
          className="group/new w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/45 hover:text-[var(--aurora-1)] transition-colors text-[13px] font-medium active:translate-y-px"
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
                        className={`group/sess relative rounded-lg flex items-center gap-2 px-2.5 py-2 text-[12.5px] cursor-pointer transition-colors ${
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

      {/* 底部用户卡
          头像移动端放大到 40×40（桌面 32×32），平衡可识别性 + 信息密度。
          padding-right 走 safe-area-inset-right，避免 iPhone Pro 系圆角
          屏角把 logout 按钮裁掉一半。 */}
      <div
        className="px-3 pt-3 border-t border-[var(--ink-subtle)]/12 flex items-center gap-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 flex items-center justify-center text-[var(--ink-primary)] text-sm font-medium overflow-hidden flex-shrink-0">
          {user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            (user.nickname || user.username || '?').slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] md:text-[12.5px] text-[var(--ink-primary)] truncate">{user.nickname || user.username}</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)] truncate">{user.role}</div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="登出"
          title="登出"
          className="inline-flex items-center justify-center w-9 h-9 md:w-7 md:h-7 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--signal-danger)] transition-colors flex-shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
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

  // 点击外部 / ESC 关闭
  // 用 pointerdown 替代 mousedown：iOS Safari 触屏第一次点击 menu 内"删除会话"
  // 按钮时，合成 mousedown 的 target 检测时序与 React 重渲染（confirmDelete 切
  // 换为 true 后 banner 替换原按钮）冲突，导致 banner 被 onClose 立即关掉，
  // 用户感知为"第一次点击没出现，第二次才出来"。pointerdown 在 iOS 上更早、
  // 更可靠地拿到正确 target，两次渲染同步。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
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
        className={`inline-flex items-center justify-center w-8 h-8 md:w-6 md:h-6 rounded transition-all ${
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
          <motion.div
            ref={wrapRef}
            role="menu"
            aria-label={`「${sessionTitle}」会话菜单`}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            // 加 bg-[var(--bg-leaf)] 实色兜底：drawer 内 surface-overlay 弹层
            // 透明会让背后的会话列表 + ... 按钮穿透显形（特别是删除二次确认
            // banner 时），削弱菜单的视觉权重。实色背景让信息层级清晰。
            className="absolute right-0 top-full mt-1 w-44 surface-overlay bg-[var(--bg-leaf)] rounded-xl border border-[var(--ink-subtle)]/22 z-50 overflow-hidden shadow-[0_18px_40px_-16px_rgba(0,0,0,0.32)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
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
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--signal-danger)]/85 hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)] transition-colors"
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
                    className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--ink-secondary)] bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
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
        )}
      </AnimatePresence>
    </div>
  );
}
