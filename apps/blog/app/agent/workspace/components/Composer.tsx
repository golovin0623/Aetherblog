'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { spring } from '@aetherblog/ui';
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  CornerDownLeft,
  Hash,
  SlidersHorizontal,
  SlashSquare,
  Square,
  Maximize2,
  Minimize2,
  X,
  FileText,
} from 'lucide-react';
import ArticlePicker from './ArticlePicker';
import TagPicker from './TagPicker';
import SlashCommandPicker from './SlashCommandPicker';
import type { AgentArticle, AgentTag, SlashCommand } from '../../lib/agentResources';

type PickerKey = 'article' | 'tag' | 'slash' | null;
type SendShortcut = 'enter' | 'mod-enter';

const SEND_SHORTCUT_STORAGE_KEY = 'aetherblog.blog.agent.sendShortcut';
const SEND_SHORTCUT_OPTIONS: Array<{
  value: SendShortcut;
  label: string;
  keys: string;
  description: string;
}> = [
  {
    value: 'enter',
    label: '按 Enter 发送',
    keys: '↵',
    description: 'Shift + Enter 保持换行',
  },
  {
    value: 'mod-enter',
    label: '按 ⌘ / Ctrl + Enter 发送',
    keys: '⌘ ↵',
    description: 'Enter 直接换行',
  },
];

function readSendShortcut(): SendShortcut {
  if (typeof window === 'undefined') return 'enter';
  const stored = window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY);
  return stored === 'mod-enter' ? 'mod-enter' : 'enter';
}

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
const MOBILE_QUERY = '(max-width: 768px)';

function useComposerMobileMode(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

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
  const chipTrayRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<PickerKey>(null);

  const atBtnRef = useRef<HTMLButtonElement>(null);
  const hashBtnRef = useRef<HTMLButtonElement>(null);
  const slashBtnRef = useRef<HTMLButtonElement>(null);
  const sendMenuRef = useRef<HTMLDivElement>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [sendShortcut, setSendShortcut] = useState<SendShortcut>(() => readSendShortcut());
  const isMobile = useComposerMobileMode();

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insert: (text: string) => insertChar(text),
  }));

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const max = expanded ? EXPANDED_MAX : DEFAULT_MAX;
    el.style.height = 'auto';
    const fitted = Math.max(MIN_HEIGHT, Math.min(el.scrollHeight, max));
    el.style.height = `${fitted}px`;
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, sendShortcut);
  }, [sendShortcut]);

  useEffect(() => {
    if (!sendMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!sendMenuRef.current) return;
      if (!sendMenuRef.current.contains(e.target as Node)) setSendMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSendMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [sendMenuOpen]);

  useEffect(() => {
    if (busy) setSendMenuOpen(false);
  }, [busy]);

  useEffect(() => {
    if (isMobile) setSendMenuOpen(false);
  }, [isMobile]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc 停止生成（ChatGPT 同款心智）—— 仅在没有弹层抢 Esc 语义时生效，
    // 否则用户想关 picker 却把回答停了。
    if (e.key === 'Escape' && busy && picker === null && !sendMenuOpen) {
      e.preventDefault();
      onAbort?.();
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (isMobile) return;
    const shouldSubmit =
      sendShortcut === 'enter'
        ? !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
        : (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;

    if (shouldSubmit) {
      e.preventDefault();
      if (!busy && value.trim()) onSubmit();
    }
  };

  const togglePicker = (k: Exclude<PickerKey, null>) => {
    setPicker((curr) => (curr === k ? null : k));
  };

  const selectedContextCount = selectedArticles.length + selectedTags.length;
  const hasSelectedContext = selectedContextCount > 0;
  const trayScrollEnabled = selectedContextCount > 6;
  const selectedArticleIds = new Set(selectedArticles.map((a) => a.id));
  const selectedTagSlugs = new Set(selectedTags.map((t) => t.slug));
  const activeShortcut =
    SEND_SHORTCUT_OPTIONS.find((option) => option.value === sendShortcut) ??
    SEND_SHORTCUT_OPTIONS[0];

  useEffect(() => {
    const el = chipTrayRef.current;
    if (!el || selectedContextCount === 0 || !trayScrollEnabled) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollToBottom = (behavior: ScrollBehavior) => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    };
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(reduceMotion ? 'auto' : 'smooth');
    });
    const settle = window.setTimeout(() => {
      scrollToBottom('auto');
    }, 280);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [selectedContextCount, trayScrollEnabled]);

  const canSend = !!value.trim() && !busy;

  return (
    <div className="relative">
      <motion.form
        layout
        transition={{ layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] } }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        className={[
          'group/composer rounded-[26px] px-3 pt-3.5 pb-2.5 sm:rounded-[28px] sm:px-3.5',
          'transition-[box-shadow,border-color,background-color] duration-quick ease-aether',
          'bg-[var(--bg-raised)]',
          'border',
          focused
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)] shadow-[0_18px_46px_-26px_color-mix(in_oklch,var(--aurora-1)_42%,transparent),0_0_0_3.5px_color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            : 'border-[var(--ink-subtle)]/16 shadow-[0_12px_34px_-28px_rgba(0,0,0,0.42)]',
        ].join(' ')}
        style={bottomSafeArea ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}
      >
        {/* 移动端把 picker 作为输入框内部面板渲染，避免浮层盖住对话内容；
            桌面端仍由 PickerPopover 走 absolute top-start，不改变 PC 体验。 */}
        {onPickArticle && (
          <ArticlePicker
            open={picker === 'article'}
            onClose={() => setPicker(null)}
            anchorRef={atBtnRef}
            selectedIds={selectedArticleIds}
            onPick={onPickArticle}
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
              setPicker(null);
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

        {/* mentions 区 —— 选中的文章 / 标签作为胶囊显示在 textarea 上方,
            包在同一个 form 容器内,视觉上与 textarea 一体。Codex/ChatGPT 风格:
            rounded-full 极致胶囊,精致图标 + 文字 + 点击 ✕ 同步清掉 pending +
            draft 残留 token。 */}
        <AnimatePresence initial={false}>
          {hasSelectedContext && (
            <motion.div
              key="selected-context-tray"
              layout
              initial={{ opacity: 0, scale: 0.985, y: 8, filter: 'blur(2px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.985, y: -4, filter: 'blur(2px)' }}
              transition={{
                layout: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
                opacity: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
                scale: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
                y: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
                filter: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
              }}
              className="mb-2 overflow-visible pt-1"
            >
              <motion.div
                ref={chipTrayRef}
                layout
                className={`agent-thumb-scroll flex max-h-[120px] flex-wrap items-center gap-1.5 overflow-x-hidden px-2 py-1.5 ${
                  trayScrollEnabled ? 'overflow-y-auto overscroll-contain' : 'overflow-visible'
                }`}
                aria-label="已引用上下文"
                style={{
                  scrollbarGutter: 'stable',
                }}
              >
                <AnimatePresence initial={false}>
                  {selectedArticles.map((a) => (
                    <motion.span
                      layout
                      initial={{ opacity: 0, scale: 0.98, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, y: -4 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                      key={`art-${a.id}`}
                      className="group/chip inline-flex items-center gap-1.5 pl-2.5 pr-1 py-[3px] rounded-full text-[12px] leading-tight max-w-[min(15rem,calc(100vw-7rem))] transition-[box-shadow,border-color,background-color]"
                      style={{
                        background:
                          'linear-gradient(135deg, color-mix(in oklch, var(--aurora-1) 14%, transparent), color-mix(in oklch, var(--aurora-1) 8%, transparent))',
                        border: '1px solid color-mix(in oklch, var(--aurora-1) 36%, transparent)',
                        color: 'var(--aurora-1)',
                        boxShadow:
                          '0 1px 0 inset color-mix(in oklch, var(--aurora-1) 14%, transparent), 0 2px 6px -3px color-mix(in oklch, var(--aurora-1) 38%, transparent)',
                      }}
                    >
                      <FileText className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                      <span className="truncate font-medium tracking-tight" title={a.title}>{a.title}</span>
                      {onRemoveArticle && (
                        <button
                          type="button"
                          onClick={() => onRemoveArticle(a.id)}
                          className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--aurora-1)]/75 hover:text-[var(--bg-void)] hover:bg-[var(--aurora-1)] transition-colors"
                          aria-label={`移除引用 ${a.title}`}
                        >
                          <X className="w-3 h-3" strokeWidth={2.75} />
                        </button>
                      )}
                    </motion.span>
                  ))}
                  {selectedTags.map((t) => (
                    <motion.span
                      layout
                      initial={{ opacity: 0, scale: 0.98, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, y: -4 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                      key={`tag-${t.slug}`}
                      className="group/chip inline-flex items-center gap-1.5 pl-2.5 pr-1 py-[3px] rounded-full text-[12px] leading-tight max-w-[min(12rem,calc(100vw-7rem))] bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/30 text-[var(--ink-primary)] shadow-[0_1px_0_inset_rgba(255,255,255,0.04),0_2px_6px_-3px_rgba(0,0,0,0.12)] transition-[box-shadow,border-color,background-color]"
                    >
                      <Hash className="w-3 h-3 shrink-0 text-[var(--ink-muted)]" strokeWidth={2.25} aria-hidden="true" />
                      <span className="truncate font-medium tracking-tight" title={t.name}>{t.name}</span>
                      {onRemoveTag && (
                        <button
                          type="button"
                          onClick={() => onRemoveTag(t.slug)}
                          className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-leaf)] transition-colors"
                          aria-label={`移除标签 ${t.name}`}
                        >
                          <X className="w-3 h-3" strokeWidth={2.75} />
                        </button>
                      )}
                    </motion.span>
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
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
          // resize-none：高度由 value 驱动的 autosize 接管（上方 useEffect），
          // 手动拖拽柄与 autosize 每次输入互相覆盖，体验是"拖了又弹回"。
          // 需要更大空间走右下 Maximize 展开按钮。
          className="agent-composer-textarea w-full resize-none bg-transparent px-1 outline-none text-[14.5px] leading-[1.6] text-[var(--ink-primary)] placeholder-[var(--ink-muted)]/62"
          style={{ minHeight: `${MIN_HEIGHT}px` }}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="mt-2 grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[var(--ink-subtle)]/10 pt-2 md:min-h-8">
          <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[var(--ink-muted)]">
            {leadingSlot && <div className="min-w-0 flex-1 sm:flex-none">{leadingSlot}</div>}
            <div className="flex shrink-0 items-center gap-0.5">
              <ToolButton
                ref={atBtnRef}
                title={selectedArticles.length ? `已引用 ${selectedArticles.length} 篇文章` : '引用文章'}
                active={picker === 'article' || selectedArticles.length > 0}
                count={selectedArticles.length}
                onClick={() => (onPickArticle ? togglePicker('article') : insertChar('@'))}
              >
                <AtSign className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton
                ref={hashBtnRef}
                title={selectedTags.length ? `已圈定 ${selectedTags.length} 个标签` : '按标签筛选'}
                active={picker === 'tag' || selectedTags.length > 0}
                count={selectedTags.length}
                onClick={() => (onPickTag ? togglePicker('tag') : insertChar('#'))}
              >
                <Hash className="w-3.5 h-3.5" />
              </ToolButton>
              <ToolButton
                ref={slashBtnRef}
                title="斜杠命令"
                active={picker === 'slash'}
                mobileHidden
                onClick={() => (onSlashCommand ? togglePicker('slash') : insertChar('/'))}
              >
                <SlashSquare className="w-3.5 h-3.5" />
              </ToolButton>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1">
            <motion.button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起输入框' : '展开输入框'}
              aria-label={expanded ? '收起输入框' : '展开输入框'}
              whileTap={{ scale: 0.88 }}
              transition={spring.precise}
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-leaf)] hover:text-[var(--ink-primary)]"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </motion.button>

            {busy ? (
              <motion.button
                type="button"
                onClick={onAbort}
                aria-label="停止生成"
                whileTap={{ scale: 0.96 }}
                transition={spring.precise}
                className="group/stop relative inline-flex h-11 items-center gap-1.5 rounded-full border border-transparent bg-[color-mix(in_oklch,var(--signal-danger)_16%,transparent)] px-4 text-[12px] font-medium text-[var(--signal-danger)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--signal-danger)_26%,transparent)_inset] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] md:h-8 md:px-3"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{ animation: 'breath-soft 2.4s ease-in-out infinite' }}
                />
                <Square className="w-3 h-3 fill-current" />
                停止
              </motion.button>
            ) : (
              <motion.div
                ref={sendMenuRef}
                // 仅可发送时才给按压反馈;禁用态保持 inert(苹果级触感原则,
                // gemini review #770)。
                whileTap={canSend ? { scale: 0.97 } : undefined}
                transition={spring.precise}
                className={[
                  'relative flex h-11 shrink-0 items-center rounded-full border transition-[background-color,border-color,box-shadow] duration-quick ease-aether md:h-8',
                  canSend
                    ? 'border-transparent bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_8px_20px_-10px_color-mix(in_oklch,var(--aurora-1)_72%,transparent)]'
                    : 'border-transparent bg-[var(--bg-leaf)] text-[var(--ink-muted)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--ink-subtle)_22%,transparent)_inset,0_1px_0_inset_color-mix(in_oklch,var(--ink-primary)_5%,transparent)]',
                ].join(' ')}
              >
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="发送"
                  title={isMobile ? '发送' : `发送（${activeShortcut.label}）`}
                  className={[
                    'relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-transparent transition-colors duration-quick ease-aether md:h-8 md:w-8 md:rounded-l-full md:rounded-r-none',
                    canSend
                      ? 'hover:bg-[color-mix(in_oklch,var(--bg-void)_12%,transparent)]'
                      : 'cursor-not-allowed opacity-58',
                  ].join(' ')}
                >
                  <ArrowUp className="h-4 w-4 md:h-3.5 md:w-3.5" />
                </button>
                <span
                  aria-hidden="true"
                  className={`hidden h-6 w-px md:block md:h-5 ${
                    canSend
                      ? 'bg-[color-mix(in_oklch,var(--bg-void)_28%,transparent)]'
                      : 'bg-[var(--ink-subtle)]/18'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setSendMenuOpen((open) => !open)}
                  aria-label="选择发送方式"
                  aria-haspopup="menu"
                  aria-expanded={sendMenuOpen}
                  title="选择发送方式"
                  className="hidden h-11 w-9 items-center justify-center rounded-r-full bg-transparent transition-colors duration-quick ease-aether hover:bg-[color-mix(in_oklch,currentColor_8%,transparent)] md:inline-flex md:h-8 md:w-8"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform md:h-3.5 md:w-3.5 ${sendMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {sendMenuOpen && !isMobile && (
                    <motion.div
                      role="menu"
                      aria-label="发送触发方式"
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute bottom-full right-0 z-50 mb-3 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--ink-subtle)]/18 bg-[var(--bg-raised)] p-2 shadow-[0_24px_48px_-18px_rgba(0,0,0,0.36)]"
                    >
                      <div className="flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>发送方式</span>
                      </div>
                      {SEND_SHORTCUT_OPTIONS.map((option) => {
                        const selected = option.value === sendShortcut;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => {
                              setSendShortcut(option.value);
                              setSendMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              selected
                                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                                : 'text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]'
                            }`}
                          >
                            <span className="inline-flex h-7 w-12 shrink-0 items-center justify-center gap-1 rounded-lg bg-[var(--bg-leaf)] font-mono text-[12px] text-[var(--ink-secondary)]">
                              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                              <span>{option.keys}</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-medium">{option.label}</span>
                              <span className="block text-[11px] text-[var(--ink-muted)]">
                                {option.description}
                              </span>
                            </span>
                            {selected && <Check className="h-4 w-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </div>

      </motion.form>
    </div>
  );
});

interface ToolButtonProps {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  active?: boolean;
  count?: number;
  onClick?: () => void;
  /** mobileHidden=true 时移动端隐藏，仅 ≥md 渲染。用于次要工具（如语音占位）
   *  腾出移动端单手操作的横向空间。 */
  mobileHidden?: boolean;
}

const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { children, title, disabled, active, count = 0, onClick, mobileHidden },
  ref,
) {
  // 移动端保持 44px 触控区；桌面收敛成 LobeHub 式紧凑圆形工具按钮。
  const sizeClass = mobileHidden
    ? 'hidden md:inline-flex md:h-8 md:w-8'
    : 'inline-flex h-11 w-11 md:h-8 md:w-8';
  return (
    <motion.button
      ref={ref}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-label={count > 0 ? `${title}，已选择 ${count} 项` : title}
      aria-pressed={active}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={spring.precise}
      className={`${sizeClass} relative shrink-0 items-center justify-center rounded-full transition-colors duration-quick ease-aether ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
        : active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)]'
          : 'hover:bg-[var(--bg-raised)] hover:text-[var(--aurora-1)]'
      }`}
    >
      {children}
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--aurora-1)] px-1 font-mono text-[9px] font-semibold leading-none text-[var(--bg-void)] shadow-[0_2px_8px_-3px_color-mix(in_oklch,var(--aurora-1)_70%,transparent)] md:-right-0.5 md:-top-0.5"
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </motion.button>
  );
});

export default Composer;
