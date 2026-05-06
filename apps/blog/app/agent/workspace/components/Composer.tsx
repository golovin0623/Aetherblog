'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ArrowUp,
  AtSign,
  Hash,
  SlashSquare,
  Square,
  Mic,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import ArticlePicker from './ArticlePicker';
import TagPicker from './TagPicker';
import SlashCommandPicker from './SlashCommandPicker';
import type { AgentArticle, AgentTag, SlashCommand } from '../../lib/agentResources';

type PickerKey = 'article' | 'tag' | 'slash' | null;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAbort?: () => void;
  busy: boolean;
  placeholder?: string;
  /** 移动端键盘弹起时的额外底边补偿。 */
  bottomSafeArea?: boolean;
  /** 在工具按钮前面渲染的额外槽位（典型：ModelPicker）。 */
  leadingSlot?: React.ReactNode;

  /** 当前会话已选中的文章 / 标签，用于在 picker 行高亮显示已选项 */
  selectedArticles?: AgentArticle[];
  selectedTags?: AgentTag[];
  onPickArticle?: (article: AgentArticle) => void;
  onPickTag?: (tag: AgentTag) => void;
  onSlashCommand?: (cmd: SlashCommand) => void;
  /** 用户从 mentions chip 上点 X 移除引用 */
  onRemoveArticle?: (id: number) => void;
  onRemoveTag?: (slug: string) => void;
}

/** Composer 暴露的命令式 API。 */
export interface ComposerHandle {
  focus: () => void;
  insert: (text: string) => void;
}

const MIN_HEIGHT = 48;
const DEFAULT_MAX = 220;
const EXPANDED_MAX = 480;

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    value,
    onChange,
    onSubmit,
    onAbort,
    busy,
    placeholder,
    bottomSafeArea = true,
    leadingSlot,
    selectedArticles = [],
    selectedTags = [],
    onPickArticle,
    onPickTag,
    onSlashCommand,
    onRemoveArticle,
    onRemoveTag,
  },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<PickerKey>(null);

  const atBtnRef = useRef<HTMLButtonElement>(null);
  const hashBtnRef = useRef<HTMLButtonElement>(null);
  const slashBtnRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insert: (text: string) => insertChar(text),
  }));

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const max = expanded ? EXPANDED_MAX : DEFAULT_MAX;
    el.style.height = 'auto';
    el.style.height = `${Math.max(MIN_HEIGHT, Math.min(el.scrollHeight, max))}px`;
  }, [value, expanded]);

  function insertChar(text: string) {
    const el = taRef.current;
    if (!el) {
      onChange((value ?? '') + text);
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) return;
      e.preventDefault();
      if (!busy && value.trim()) onSubmit();
    }
  };

  const togglePicker = (k: Exclude<PickerKey, null>) => {
    setPicker((curr) => (curr === k ? null : k));
  };

  const selectedArticleIds = new Set(selectedArticles.map((a) => a.id));
  const selectedTagSlugs = new Set(selectedTags.map((t) => t.slug));

  const canSend = !!value.trim() && !busy;
  const max = expanded ? EXPANDED_MAX : DEFAULT_MAX;

  return (
    <div className="relative">
      {/* mentions 区 —— 选中的文章 / 标签以 chip 形式显示在 composer 上方 */}
      {(selectedArticles.length > 0 || selectedTags.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="已引用">
          {selectedArticles.map((a) => (
            <span
              key={`art-${a.id}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] text-[11.5px] text-[var(--aurora-1)] max-w-[14rem]"
            >
              <span aria-hidden="true">@</span>
              <span className="truncate" title={a.title}>{a.title}</span>
              {onRemoveArticle && (
                <button
                  type="button"
                  onClick={() => onRemoveArticle(a.id)}
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)]"
                  aria-label={`移除引用 ${a.title}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          ))}
          {selectedTags.map((t) => (
            <span
              key={`tag-${t.slug}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/22 text-[11.5px] text-[var(--ink-secondary)]"
            >
              <span aria-hidden="true">#</span>
              <span className="truncate max-w-[8rem]" title={t.name}>{t.name}</span>
              {onRemoveTag && (
                <button
                  type="button"
                  onClick={() => onRemoveTag(t.slug)}
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]"
                  aria-label={`移除标签 ${t.name}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        className={[
          'group/composer rounded-2xl px-3 pt-3 pb-2',
          'transition-[box-shadow,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'bg-[var(--bg-leaf)] backdrop-blur-xl',
          'border',
          focused
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] shadow-[0_10px_32px_-12px_color-mix(in_oklch,var(--aurora-1)_50%,transparent),0_0_0_4px_color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            : 'border-[var(--ink-subtle)]/22 shadow-[0_4px_16px_-10px_rgba(0,0,0,0.18)]',
        ].join(' ')}
        style={bottomSafeArea ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={1}
          aria-label="消息输入框"
          placeholder={placeholder ?? '提问、创建或开始任务。@ 引用文章 · / 调用命令'}
          className="agent-composer-textarea w-full bg-transparent outline-none resize-none text-[14.5px] text-[var(--ink-primary)] placeholder-[var(--ink-muted)]/65 leading-[1.55]"
          style={{ maxHeight: `${max}px` }}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[var(--ink-muted)] min-w-0">
            {leadingSlot && (
              <>
                <div className="flex-shrink-0">{leadingSlot}</div>
                <span aria-hidden="true" className="hidden sm:inline-block w-px h-4 bg-[var(--ink-subtle)]/22 mx-1" />
              </>
            )}
            <ToolButton
              ref={atBtnRef}
              title="引用文章"
              active={picker === 'article'}
              onClick={() => (onPickArticle ? togglePicker('article') : insertChar('@'))}
            >
              <AtSign className="w-3.5 h-3.5" />
            </ToolButton>
            <ToolButton
              ref={hashBtnRef}
              title="按标签筛选"
              active={picker === 'tag'}
              onClick={() => (onPickTag ? togglePicker('tag') : insertChar('#'))}
            >
              <Hash className="w-3.5 h-3.5" />
            </ToolButton>
            <ToolButton
              ref={slashBtnRef}
              title="斜杠命令"
              active={picker === 'slash'}
              onClick={() => (onSlashCommand ? togglePicker('slash') : insertChar('/'))}
            >
              <SlashSquare className="w-3.5 h-3.5" />
            </ToolButton>
            {/* 语音输入暂为占位 —— 移动端横向空间紧张时优先让出给主要工具
                （@ # /），桌面端继续暴露占位以维持视觉提示功能。 */}
            <ToolButton title="语音输入（待接入）" disabled mobileHidden>
              <Mic className="w-3.5 h-3.5" />
            </ToolButton>
            <span className="hidden lg:inline ml-1.5 font-mono text-[10px] uppercase tracking-[0.22em] truncate">
              Enter 发送 · Shift+Enter 换行
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起输入框' : '展开输入框'}
              aria-label={expanded ? '收起输入框' : '展开输入框'}
              className="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            {busy ? (
              <button
                type="button"
                onClick={onAbort}
                aria-label="停止生成"
                className="group/stop relative inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] transition-all text-[12px] font-medium active:scale-95"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl pointer-events-none"
                  style={{ animation: 'breath-soft 2.4s ease-in-out infinite' }}
                />
                <Square className="w-3 h-3 fill-current" />
                停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="发送"
                className={[
                  'relative inline-flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200',
                  canSend
                    ? 'bg-[var(--aurora-1)] text-white shadow-[0_6px_18px_-6px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)] hover:brightness-110 hover:shadow-[0_10px_24px_-6px_color-mix(in_oklch,var(--aurora-1)_70%,transparent)] hover:-translate-y-px active:translate-y-0 active:scale-95'
                    : 'bg-[var(--ink-subtle)]/25 text-[var(--ink-muted)] cursor-not-allowed border border-[var(--ink-subtle)]/30',
                ].join(' ')}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Picker 弹层 —— 锚到对应的 ToolButton */}
        {onPickArticle && (
          <ArticlePicker
            open={picker === 'article'}
            onClose={() => setPicker(null)}
            anchorRef={atBtnRef}
            selectedIds={selectedArticleIds}
            onPick={(a) => {
              onPickArticle(a);
              // 选中后保持弹层打开，方便连续选多篇；用户点击外部 / Esc / 再次点 @ 关闭
            }}
          />
        )}
        {onPickTag && (
          <TagPicker
            open={picker === 'tag'}
            onClose={() => setPicker(null)}
            anchorRef={hashBtnRef}
            selectedSlugs={selectedTagSlugs}
            onPick={(t) => {
              onPickTag(t);
            }}
          />
        )}
        {onSlashCommand && (
          <SlashCommandPicker
            open={picker === 'slash'}
            onClose={() => setPicker(null)}
            anchorRef={slashBtnRef}
            onPick={(cmd) => {
              onSlashCommand(cmd);
              setPicker(null);
            }}
          />
        )}
      </form>
    </div>
  );
});

interface ToolButtonProps {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  /** mobileHidden=true 时移动端隐藏，仅 ≥md 渲染。用于次要工具（如语音占位）
   *  腾出移动端单手操作的横向空间。 */
  mobileHidden?: boolean;
}

const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { children, title, disabled, active, onClick, mobileHidden },
  ref,
) {
  // 触控区：移动端 36×36（HIG 推荐 44，单手操作密集排列下选 36 平衡密度）；
  // 桌面 28×28（hover-friendly 紧凑形态）。
  const sizeClass = mobileHidden
    ? 'hidden md:inline-flex w-7 h-7'
    : 'inline-flex w-9 h-9 md:w-7 md:h-7';
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`${sizeClass} items-center justify-center rounded-lg transition-all duration-200 ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)] active:scale-95'
          : 'hover:bg-[var(--bg-raised)] hover:text-[var(--aurora-1)] active:scale-95'
      }`}
    >
      {children}
    </button>
  );
});

export default Composer;
