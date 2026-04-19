import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { spring, transition } from '@aetherblog/ui';
import { useIsMobile } from '@aetherblog/hooks';
import { cn } from '@/lib/utils';
import type { AiModel, AiProvider } from '@/services/aiProviderService';
import ProviderIcon from '@/pages/ai-config/components/ProviderIcon';

/**
 * CodexModelPicker —— Aether Codex 风格的 AI 模型选择器 (chat / embedding 共用).
 *
 * 设计依据 `.claude/design-system/` + CLAUDE.md §移动端编码约束:
 *   · 桌面: surface-leaf 胶囊 + surface-overlay 下拉, aurora 光带选中
 *   · 移动 (≤ 768px): Bottom Sheet 模式 (max-h-[66vh] + safe-area pb)
 *   · 全程 token 自翻 (无 dark: 变体), 自动适配 light/dark
 *   · Motion 来自 @aetherblog/ui 预设
 *
 * Chip 自适应: embedding 模型显示向量维度 (Xd), 其他模型(chat/reasoning)显示
 * 上下文窗口 (XK). 调用方不需要告诉 Picker 具体任务类型 —— 它从 AiModel.model_type
 * 自己推断。
 */
export interface CodexModelPickerProps {
  /** 当前可选模型(已由上游按 provider/任务类型过滤) */
  models: AiModel[];
  /** 供应商元信息,用于图标 + 分组名 */
  providers?: AiProvider[];
  /** 当前选中的模型对象, null 表示未选 */
  value: AiModel | null;
  /** 选中变化; null 代表清空 */
  onChange: (model: AiModel | null) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** 下拉弹层相对触发器的位置, 默认 bottom */
  menuPlacement?: 'top' | 'bottom';
  /** 允许清空(在列表顶上显示"清空"条目) */
  clearable?: boolean;
  /** 清空条目的文案, 默认"清空选择" */
  clearLabel?: string;
}

interface GroupedModels {
  providerCode: string;
  providerIcon?: string | null;
  providerName: string;
  models: AiModel[];
}

function resolveDim(model: AiModel): number | null {
  const caps = (model.capabilities || {}) as Record<string, unknown>;
  const raw = caps.dim ?? caps.dimension ?? caps.output_dim;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : (raw as number | undefined);
  return Number.isFinite(parsed) ? (parsed as number) : null;
}

function formatContextWindow(tokens: number | null | undefined): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** chip 内容按 model_type 自适应 —— embedding 显示 dim, 其他显示上下文窗口 */
function resolveChip(model: AiModel): { label: string; title: string } | null {
  if (model.model_type === 'embedding') {
    const dim = resolveDim(model);
    return dim ? { label: `${dim}d`, title: `${dim} 维向量` } : null;
  }
  const ctx = formatContextWindow(model.context_window);
  return ctx ? { label: ctx, title: `${model.context_window} tokens 上下文窗口` } : null;
}

export function CodexModelPicker({
  models,
  providers,
  value,
  onChange,
  loading = false,
  disabled = false,
  placeholder = '选择模型',
  className,
  menuPlacement = 'bottom',
  clearable = false,
  clearLabel = '清空选择',
}: CodexModelPickerProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const providerMap = useMemo(() => {
    const map = new Map<string, AiProvider>();
    (providers || []).forEach((p) => map.set(p.code, p));
    return map;
  }, [providers]);

  const grouped = useMemo<GroupedModels[]>(() => {
    const byProvider = new Map<string, AiModel[]>();
    models.forEach((m) => {
      if (!byProvider.has(m.provider_code)) byProvider.set(m.provider_code, []);
      byProvider.get(m.provider_code)!.push(m);
    });
    const groups: GroupedModels[] = [];
    for (const [code, providerModels] of byProvider) {
      const provider = providerMap.get(code);
      groups.push({
        providerCode: code,
        providerIcon: provider?.icon ?? null,
        providerName: provider?.display_name || provider?.name || code,
        models: providerModels,
      });
    }
    groups.sort((a, b) => {
      const pa = providerMap.get(a.providerCode)?.priority ?? 0;
      const pb = providerMap.get(b.providerCode)?.priority ?? 0;
      return pb - pa;
    });
    return groups;
  }, [models, providerMap]);

  const filtered = useMemo<GroupedModels[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map((g) => {
        if (g.providerName.toLowerCase().includes(q) || g.providerCode.toLowerCase().includes(q)) {
          return g;
        }
        return {
          ...g,
          models: g.models.filter(
            (m) =>
              m.model_id.toLowerCase().includes(q) ||
              (m.display_name || '').toLowerCase().includes(q)
          ),
        };
      })
      .filter((g) => g.models.length > 0);
  }, [grouped, search]);

  const selected = value;

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inPortal = (target instanceof Element ? target : target.parentElement)?.closest('[data-embed-picker-portal]');
      if (!inTrigger && !inPortal) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      // 移动端不自动弹键盘, 桌面端 focus 搜索框
      if (!isMobile) {
        const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
        return () => window.clearTimeout(t);
      }
    } else {
      setSearch('');
    }
  }, [isOpen, isMobile]);

  // 移动端 Bottom Sheet 打开时锁 body 滚动, 避免背景惯性滑动.
  useEffect(() => {
    if (!isOpen || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen, isMobile]);

  const openMenu = () => {
    if (disabled || loading) return;
    if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    setIsOpen((v) => !v);
  };

  const handleSelect = (m: AiModel | null) => {
    onChange(m);
    setIsOpen(false);
  };

  // 桌面 popover 位置夹取: 不让右沿越过 viewport (留 8px 安全边距)
  const desktopRect = useMemo(() => {
    if (!triggerRect || isMobile) return null;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const preferredWidth = Math.max(triggerRect.width, 360);
    const width = Math.min(preferredWidth, vw - 16);
    let left = triggerRect.left;
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
    const maxHeight = 460;
    const top =
      menuPlacement === 'top'
        ? Math.max(8, triggerRect.top - 8 - maxHeight)
        : Math.min(vh - maxHeight - 8, triggerRect.bottom + 8);
    return { left, top, width, maxHeight };
  }, [triggerRect, isMobile, menuPlacement]);

  const totalCount = filtered.reduce((acc, g) => acc + g.models.length, 0);

  const listBody = (
    <>
      {clearable && value && (
        <div className="px-1.5 pt-1">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
              'transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] min-h-[44px]'
            )}
            onMouseEnter={(e) => {
              if (!isMobile) {
                e.currentTarget.style.background =
                  'color-mix(in oklch, var(--ink-primary) 5%, transparent)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <X className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
            <span
              className="font-mono uppercase tracking-[0.2em]"
              style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-secondary)' }}
            >
              {clearLabel}
            </span>
          </button>
        </div>
      )}
      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-12 gap-2"
          style={{ color: 'var(--ink-muted)' }}
        >
          <Box className="w-8 h-8 opacity-40" />
          <span
            className="font-mono uppercase tracking-[0.2em]"
            style={{ fontSize: 'var(--fs-micro)' }}
          >
            no match
          </span>
        </div>
      ) : (
        filtered.map((group) => (
          <div key={group.providerCode} className="px-1.5 py-1">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 sticky top-0 z-10 font-mono uppercase tracking-[0.22em]"
              style={{
                fontSize: 'var(--fs-micro)',
                color: 'var(--ink-muted)',
                background: 'color-mix(in oklch, var(--bg-raised) 85%, transparent)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <ProviderIcon code={group.providerCode} icon={group.providerIcon} size={14} />
              <span className="truncate">{group.providerName}</span>
              <span className="ml-auto opacity-60">
                {group.models.length.toString().padStart(2, '0')}
              </span>
            </div>

            <div className="space-y-0.5">
              {group.models.map((m) => {
                const isSelected = value?.id === m.id;
                const chip = resolveChip(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelect(m)}
                    data-selected={isSelected || undefined}
                    className={cn(
                      'group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                      'transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                      'min-h-[44px]' /* CLAUDE.md 移动端约束: 触控目标 ≥ 44px */
                    )}
                    style={{
                      background: isSelected
                        ? 'color-mix(in oklch, var(--aurora-1) 10%, transparent)'
                        : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isMobile) {
                        e.currentTarget.style.background =
                          'color-mix(in oklch, var(--aurora-1) 6%, transparent)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {isSelected && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full"
                        style={{
                          background: 'var(--aurora-1)',
                          boxShadow: '0 0 8px var(--aurora-1)',
                        }}
                      />
                    )}

                    <ProviderIcon
                      code={m.provider_code}
                      icon={providerMap.get(m.provider_code)?.icon ?? null}
                      size={18}
                      className="shrink-0"
                    />

                    <div className="flex-1 min-w-0 flex flex-col">
                      <span
                        className="font-sans truncate"
                        style={{
                          fontSize: 'var(--fs-caption)',
                          color: isSelected ? 'var(--aurora-1)' : 'var(--ink-primary)',
                          fontWeight: isSelected ? 500 : 400,
                        }}
                      >
                        {m.display_name || m.model_id}
                      </span>
                      <span
                        className="font-mono truncate"
                        style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
                      >
                        {m.model_id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {chip && (
                        <span
                          className="font-mono tabular-nums px-1.5 py-0.5 rounded"
                          style={{
                            fontSize: 'var(--fs-micro)',
                            color: 'var(--ink-secondary)',
                            background: 'color-mix(in oklch, var(--ink-primary) 5%, transparent)',
                            border: '1px solid color-mix(in oklch, var(--ink-primary) 8%, transparent)',
                          }}
                          title={chip.title}
                        >
                          {chip.label}
                        </span>
                      )}
                      {isSelected && (
                        <Check className="w-4 h-4" style={{ color: 'var(--aurora-1)' }} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );

  const searchHeader = (
    <div
      className="flex items-center gap-2 px-4 py-3 border-b"
      style={{ borderColor: 'color-mix(in oklch, var(--ink-primary) 8%, transparent)' }}
    >
      <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
      <input
        ref={searchInputRef}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索向量模型"
        className="flex-1 min-w-0 bg-transparent border-0 outline-none font-sans placeholder:opacity-50"
        style={{ fontSize: 'var(--fs-caption)', color: 'var(--ink-primary)' }}
      />
      <span
        className="font-mono uppercase tracking-[0.2em] shrink-0"
        style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
      >
        {totalCount}
      </span>
    </div>
  );

  return (
    <div className={cn('relative', className)}>
      <motion.button
        ref={triggerRef}
        type="button"
        disabled={disabled || loading}
        onClick={openMenu}
        whileTap={{ scale: 0.985 }}
        transition={spring.precise}
        data-interactive="true"
        className={cn(
          'surface-leaf !rounded-full',
          'flex items-center gap-2 w-full h-10 px-4 min-w-0',
          'text-left font-mono uppercase tracking-[0.18em]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          isOpen && 'ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
        )}
        style={{ fontSize: 'var(--fs-micro)' }}
      >
        {selected ? (
          <>
            <ProviderIcon
              code={selected.provider_code}
              icon={providerMap.get(selected.provider_code)?.icon ?? null}
              size={16}
              className="shrink-0"
            />
            <span
              className="truncate min-w-0 text-[color:var(--ink-primary)]"
              title={selected.display_name || selected.model_id}
            >
              {selected.display_name || selected.model_id}
            </span>
            {/* 移动端隐藏 provider_code 后缀, 避免与模型名争抢可视空间 */}
            {!isMobile && (
              <span
                className="shrink-0 normal-case tracking-normal"
                style={{ color: 'var(--ink-muted)' }}
              >
                {selected.provider_code}
              </span>
            )}
          </>
        ) : (
          <>
            <Box className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
            <span className="truncate min-w-0" style={{ color: 'var(--ink-muted)' }}>
              {loading ? '载入中…' : placeholder}
            </span>
          </>
        )}
        <ChevronsUpDown
          className="w-3.5 h-3.5 ml-auto shrink-0 opacity-60 transition-transform"
          style={{
            color: 'var(--ink-muted)',
            transform: isOpen ? 'rotate(180deg)' : undefined,
          }}
        />
      </motion.button>

      {isOpen &&
        createPortal(
          <AnimatePresence>
            {isMobile ? (
              /* ---------- 移动端 Bottom Sheet ---------- */
              <div
                data-embed-picker-portal
                className="fixed inset-0 z-[9999] flex flex-col justify-end"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition.quick}
                  onClick={() => setIsOpen(false)}
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={spring.soft}
                  className="surface-overlay relative z-10 flex flex-col !rounded-t-3xl !rounded-b-none"
                  style={{
                    maxHeight: '66vh',
                    paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
                  }}
                >
                  {/* 抽屉手柄 */}
                  <div className="flex-shrink-0 flex justify-center pt-3 pb-2">
                    <span
                      className="w-10 h-1 rounded-full"
                      style={{
                        background: 'color-mix(in oklch, var(--ink-primary) 20%, transparent)',
                      }}
                    />
                  </div>
                  <div className="flex-shrink-0 flex items-center justify-between px-4 pb-2">
                    <span
                      className="font-mono uppercase tracking-[0.22em]"
                      style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
                    >
                      向量化模型
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      aria-label="关闭"
                      className="w-11 h-11 flex items-center justify-center rounded-full -mr-2"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {searchHeader}
                  <div className="flex-1 overflow-y-auto py-1">{listBody}</div>
                </motion.div>
              </div>
            ) : (
              /* ---------- 桌面 Popover ---------- */
              <div
                data-embed-picker-portal
                className="fixed inset-0 z-[9999] pointer-events-none"
              >
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={transition.quick}
                  className="surface-overlay pointer-events-auto absolute flex flex-col overflow-hidden"
                  style={{
                    left: desktopRect?.left ?? 0,
                    top: desktopRect?.top ?? 0,
                    width: desktopRect?.width ?? 360,
                    maxHeight: 460,
                  }}
                >
                  {searchHeader}
                  <div className="flex-1 overflow-y-auto py-1">{listBody}</div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

export default CodexModelPicker;
