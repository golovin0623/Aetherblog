'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  Box,
  Braces,
  Brain,
  Check,
  ChevronDown,
  Eye,
  Globe,
  Image,
  Paperclip,
  Search,
  SlidersHorizontal,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '@aetherblog/ui';
import { useAgentModels, type AgentModelItem } from '../../lib/agentModels';
import AgentProviderIcon from './AgentProviderIcon';

interface Props {
  /** 当前会话选中的模型；null/undefined 表示用后端默认。 */
  value: { modelId?: string | null; providerCode?: string | null };
  onChange: (modelId: string | null, providerCode: string | null) => void;
  /** 是否启用拉取（未鉴权完成前 false）。 */
  enabled: boolean;
  /** 弹出方向：composer 内嵌时往上弹避免被键盘遮挡。 */
  placement?: 'bottom-end' | 'top-start';
  /** 紧凑模式：composer 内嵌时高度更小、padding 更紧。 */
  compact?: boolean;
}

function modelLabel(item: AgentModelItem): string {
  return item.displayName?.trim() || item.modelId;
}

function formatContextWindow(value?: number | null): string | null {
  if (!value || value <= 0) return null;
  if (value >= 1_000_000) {
    const rounded = Math.round((value / 1_000_000) * 10) / 10;
    return `${String(rounded).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatTokenLabel(value?: number | null): string | null {
  const label = formatContextWindow(value);
  return label ? `${label} tokens` : null;
}

function formatParamLabel(value: string): string {
  const labels: Record<string, string> = {
    disableContextCaching: '禁用缓存',
    enableReasoning: '思考',
    gpt5ReasoningEffort: 'GPT-5 思考',
    reasoningBudgetToken: '思考预算',
    reasoningEffort: '思考强度',
    textVerbosity: '详略',
  };
  return labels[value] || value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function abilityEntries(item: AgentModelItem) {
  const abilities = item.abilities || {};
  return [
    { key: 'functionCall', label: '工具', icon: Wrench },
    { key: 'vision', label: '视觉', icon: Eye },
    { key: 'reasoning', label: '推理', icon: Brain },
    { key: 'search', label: '搜索', icon: Globe },
    { key: 'structuredOutput', label: '结构化', icon: Braces },
    { key: 'imageOutput', label: '绘图', icon: Image },
    { key: 'video', label: '视频', icon: Video },
    { key: 'files', label: '文件', icon: Paperclip },
  ].filter((entry) => Boolean(abilities[entry.key as keyof NonNullable<AgentModelItem['abilities']>]));
}

function ModelGlyph({ item, compact = false }: { item?: AgentModelItem | null; compact?: boolean }) {
  const size = compact ? 24 : 28;

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-[var(--ink-subtle)]/16 bg-[var(--bg-raised)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_9%,transparent)]',
        compact ? 'h-6 w-6' : 'h-7 w-7',
      )}
      aria-hidden="true"
    >
      {item ? (
        <AgentProviderIcon
          code={item.providerCode}
          icon={item.providerIcon}
          size={Math.max(14, size - 10)}
        />
      ) : (
        <Box className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
      )}
    </span>
  );
}

/**
 * ModelPicker —— 工作台顶栏的"模型"下拉。
 *
 * 显示形态：
 *   ┌──────────────────────┐
 *   │ ◯ Claude Opus 4.7  ▾ │   ← 触发按钮 (font-mono prefix + 当前 displayName)
 *   └──────────────────────┘
 *   弹出时按 providerCode 分组，每组顶端是 § PROVIDER 上眉文。
 *
 * 交互：
 *  - 点空白处 / Esc 关闭
 *  - 选中 → 关闭并 onChange
 *  - "默认（按任务路由）" 选项把 modelId/providerCode 都置 null
 *
 * 加载/错误时按 surface-leaf 玻璃卡占位，不刷红字 —— 仍然让对话可发送，
 * 让后端自己决定路由。
 */
export default function ModelPicker({
  value,
  onChange,
  enabled,
  placement = 'bottom-end',
  compact = false,
}: Props) {
  const state = useAgentModels(enabled);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, isMobile]);

  // 关闭策略 —— 仅监听 ESC，外部点击靠 backdrop overlay 拦截。
  // 历史方案用 document.pointerdown + wrapperRef.contains() 检测：iOS Safari
  // 上有几率把合法的"选项点击"误判成"外部点击"先 setOpen(false)，导致选项
  // onClick 还没机会跑就被 unmount，表现为"模型选择不生效"。换 backdrop
  // 后选项 onClick 必然先于 backdrop（菜单在 z-index 上方），不再有竞态。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // 弹层定位：把 menu 通过 Portal 挂到 document.body 之外，避开 composer / mobile
  // 控制条父级因 backdrop-filter / surface-leaf 创建的 stacking context —— 否则
  // 即便给 menu 写 z-50，它仍会被同级（DOM 在后）的 thread/EmptyState 容器盖住，
  // 表现为"下拉显示在最底层、点击不到"。Portal + position: fixed 让弹层一定盖在
  // 全屏最上方。
  const measureTrigger = useCallback(() => {
    if (!triggerRef.current) return;
    setTriggerRect(triggerRef.current.getBoundingClientRect());
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measureTrigger();
    const onResize = () => measureTrigger();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, measureTrigger]);

  // 把 items 按 providerCode 分组
  const items = useMemo<AgentModelItem[]>(
    () => (state.status === 'ready' ? state.items : []),
    [state],
  );
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.providerCode,
        item.providerName,
        item.modelId,
        item.displayName,
        item.description,
        ...(item.extendParams || []),
        ...abilityEntries(item).map((entry) => entry.label),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, AgentModelItem[]>();
    for (const it of filteredItems) {
      const list = map.get(it.providerCode) ?? [];
      list.push(it);
      map.set(it.providerCode, list);
    }
    return Array.from(map.entries()).map(([provider, items]) => ({ provider, items }));
  }, [filteredItems]);

  // 触发按钮显示态：用户主动选过（modelId 非 null）→ 仅显示 displayName；
  // 未选 / 自动模式 → "自动 · <默认 displayName>" 暗示当前会落到的模型。
  // 不再叠加"模型 · "前缀 —— icon + ChevronDown 已经传达"这是模型选择"语义，
  // 三段叠加（"模型 · 自动 · gpt-5.4"）在 320px 屏宽下必截断，反而降低识别度。
  const currentLabel = useMemo(() => {
    if (state.status !== 'ready') return '默认模型';
    if (!value.modelId) {
      const fallback = items.find((m) => m.isDefault) || items[0];
      return fallback ? `自动 · ${modelLabel(fallback)}` : '自动';
    }
    const found = items.find(
      (m) => m.modelId === value.modelId && m.providerCode === value.providerCode,
    );
    return found ? modelLabel(found) : value.modelId;
  }, [items, state.status, value]);

  const currentModel = useMemo(() => {
    if (!value.modelId) return null;
    return (
      items.find((m) => m.modelId === value.modelId && m.providerCode === value.providerCode) ??
      null
    );
  }, [items, value]);
  const triggerModel = currentModel ?? items.find((m) => m.isDefault) ?? items[0] ?? null;
  const currentContext = formatContextWindow((currentModel ?? triggerModel)?.contextWindow);

  // 用户主动选过非 null 的模型 → icon 着色（aurora），强化"已主动选择"感知。
  const isUserSelected = !!value.modelId;

  // 紧凑（composer 内嵌）时采用 LobeHub 式工具胶囊：移动端只露模型图标，
  // 与 @/#/slash/send 同轴对齐；桌面端再展开当前模型名称，避免窄屏抢空间。
  const triggerClass = compact
    ? 'inline-flex h-8 min-w-0 max-w-[38vw] items-center justify-start gap-1.5 rounded-full border border-[var(--ink-subtle)]/16 bg-[var(--bg-leaf)] px-2.5 text-[12px] text-[var(--ink-secondary)] shadow-[0_1px_0_inset_color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-all duration-quick ease-aether hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] active:scale-95 sm:max-w-[240px]'
    : 'inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[var(--ink-subtle)]/20 bg-[var(--bg-raised)] px-2.5 py-1.5 text-[12px] text-[var(--ink-secondary)] transition-all hover:border-[var(--aurora-1)]/40 hover:text-[var(--ink-primary)] active:scale-[0.97]';

  // 弹出尺寸：top-start 用 300px、bottom-end 用 280px。
  const popoverWidth = placement === 'top-start' ? 360 : 320;
  // 内容高度上限（max-h-[360px] 内框 + 上下 padding 8px*2 ≈ 376px）。
  // 实际渲染高度作为"理想"上限，若任一方向空间不足则按可用空间夹紧并塞入
  // 内框 maxHeight，避免菜单溢出视口顶部 / 底部。
  const idealMenuHeight = 460;

  // 计算 portal 弹层的 fixed 坐标。横向：贴齐按钮端点 + 8px 视口安全区；
  // 纵向：先按 placement 偏好放，空间不够则翻转到对侧；最终若两侧都不够，
  // 把弹层压成"剩余空间 - 8px"并把 maxHeight 透传到内滚动框。
  const { popStyle, contentMaxHeight } = useMemo<{
    popStyle: CSSProperties;
    contentMaxHeight: number | null;
  }>(() => {
    if (!triggerRect || typeof window === 'undefined') {
      return {
        popStyle: { position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none' },
        contentMaxHeight: null,
      };
    }
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 横向定位 + 视口夹紧
    let left: number;
    if (placement === 'top-start') {
      left = triggerRect.left;
    } else {
      left = triggerRect.right - popoverWidth;
    }
    if (left + popoverWidth > viewportWidth - margin) {
      left = viewportWidth - popoverWidth - margin;
    }
    if (left < margin) left = margin;

    // 纵向：先按偏好计算可用空间，不够就翻转。
    const spaceBelow = viewportHeight - triggerRect.bottom - margin;
    const spaceAbove = triggerRect.top - margin;
    const prefersTop = placement === 'top-start';
    const preferredSpace = prefersTop ? spaceAbove : spaceBelow;
    const oppositeSpace = prefersTop ? spaceBelow : spaceAbove;
    const flipped = preferredSpace < idealMenuHeight && oppositeSpace > preferredSpace;
    const useTop = prefersTop ? !flipped : flipped;
    const usableSpace = useTop ? spaceAbove : spaceBelow;
    // 最终内容上限 = min(理想, 可用) - 估算 padding 16px。null = 不限制。
    const heightCap = Math.max(120, Math.min(idealMenuHeight, usableSpace) - 16);
    const contentMax = usableSpace < idealMenuHeight ? heightCap : null;

    if (useTop) {
      // 弹层底边贴在 trigger 上方 8px 处。
      const bottom = viewportHeight - (triggerRect.top - 8);
      return {
        popStyle: {
          position: 'fixed',
          left,
          bottom,
          width: popoverWidth,
        },
        contentMaxHeight: contentMax,
      };
    }
    return {
      popStyle: {
        position: 'fixed',
        left,
        top: triggerRect.bottom + 6,
        width: popoverWidth,
      },
      contentMaxHeight: contentMax,
    };
  }, [triggerRect, placement, popoverWidth]);

  const motionProps =
    placement === 'top-start'
      ? { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 } }
      : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };

  const totalCount = state.status === 'ready' ? filteredItems.length : 0;

  const searchHeader = (
    <div className="border-b border-[var(--ink-subtle)]/15 p-3">
      <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-raised)] px-3 py-2 text-[var(--ink-muted)] ring-1 ring-[var(--ink-subtle)]/18">
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模型、供应商或能力 ..."
          className="h-7 min-w-0 flex-1 bg-transparent text-sm text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none"
          autoFocus={!isMobile}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
          {state.status === 'ready' ? totalCount : '--'}
        </span>
      </div>
    </div>
  );

  const renderListBody = (maxHeight?: number | string) => (
    <div
      className="agent-thumb-scroll overflow-y-auto p-2"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <button
        type="button"
        role="option"
        aria-selected={!value.modelId}
        onClick={() => {
          onChange(null, null);
          setOpen(false);
        }}
        className={cn(
          'relative flex min-h-[58px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.985]',
          !value.modelId
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
            : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]',
        )}
      >
        {!value.modelId && (
          <span
            aria-hidden="true"
            className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full bg-[var(--aurora-1)] shadow-[0_0_10px_color-mix(in_oklch,var(--aurora-1)_65%,transparent)]"
          />
        )}
        <ModelGlyph item={triggerModel} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">自动选择</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            跟随任务路由
          </div>
        </div>
        {!value.modelId && <Check className="h-3.5 w-3.5 shrink-0" />}
      </button>

      <div className="mx-3 my-1 h-px bg-[var(--ink-subtle)]/15" />

      {state.status === 'loading' && (
        <div className="space-y-2 px-3 py-3" aria-label="加载模型清单">
          <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--bg-raised)]" />
          <div className="h-14 animate-pulse rounded-xl bg-[var(--bg-raised)]" />
          <div className="h-14 animate-pulse rounded-xl bg-[var(--bg-raised)]" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="px-3 py-3 font-mono text-[10.5px] tracking-[0.06em] text-[var(--signal-warn)]">
          加载失败 · {state.message}
        </div>
      )}

      {state.status === 'ready' && grouped.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-[var(--ink-muted)]">
          <Box className="h-7 w-7 opacity-45" aria-hidden="true" />
          <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]">
            {query.trim() ? '没有匹配的模型' : '暂无可用模型 · 请到 admin 配置'}
          </div>
        </div>
      )}

      {state.status === 'ready' &&
        grouped.map((g) => {
          const providerLabel = g.items[0]?.providerName || g.provider;
          const providerIcon = g.items[0]?.providerIcon ?? null;
          const allUserScope = g.items.every((m) => m.scope === 'user');
          return (
            <section key={g.provider} className="pt-1">
              <div
                className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]/85 backdrop-blur-xl"
                style={{ background: 'color-mix(in oklch, var(--bg-leaf) 88%, transparent)' }}
              >
                <AgentProviderIcon code={g.provider} icon={providerIcon} size={14} />
                <span className="min-w-0 flex-1 truncate">{providerLabel}</span>
                <span className="tabular-nums opacity-70">{String(g.items.length).padStart(2, '0')}</span>
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 tracking-[0.18em]',
                    allUserScope
                      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
                      : 'bg-[var(--bg-raised)] text-[var(--ink-muted)]',
                  )}
                >
                  {allUserScope ? '我的' : '系统'}
                </span>
              </div>
              <div className="space-y-0.5">
                {g.items.map((m) => {
                  const isActive =
                    value.modelId === m.modelId && value.providerCode === m.providerCode;
                  const abilities = abilityEntries(m);
                  const extendParams = (m.extendParams || []).slice(0, 3);
                  const extraParamCount = Math.max(0, (m.extendParams || []).length - extendParams.length);
                  const contextLabel = formatContextWindow(m.contextWindow);
                  const outputLabel = formatContextWindow(m.maxOutputTokens);

                  return (
                    <button
                      key={`${m.providerCode}::${m.modelId}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onChange(m.modelId, m.providerCode);
                        setOpen(false);
                      }}
                      className={cn(
                        'relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.985]',
                        isActive
                          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                          : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]',
                      )}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full bg-[var(--aurora-1)] shadow-[0_0_10px_color-mix(in_oklch,var(--aurora-1)_65%,transparent)]"
                        />
                      )}
                      <ModelGlyph item={m} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium">
                            {m.displayName || m.modelId}
                          </span>
                          {m.releasedAt && (
                            <span className="hidden shrink-0 rounded-md bg-[var(--bg-leaf)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)] sm:inline">
                              {m.releasedAt}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          <span className="min-w-0 truncate">{m.modelId}</span>
                          {contextLabel && (
                            <span
                              className="shrink-0 rounded-md bg-[var(--bg-leaf)] px-1.5 py-0.5 tracking-[0.08em]"
                              title={formatTokenLabel(m.contextWindow) || undefined}
                            >
                              {contextLabel} ctx
                            </span>
                          )}
                          {outputLabel && (
                            <span
                              className="shrink-0 rounded-md bg-[var(--bg-leaf)] px-1.5 py-0.5 tracking-[0.08em]"
                              title={formatTokenLabel(m.maxOutputTokens) || undefined}
                            >
                              {outputLabel} out
                            </span>
                          )}
                        </div>
                        {m.description && (
                          <div className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
                            {m.description}
                          </div>
                        )}
                        {(abilities.length > 0 || extendParams.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {abilities.map(({ key, label, icon: Icon }) => (
                              <span
                                key={key}
                                className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--bg-leaf)] px-1.5 text-[10px] text-[var(--ink-muted)] ring-1 ring-[var(--ink-subtle)]/12"
                              >
                                <Icon className="h-3 w-3" aria-hidden="true" />
                                <span>{label}</span>
                              </span>
                            ))}
                            {extendParams.map((param) => (
                              <span
                                key={param}
                                className="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-1.5 text-[10px] text-[var(--aurora-1)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]"
                                title={param}
                              >
                                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                                <span>{formatParamLabel(param)}</span>
                              </span>
                            ))}
                            {extraParamCount > 0 && (
                              <span className="inline-flex h-5 items-center rounded-full bg-[var(--bg-leaf)] px-1.5 font-mono text-[10px] text-[var(--ink-muted)] ring-1 ring-[var(--ink-subtle)]/12">
                                +{extraParamCount}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {isActive && <Check className="mt-1 h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${triggerClass} ${
          isUserSelected ? 'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]' : ''
        }`}
        title="切换模型"
      >
        {state.status === 'error' ? (
          <AlertCircle className="w-3 h-3 text-[var(--signal-warn)] flex-shrink-0" />
        ) : (
          <span className={state.status === 'loading' ? 'animate-pulse' : undefined}>
            <ModelGlyph item={triggerModel} compact />
          </span>
        )}
        <span className={compact ? 'min-w-0 truncate' : 'truncate'}>{currentLabel}</span>
        {currentContext && (
          <span className="hidden rounded-md bg-[var(--bg-leaf)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)] sm:inline">
            {currentContext}
          </span>
        )}
        <ChevronDown className={`hidden w-3 h-3 flex-shrink-0 transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open &&
              (isMobile ? (
                <div className="fixed inset-0 z-[1000] flex flex-col justify-end">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                    aria-hidden="true"
                  />
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
                    role="listbox"
                    aria-label="选择模型"
                    className="surface-overlay relative z-[1001] flex max-h-[66vh] flex-col overflow-hidden rounded-t-[28px] border border-[var(--ink-subtle)]/20 bg-[var(--bg-leaf)] shadow-[0_-24px_54px_-28px_rgba(0,0,0,0.42)]"
                    style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                  >
                    <div className="flex shrink-0 justify-center pb-2 pt-3">
                      <span className="h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_22%,transparent)]" />
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                        模型与能力
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="关闭模型选择"
                        className="grid h-10 w-10 place-items-center rounded-full text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {searchHeader}
                    <div className="min-h-0 flex-1">{renderListBody('100%')}</div>
                  </motion.div>
                </div>
              ) : (
                <>
                  <div
                    className="fixed inset-0 z-[1000]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                    }}
                    aria-hidden="true"
                  />
                  <motion.div
                    {...motionProps}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    role="listbox"
                    aria-label="选择模型"
                    style={{ ...popStyle, background: 'var(--bg-leaf)', zIndex: 1001 }}
                    className="surface-overlay overflow-hidden rounded-xl border border-[var(--ink-subtle)]/20 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.25)]"
                  >
                    {searchHeader}
                    {renderListBody(contentMaxHeight ?? 400)}
                  </motion.div>
                </>
              ))}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
