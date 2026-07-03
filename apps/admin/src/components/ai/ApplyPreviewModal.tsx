/**
 * AI 工具长文本应用预览（润色 / 翻译 / 大纲）共享 Modal。
 *
 * 不同工具的预览形态由"输出特性"决定：
 *   - polish    → 同语种整体替换 → word-level diff（红删 / 绿加）
 *   - translate → 跨语言无法逐字 diff → split-view 并排呈现
 *   - outline   → 多为追加 → 渲染"应用后整篇"的 markdown 全貌；replace 模式渲染单独的大纲
 *
 * 设计要点：
 *   - 全屏 modal 在桌面上铺到 4xl 宽（packages/ui Modal 'full' size），移动端
 *     底部充满，避免长文本在普通弹窗里折成"邮票"。
 *   - 顶部 stats 行（字符数 / 增删数）让用户先快速判断"动了多少"，再决定
 *     是否细看正文。
 *   - 底部仍保留 Confirm/Cancel 一致语义；onConfirm 可以是异步的（写库），
 *     执行期间禁用按钮防双击。
 */

import { useMemo, useState } from 'react';
import { Modal } from '@aetherblog/ui';
import { MarkdownPreview } from '@aetherblog/editor';
import { ArrowRight, Languages, ListPlus, Loader2, PenLine } from 'lucide-react';
import { diffWords } from 'diff';
import { cn } from '@/lib/utils';

export type PreviewToolKind = 'polish' | 'translate' | 'outline';
export type PreviewApplyMode = 'replace' | 'append';

interface ApplyPreviewModalProps {
  isOpen: boolean;
  tool: PreviewToolKind;
  mode: PreviewApplyMode;
  /** 应用前正文（润色/翻译用作 diff/split 的左侧；outline append 用作前缀拼接） */
  currentContent: string;
  /** AI 生成的新内容（润色后正文 / 译文 / 大纲 markdown） */
  nextContent: string;
  /** 仅 translate 使用：右栏 badge */
  targetLanguage?: string;
  previewTheme: 'light' | 'dark';
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

const toolMeta: Record<PreviewToolKind, { title: string; icon: typeof PenLine; confirmLabel: string }> = {
  polish: { title: '润色应用预览', icon: PenLine, confirmLabel: '替换正文' },
  translate: { title: '翻译应用预览', icon: Languages, confirmLabel: '替换正文' },
  outline: { title: '大纲应用预览', icon: ListPlus, confirmLabel: '应用大纲' },
};

/** 字符级红绿对照行 —— 给润色（同语种小幅修改）用 */
function WordDiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const segments = useMemo(() => diffWords(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const s of segments) {
      if (s.added) added += s.value.length;
      else if (s.removed) removed += s.value.length;
    }
    return { added, removed };
  }, [segments]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <span className="text-[var(--signal-success)]">+{stats.added} 字符</span>
        <span className="text-[var(--signal-danger)]">−{stats.removed} 字符</span>
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-4 text-[13px] leading-7 whitespace-pre-wrap break-words max-h-[55vh] overflow-y-auto">
        {segments.map((seg, i) => {
          if (seg.added) {
            return (
              <span
                key={i}
                className="bg-[color-mix(in_oklch,var(--signal-success)_18%,transparent)] text-[var(--signal-success)] rounded px-0.5"
              >
                {seg.value}
              </span>
            );
          }
          if (seg.removed) {
            return (
              <span
                key={i}
                className="bg-[color-mix(in_oklch,var(--signal-danger)_16%,transparent)] text-[var(--signal-danger)] rounded px-0.5 line-through opacity-80"
              >
                {seg.value}
              </span>
            );
          }
          return <span key={i}>{seg.value}</span>;
        })}
      </div>
    </div>
  );
}

/** 翻译用的 split-view —— 跨语言无法逐字 diff，只做并排展示 */
function SplitView({
  leftLabel,
  rightLabel,
  leftContent,
  rightContent,
  previewTheme,
  rightBadge,
}: {
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
  previewTheme: 'light' | 'dark';
  rightBadge?: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[55vh] overflow-hidden">
      {[
        { label: leftLabel, content: leftContent, badge: undefined as string | undefined },
        { label: rightLabel, content: rightContent, badge: rightBadge },
      ].map(({ label, content, badge }, idx) => (
        <div
          key={idx}
          className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/60">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</span>
            {badge && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-1.5 py-0.5 rounded bg-[var(--bg-card)]">
                {badge}
              </span>
            )}
          </div>
          <div className="p-3 overflow-y-auto flex-1">
            <MarkdownPreview
              content={content || '_（空）_'}
              className="bg-transparent border-none p-0"
              theme={previewTheme}
              style={{ fontSize: '13px', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ApplyPreviewModal({
  isOpen,
  tool,
  mode,
  currentContent,
  nextContent,
  targetLanguage,
  previewTheme,
  onConfirm,
  onCancel,
}: ApplyPreviewModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const meta = toolMeta[tool];
  const Icon = meta.icon;

  // outline append 模式预览的"应用后整篇"
  const outlineMerged = useMemo(() => {
    if (tool !== 'outline' || mode !== 'append') return '';
    if (currentContent.trim().length === 0) return nextContent;
    return `${currentContent.replace(/\s+$/, '')}\n\n${nextContent}`;
  }, [tool, mode, currentContent, nextContent]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  const renderBody = () => {
    if (tool === 'polish') {
      return <WordDiffView oldText={currentContent} newText={nextContent} />;
    }
    if (tool === 'translate') {
      return (
        <SplitView
          leftLabel="原文"
          rightLabel="译文"
          leftContent={currentContent}
          rightContent={nextContent}
          previewTheme={previewTheme}
          rightBadge={targetLanguage ? targetLanguage.toUpperCase() : undefined}
        />
      );
    }
    // 大纲
    if (mode === 'append') {
      return (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            应用后整篇文章预览（追加在末尾）
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-4 max-h-[55vh] overflow-y-auto">
            <MarkdownPreview
              content={outlineMerged || '_（空）_'}
              className="bg-transparent border-none p-0"
              theme={previewTheme}
              style={{ fontSize: '14px', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
      );
    }
    // 轮廓替换
    return (
      <SplitView
        leftLabel="当前正文"
        rightLabel="替换为大纲"
        leftContent={currentContent}
        rightContent={nextContent}
        previewTheme={previewTheme}
      />
    );
  };

  // stats 行：字符数变化（追加模式 = 净新增；替换模式 = 总长变化）
  const charDelta =
    mode === 'append' && tool === 'outline'
      ? `+${nextContent.length}`
      : `${currentContent.length} → ${nextContent.length}`;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="full" title={meta.title}>
      <div className="flex flex-col gap-4">
        {/* 顶部 stats —— 一眼判断"动了多少" */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          <Icon className="w-3.5 h-3.5" />
          <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            {mode === 'replace' ? '替换' : '追加'}
          </span>
          <span>字符 {charDelta}</span>
        </div>

        {renderBody()}

        {/* 操作 */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] text-sm font-medium border border-[var(--border-subtle)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all',
              'bg-primary text-white hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {submitting ? '应用中...' : meta.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ApplyPreviewModal;
