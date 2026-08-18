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
  BookDashed,
  BookMarked,
  Hash,
  Scissors,
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
import KnowledgePicker from './KnowledgePicker';
import type { AgentArticle, AgentTag, SlashCommand } from '../../lib/agentResources';
import type { AgentKbRef, AgentKnowledgeBase } from '../../lib/agentKbs';
import { formatTokenCount, type KnowledgeContextMode } from '@aetherblog/agent-kit';
import { SEND_SHORTCUT_OPTIONS, useSendShortcut } from '../../lib/sendShortcut';

type PickerKey = 'article' | 'tag' | 'slash' | 'kb' | null;

/** 上下文用量摘要 —— 由 WorkspaceClient 估算后传入。 */
export interface ComposerContextStats {
  /** 将随下一轮请求发送的历史消息条数（不含正在输入的草稿）。 */
  messages: number;
  /** 历史 + 草稿的 token 估算。 */
  tokens: number;
  /** 当前模型的上下文窗口（未知为 null）。 */
  window?: number | null;
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

  /** 知识检索三态（auto/selected/none）+ 已选知识库。提供 onKnowledgeModeChange
   *  即视为启用知识 picker 按钮。 */
  knowledgeMode?: KnowledgeContextMode;
  selectedKbs?: AgentKbRef[];
  onKnowledgeModeChange?: (mode: KnowledgeContextMode) => void;
  onToggleKb?: (kb: AgentKnowledgeBase) => void;
  onRemoveKb?: (id: number) => void;

  /** 上下文用量摘要（null 时不渲染计量）。 */
  contextStats?: ComposerContextStats | null;
  /** 「清除上下文」—— 保留消息但让模型从此重新开始记忆。 */
  onClearContext?: () => void;
  canClearContext?: boolean;
}

/** Composer 暴露的命令式 API。 */
export interface ComposerHandle {
  focus: () => void;
  insert: (text: string) => void;
}

const MIN_HEIGHT = 48;
const DEFAULT_MAX = 220;
const EXPANDED_MAX = 480;
// 与 Tailwind `md:`（min-width: 768px）互补：768px 必须判为桌面，
// 否则恰好 768px 时 chevron 可见但菜单被 isMobile 拦截、Enter 也不发送。
const MOBILE_QUERY = '(max-width: 767.98px)';

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
    knowledgeMode = 'auto',
    selectedKbs = [],
    onKnowledgeModeChange,
    onToggleKb,
    onRemoveKb,
    contextStats,
    onClearContext,
    canClearContext = false,
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
  const kbBtnRef = useRef<HTMLButtonElement>(null);
  // 发送方式偏好 —— 设置入口在顶栏「渲染偏好」面板,这里只消费。
  const [sendShortcut] = useSendShortcut();
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc 停止生成（ChatGPT 同款心智）—— 仅在没有弹层抢 Esc 语义时生效，
    // 否则用户想关 picker 却把回答停了。
    if (e.key === 'Escape' && busy && picker === null) {
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

  const selectedContextCount =
    selectedArticles.length + selectedTags.length + selectedKbs.length;
  const hasSelectedContext = selectedContextCount > 0;
  const trayScrollEnabled = selectedContextCount > 6;
  const selectedArticleIds = new Set(selectedArticles.map((a) => a.id));
  const selectedTagSlugs = new Set(selectedTags.map((t) => t.slug));
  const selectedKbIds = new Set(selectedKbs.map((k) => k.id));

  // 上下文用量：window 已知时给出占比，>80% 转 warn、>95% 转 danger。
  const ctxRatio =
    contextStats && contextStats.window && contextStats.window > 0
      ? Math.min(1, contextStats.tokens / contextStats.window)
      : null;
  const ctxToneClass =
    ctxRatio == null
      ? 'text-[var(--ink-muted)]'
      : ctxRatio > 0.95
      ? 'text-[var(--signal-danger)]'
      : ctxRatio > 0.8
      ? 'text-[var(--signal-warn)]'
      : 'text-[var(--ink-muted)]';
  const ctxBarClass =
    ctxRatio == null
      ? ''
      : ctxRatio > 0.95
      ? 'bg-[var(--signal-danger)]'
      : ctxRatio > 0.8
      ? 'bg-[var(--signal-warn)]'
      : 'bg-[color-mix(in_oklch,var(--aurora-3)_70%,transparent)]';
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
          'group/composer rounded-[26px] px-3 pt-3.5 pb-2 sm:rounded-[28px] sm:px-3.5',
          'transition-[box-shadow,border-color,background-color] duration-quick ease-aether',
          'bg-[var(--bg-raised)]',
          'border',
          // 聚焦光环走"发丝双描边"而非粗 ring —— 1px 极光外圈 + 柔和远投影,
          // 顶部再叠一线内高光,浮岛在两主题下都有玻璃器物的克制质感。
          focused
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_5%,transparent),0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_16%,transparent),0_16px_44px_-28px_color-mix(in_oklch,var(--aurora-1)_38%,transparent)]'
            : 'border-[var(--ink-subtle)]/15 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_4%,transparent),0_14px_36px_-30px_rgba(0,0,0,0.5)]',
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
        {onKnowledgeModeChange && onToggleKb && (
          <KnowledgePicker
            open={picker === 'kb'}
            onClose={() => setPicker(null)}
            anchorRef={kbBtnRef}
            mode={knowledgeMode}
            selectedIds={selectedKbIds}
            onModeChange={onKnowledgeModeChange}
            onToggleKb={onToggleKb}
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
                  {selectedKbs.map((kb) => (
                    <motion.span
                      layout
                      initial={{ opacity: 0, scale: 0.98, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, y: -4 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                      key={`kb-${kb.id}`}
                      className="group/chip inline-flex items-center gap-1.5 pl-2.5 pr-1 py-[3px] rounded-full text-[12px] leading-tight max-w-[min(15rem,calc(100vw-7rem))] transition-[box-shadow,border-color,background-color]"
                      style={{
                        background:
                          'linear-gradient(135deg, color-mix(in oklch, var(--aurora-2) 14%, transparent), color-mix(in oklch, var(--aurora-2) 8%, transparent))',
                        border: '1px solid color-mix(in oklch, var(--aurora-2) 36%, transparent)',
                        color: 'var(--aurora-2)',
                        boxShadow:
                          '0 1px 0 inset color-mix(in oklch, var(--aurora-2) 14%, transparent), 0 2px 6px -3px color-mix(in oklch, var(--aurora-2) 38%, transparent)',
                      }}
                    >
                      <BookMarked className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                      <span className="truncate font-medium tracking-tight" title={kb.name}>{kb.name}</span>
                      {onRemoveKb && (
                        <button
                          type="button"
                          onClick={() => onRemoveKb(kb.id)}
                          className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--aurora-2)]/75 hover:text-[var(--bg-void)] hover:bg-[var(--aurora-2)] transition-colors"
                          aria-label={`移除知识库 ${kb.name}`}
                        >
                          <X className="w-3 h-3" strokeWidth={2.75} />
                        </button>
                      )}
                    </motion.span>
                  ))}
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
        {/* 工具行 —— 无硬分割线,以留白与克制的对齐完成分区(Claude / Codex 的
            安静浮岛语言;此前的 border-t 横贯整岛,是"表单感"最重的一笔)。 */}
        <div className="mt-1 grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:min-h-9">
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
              {onKnowledgeModeChange && (
                <ToolButton
                  ref={kbBtnRef}
                  title={
                    knowledgeMode === 'none'
                      ? '知识检索已关闭'
                      : selectedKbs.length
                      ? `指定 ${selectedKbs.length} 个知识库`
                      : '知识检索（自动）'
                  }
                  active={picker === 'kb' || knowledgeMode === 'selected'}
                  count={selectedKbs.length}
                  onClick={() => togglePicker('kb')}
                >
                  {knowledgeMode === 'none' ? (
                    <BookDashed className="w-3.5 h-3.5 opacity-70" />
                  ) : (
                    <BookMarked className="w-3.5 h-3.5" />
                  )}
                </ToolButton>
              )}
              <ToolButton
                ref={slashBtnRef}
                title="斜杠命令"
                active={picker === 'slash'}
                mobileHidden
                onClick={() => (onSlashCommand ? togglePicker('slash') : insertChar('/'))}
              >
                <SlashSquare className="w-3.5 h-3.5" />
              </ToolButton>
              {onClearContext && (
                <ToolButton
                  title={
                    canClearContext
                      ? '清除上下文（保留消息，模型从此重新开始记忆）'
                      : '当前没有可清除的上下文'
                  }
                  disabled={!canClearContext}
                  mobileHidden
                  onClick={onClearContext}
                >
                  <Scissors className="w-3.5 h-3.5" />
                </ToolButton>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5">
            {contextStats && contextStats.messages > 0 && (
              <div
                className={`mr-0.5 hidden select-none items-center gap-1.5 opacity-75 transition-opacity hover:opacity-100 md:flex ${ctxToneClass}`}
                title={`上下文：${contextStats.messages} 条消息 · ~${formatTokenCount(
                  contextStats.tokens,
                )} tokens${
                  contextStats.window
                    ? ` / 窗口 ${formatTokenCount(contextStats.window)}`
                    : ''
                }`}
                aria-label="上下文用量"
              >
                {ctxRatio != null && (
                  <span
                    aria-hidden="true"
                    className="h-[3px] w-6 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]"
                  >
                    <span
                      className={`block h-full rounded-full transition-[width] duration-300 ${ctxBarClass}`}
                      style={{ width: `${Math.max(3, Math.round(ctxRatio * 100))}%` }}
                    />
                  </span>
                )}
                <span className="font-mono text-[9.5px] tracking-[0.06em] tnum">
                  ~{formatTokenCount(contextStats.tokens)}
                </span>
              </div>
            )}
            <motion.button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起输入框' : '展开输入框'}
              aria-label={expanded ? '收起输入框' : '展开输入框'}
              whileTap={{ scale: 0.9 }}
              transition={spring.precise}
              className="hidden h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] sm:inline-flex"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </motion.button>

            {/* 发送 ⇄ 停止 —— 单一圆形主键(Claude / ChatGPT 语言),二态以
                弹簧缩放交接;不再有拼接式分裂按钮,发送方式设置移入顶栏
                「渲染偏好」。 */}
            {busy ? (
              <motion.button
                key="stop"
                type="button"
                onClick={onAbort}
                aria-label="停止生成"
                title="停止生成（Esc）"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileTap={{ scale: 0.92 }}
                transition={spring.precise}
                className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--signal-danger)_13%,transparent)] text-[var(--signal-danger)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--signal-danger)_32%,transparent)] transition-colors duration-quick ease-aether hover:bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] md:h-9 md:w-9"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    animation: 'breath-soft 2.4s ease-in-out infinite',
                    boxShadow: '0 0 18px color-mix(in oklch, var(--signal-danger) 30%, transparent)',
                  }}
                />
                <Square className="h-3 w-3 fill-current" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="submit"
                disabled={!canSend}
                aria-label="发送"
                title={isMobile ? '发送' : `发送 · ${activeShortcut.description}`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                // 仅可发送时给悬浮上抬与按压反馈;禁用态保持 inert(苹果级触感
                // 原则,gemini review #770)。
                whileHover={canSend ? { y: -1 } : undefined}
                whileTap={canSend ? { scale: 0.92 } : undefined}
                transition={spring.precise}
                className={[
                  'group/send inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                  'transition-[background-color,box-shadow,color,filter] duration-quick ease-aether md:h-9 md:w-9',
                  canSend
                    ? 'bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_26px_-12px_color-mix(in_oklch,var(--aurora-1)_80%,transparent)] hover:brightness-110'
                    : 'cursor-not-allowed bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-muted)]/75',
                ].join(' ')}
              >
                <ArrowUp
                  className="h-[18px] w-[18px] transition-transform duration-quick ease-aether group-hover/send:-translate-y-px md:h-4 md:w-4"
                  strokeWidth={2.2}
                />
              </motion.button>
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
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_28%,transparent)]'
          // 岛底就是 --bg-raised,此前 hover:bg-raised 悬浮完全不可见 ——
          // "按钮没反应"正是廉价感的来源之一。改 ink 淡染,悬浮即时可感。
          : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]'
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
