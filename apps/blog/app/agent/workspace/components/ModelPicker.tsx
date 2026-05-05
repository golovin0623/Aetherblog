'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Cpu, Loader2, AlertCircle } from 'lucide-react';
import { useAgentModels, type AgentModelItem } from '../../lib/agentModels';

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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 把 items 按 providerCode 分组
  const grouped = useMemo(() => {
    if (state.status !== 'ready') return [] as { provider: string; items: AgentModelItem[] }[];
    const map = new Map<string, AgentModelItem[]>();
    for (const it of state.items) {
      const list = map.get(it.providerCode) ?? [];
      list.push(it);
      map.set(it.providerCode, list);
    }
    return Array.from(map.entries()).map(([provider, items]) => ({ provider, items }));
  }, [state]);

  // 触发按钮显示态：用户主动选过（modelId 非 null）→ 仅显示 displayName；
  // 未选 / 自动模式 → "自动 · <默认 displayName>" 暗示当前会落到的模型。
  // 不再叠加"模型 · "前缀 —— icon + ChevronDown 已经传达"这是模型选择"语义，
  // 三段叠加（"模型 · 自动 · gpt-5.4"）在 320px 屏宽下必截断，反而降低识别度。
  const currentLabel = useMemo(() => {
    if (state.status !== 'ready') return '默认模型';
    if (!value.modelId) {
      const fallback = state.items.find((m) => m.isDefault) || state.items[0];
      return fallback ? `自动 · ${fallback.displayName || fallback.modelId}` : '自动';
    }
    const found = state.items.find(
      (m) => m.modelId === value.modelId && m.providerCode === value.providerCode,
    );
    return found ? found.displayName || found.modelId : value.modelId;
  }, [state, value]);

  // 用户主动选过非 null 的模型 → icon 着色（aurora），强化"已主动选择"感知。
  const isUserSelected = !!value.modelId;

  // 紧凑（composer 内嵌 / 移动端控制条）时按钮高度移动端 44px、桌面 28px；
  // 移动端 max-w 紧到 160px 避免与同一行的发送 / 工具按钮抢空间，桌面回到
  // 240px 给完整 displayName。Apple HIG 推荐触控目标 ≥44×44，移动端严格符合。
  const triggerClass = compact
    ? 'inline-flex items-center gap-1 px-2 h-11 sm:h-7 rounded-md bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors text-[12px] max-w-[160px] sm:max-w-[240px]'
    : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/40 transition-colors text-[12px] max-w-[220px]';

  // 弹出位置：top-start 让 popover 出现在按钮上方左对齐，避免遮挡 composer 内容。
  const popClass =
    placement === 'top-start'
      ? 'absolute left-0 bottom-full mb-2 w-[300px]'
      : 'absolute right-0 mt-1.5 w-[280px]';

  const motionProps =
    placement === 'top-start'
      ? { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 } }
      : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerClass}
        title="切换模型"
      >
        {state.status === 'loading' ? (
          <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
        ) : state.status === 'error' ? (
          <AlertCircle className="w-3 h-3 text-[var(--signal-warn)] flex-shrink-0" />
        ) : (
          <Cpu
            className={`w-3 h-3 flex-shrink-0 ${
              isUserSelected ? 'text-[var(--aurora-1)]' : 'text-[var(--aurora-1)]/65'
            }`}
          />
        )}
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            {...motionProps}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            role="listbox"
            className={`${popClass} surface-overlay rounded-xl border border-[var(--ink-subtle)]/20 z-50 overflow-hidden shadow-[0_24px_48px_-16px_rgba(0,0,0,0.25)]`}
          >
            <div className="max-h-[360px] overflow-y-auto py-2">
              {/* 默认（自动）选项 */}
              <button
                type="button"
                role="option"
                aria-selected={!value.modelId}
                onClick={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 flex items-start justify-between gap-2 transition-colors ${
                  !value.modelId
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">自动选择</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-0.5">
                    跟随任务路由
                  </div>
                </div>
                {!value.modelId && <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
              </button>

              <div className="my-1 mx-3 h-px bg-[var(--ink-subtle)]/15" />

              {state.status === 'loading' && (
                <div className="px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  加载中…
                </div>
              )}

              {state.status === 'error' && (
                <div className="px-3 py-3 font-mono text-[10.5px] tracking-[0.06em] text-[var(--signal-warn)]">
                  加载失败 · {state.message}
                </div>
              )}

              {state.status === 'ready' && grouped.length === 0 && (
                <div className="px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  暂无可用模型 · 请到 admin 配置
                </div>
              )}

              {state.status === 'ready' &&
                grouped.map((g) => {
                  const providerLabel = g.items[0]?.providerName || g.provider;
                  const allUserScope = g.items.every((m) => m.scope === 'user');
                  return (
                    <section key={g.provider} className="pt-1">
                      <div className="px-3 py-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)]/85 truncate">
                          § {providerLabel}
                        </span>
                        <span
                          className="font-mono text-[9px] uppercase tracking-[0.22em]"
                          style={{
                            color: allUserScope
                              ? 'var(--aurora-1)'
                              : 'color-mix(in oklch, var(--ink-muted) 80%, transparent)',
                          }}
                        >
                          {allUserScope ? '我的' : '系统'}
                        </span>
                      </div>
                      {g.items.map((m) => {
                        const isActive =
                          value.modelId === m.modelId && value.providerCode === m.providerCode;
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
                            className={`w-full text-left px-3 py-2 flex items-start justify-between gap-2 transition-colors ${
                              isActive
                                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                                : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] truncate">
                                {m.displayName || m.modelId}
                              </div>
                              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-0.5 flex items-center gap-1.5">
                                <span className="truncate">{m.modelId}</span>
                                {m.contextWindow && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="flex-shrink-0">
                                      {Math.round(m.contextWindow / 1000)}k ctx
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0 mt-1" />}
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
