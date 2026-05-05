'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Code2, MessageSquare, Sparkles, Lock } from 'lucide-react';
import type { AgentMode } from '../../lib/agentSessions';

interface Props {
  value: AgentMode;
  onChange: (v: AgentMode) => void;
}

interface ModeOption {
  value: AgentMode;
  label: string;
  icon: typeof MessageSquare;
  /** 是否已上线。false → segmented control 上锁，点击弹说明卡而不切换 mode。 */
  available: boolean;
  /** 一句话定位 —— 解释这个模式*将*是什么，不是"另一种 prompt"。 */
  oneLiner: string;
  /** 详细描述 —— 弹层用，2-3 句。 */
  detail: string;
}

const OPTIONS: ModeOption[] = [
  {
    value: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    available: true,
    oneLiner: '同步问答模式 · 已上线',
    detail: '基于站点知识库的轻量问答。支持 @ 引用文章、# 标签筛选、/ 命令。一次 LLM 调用即结束，不持久化任何会话外的副作用。',
  },
  {
    value: 'cowork',
    label: 'Cowork',
    icon: Sparkles,
    available: false,
    oneLiner: '主动副手 · 设计冻结，开发推迟',
    detail: '一个会主动工作的异步副手：定时跑任务（每个工作日 9 点给我份行业速览）、调用多种工具（KB / Web / 图片生成）、把成果以站内通知 / 草稿 / 图集形式推送回来。完整设计文档：docs/agent/COWORK_ROADMAP.md。',
  },
  {
    value: 'code',
    label: 'Code',
    icon: Code2,
    available: false,
    oneLiner: 'Agent 编排平台 · 设计冻结，开发推迟',
    detail: '最底层的 Agent 原语：注册工具、定义工作流（YAML / DAG / 自治）、节点级 trace 与调试器、autonomous 执行轨迹一键固化为可复用模板。完整设计文档：docs/agent/CODE_ROADMAP.md。',
  },
];

/**
 * 顶部 segmented control —— 三种工作模式切换。
 *
 * 当前状态（2026-05-05）：
 *   · Chat 已上线，正常切换；
 *   · Cowork / Code 设计已冻结但开发未启动 —— 在 segmented 上加锁标记，
 *     点击不切换 mode，而是弹出 InfoPopover 说明定位与去向。
 *
 * 这一锁定不是 UI 装饰 —— 它的目的是**防止用户误把三个模式当成"三个 prompt"**。
 * 文案严格围绕"它将是什么独立子系统"展开，而不是"它和 Chat 用什么不同的语气"。
 *
 * 视觉走 BlogHeader 同款 iOS 21 segmented 风格保持前台一致性。
 */
export default function ModeSwitch({ value, onChange }: Props) {
  const [activeInfo, setActiveInfo] = useState<AgentMode | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部 / ESC 关闭
  useEffect(() => {
    if (!activeInfo) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setActiveInfo(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveInfo(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeInfo]);

  return (
    <div ref={wrapRef} className="relative">
      <div
        role="group"
        aria-label="对话模式"
        className="relative inline-flex items-center rounded-[14px] p-[3px] backdrop-blur-2xl bg-black/[0.06] dark:bg-white/[0.06] border border-[var(--ink-subtle)]/15"
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          // value 永远视觉上指向 chat —— 即使 session 历史里残留 cowork/code，UI 也只高亮 chat。
          const effectiveValue: AgentMode = OPTIONS.find((o) => o.value === value && o.available)?.value ?? 'chat';
          const isActive = opt.value === effectiveValue;
          const isLocked = !opt.available;

          return (
            <button
              key={opt.value}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-label={isLocked ? `${opt.label}（敬请期待）` : opt.label}
              aria-haspopup={isLocked ? 'dialog' : undefined}
              aria-expanded={isLocked ? activeInfo === opt.value : undefined}
              onClick={() => {
                if (isLocked) {
                  setActiveInfo((curr) => (curr === opt.value ? null : opt.value));
                } else {
                  setActiveInfo(null);
                  onChange(opt.value);
                }
              }}
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[11px] text-[12px] font-medium tracking-[-0.01em] transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--bg-raised)] text-[var(--aurora-1)] shadow-[0_2px_6px_rgba(0,0,0,0.10)]'
                  : isLocked
                  ? 'text-[var(--ink-muted)]/75 hover:text-[var(--ink-secondary)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{opt.label}</span>
              {isLocked && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-flex items-center justify-center px-1 py-px rounded-full text-[8.5px] font-mono uppercase tracking-[0.16em] bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]/80 border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]"
                >
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 锁定模式的说明卡 */}
      <AnimatePresence>
        {activeInfo && (
          <ModeInfoPopover
            mode={OPTIONS.find((o) => o.value === activeInfo)!}
            onClose={() => setActiveInfo(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ModeInfoPopover —— 锁定模式的说明弹层
 *
 * 目的是回答用户唯一关心的两个问题：
 *   1. 这个模式将是什么？（区别于 Chat）
 *   2. 什么时候能用？
 *
 * 不解释架构、不列工具，那些放在 docs/agent/*.md。
 */
function ModeInfoPopover({ mode, onClose }: { mode: ModeOption; onClose: () => void }) {
  const docPath = mode.value === 'cowork' ? 'docs/agent/COWORK_ROADMAP.md' : 'docs/agent/CODE_ROADMAP.md';
  const Icon = mode.icon;

  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      aria-label={`${mode.label} 模式说明`}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute right-0 top-full mt-2 w-[min(92vw,360px)] surface-overlay rounded-2xl border border-[var(--ink-subtle)]/22 z-50 overflow-hidden shadow-[0_20px_44px_-16px_rgba(0,0,0,0.35)]"
    >
      <div className="p-4 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)] flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[15px] text-[var(--ink-primary)] leading-tight">
                {mode.label}
              </span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-mono uppercase tracking-[0.18em] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]/85 border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]">
                <Lock className="w-2.5 h-2.5" />
                Coming
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mt-0.5">
              {mode.oneLiner}
            </div>
          </div>
        </div>

        <p className="text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
          {mode.detail}
        </p>

        <div className="pt-1.5 border-t border-[var(--ink-subtle)]/12 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-[var(--ink-muted)]/85 truncate">
            {docPath}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors px-2 py-1 -mr-2"
          >
            收起
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------
 * 给外部判断"哪些模式可用"用的导出 —— WorkspaceClient 防御性约束。
 * ------------------------------------------------------------- */
export const AVAILABLE_MODES: ReadonlySet<AgentMode> = new Set(
  OPTIONS.filter((o) => o.available).map((o) => o.value),
);
