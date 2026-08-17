/**
 * AI 协同写作 · 对话面板(Aether Codex)
 *
 * 签名时刻 #5「AI 工坊 · Ink Bleed」的对话承载面:
 * - 真流式:delta / think SSE(useWritingChat → streamAgentChat)
 * - AI 回复用 Instrument Serif(--font-editorial)渲染 markdown,流式末尾墨水光标
 * - 思考流独立折叠面板,流式中自动展开
 * - 快捷指令 chips / 引用全文开关 / 复制 / 插入正文 / 重新生成 / 停止
 *
 * 布局职责:本组件只负责 h-full w-full 的内部布局;桌面侧栏宽度动画与
 * 移动端底抽屉由 AiWritingWorkspacePage 的容器控制。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Import,
  MessageSquare,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { MarkdownPreview } from '@aetherblog/editor';
import { transition, variants } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks';
import { normalizeCjkInlineMarkdown, useSmoothStream } from '@/services/agent';
import type {
  WritingChatApi,
  WritingChatDocument,
  WritingChatMessage,
} from '@/hooks/useWritingChat';

interface AiChatPanelProps {
  chat: WritingChatApi;
  document: WritingChatDocument;
  onInsertToEditor: (text: string) => void;
  onClose: () => void;
}

/** 空状态快捷指令 —— 全部默认携带全文上下文。 */
const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: '续写一段', prompt: '请顺着当前文脉,以相同的语气续写一段(120-200 字),直接给出可插入正文的内容。' },
  { label: '给出修改建议', prompt: '通读全文,指出三处最值得改进的地方,并各给出一句修改示范。' },
  { label: '拟三个标题', prompt: '为这篇文章拟 3 个更抓人的标题,并用一句话说明各自的取向。' },
  { label: '提炼大纲', prompt: '把全文提炼成层级化的 Markdown 大纲,保留关键论点。' },
];

const COMPOSER_MAX_HEIGHT = 160;

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
}

export function AiChatPanel({ chat, document: doc, onInsertToEditor, onClose }: AiChatPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [input, setInput] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [clearArmed, setClearArmed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const wordCount = useMemo(() => doc.content.replace(/\s+/g, '').length, [doc.content]);
  const lastMessage = chat.messages[chat.messages.length - 1];

  /**
   * 贴底跟随 —— 必须由**渲染尺寸**驱动,不能只随 chat.messages 触发。
   *
   * 实际 DOM 高度由子组件 useSmoothStream 的 rAF 循环增长(两次 delta 之间也在长),
   * 只监听原始消息会出现:(a) 流末尾一次性 flush 的内容落在视口外无人跟随;
   * (b) 平滑释放期间高度增量被误判成「用户上翻」而永久停跟。
   * 因此:用 scroll 事件维护 stickToBottom 意图,用 ResizeObserver 在每次高度
   * 变化时执行跟随。
   */
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateStick = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distance <= 120;
    };
    container.addEventListener('scroll', updateStick, { passive: true });

    const follow = () => {
      if (!stickToBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    if (contentRef.current) observer.observe(contentRef.current);
    observer.observe(container);
    follow();

    return () => {
      container.removeEventListener('scroll', updateStick);
      observer.disconnect();
    };
  }, []);

  // 新消息发出时无条件回到底部(用户自己发言即视为回到对话现场)
  useEffect(() => {
    if (lastMessage?.role !== 'user') return;
    stickToBottomRef.current = true;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [lastMessage?.id, lastMessage?.role]);

  // 仅桌面自动聚焦 —— 移动端底抽屉一打开就弹软键盘会把消息区挤没,
  // 用户往往只是想读上一轮回复。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 768px)').matches) return;
    textareaRef.current?.focus();
  }, []);

  // 清空按钮两段式确认 —— 3 秒不确认自动解除
  useEffect(() => {
    if (!clearArmed) return;
    const timer = window.setTimeout(() => setClearArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [clearArmed]);

  const sendOptions = { includeContext, document: doc };

  const handleSend = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || chat.isStreaming) return;
    chat.send(value, text ? { includeContext: true, document: doc } : sendOptions);
    // 高度复位只属于「清空了输入框」的路径 —— 快捷指令不动用户已写的草稿,
    // 此时重置高度会把多行草稿折叠成单行(受控 value 仍在,视觉却溢出隐藏)
    if (!text) {
      setInput('');
      requestAnimationFrame(() => {
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  };

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-substrate)]">
      {/* ── 头部 ── */}
      <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-[var(--aurora-1)] flex-shrink-0" />
          <h3 className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.18em] text-[var(--ink-muted)] truncate">
            AI 对话
          </h3>
          {chat.isStreaming && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--aurora-1)] animate-pulse flex-shrink-0"
              aria-label="AI 正在回复"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {chat.messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (clearArmed) {
                  chat.clear();
                  setClearArmed(false);
                } else {
                  setClearArmed(true);
                }
              }}
              className={cn(
                'inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-lg transition-colors',
                clearArmed
                  ? 'px-2 gap-1 !w-auto font-mono text-[var(--fs-micro)] text-[var(--signal-danger)] bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)]'
                  : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]'
              )}
              aria-label={clearArmed ? '再次点击确认清空对话' : '清空对话'}
              title={clearArmed ? '再次点击确认清空' : '清空对话'}
            >
              <Trash2 className="w-4 h-4" />
              {clearArmed && '确认清空?'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-lg text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
            aria-label="关闭 AI 对话"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 屏幕阅读器播报 —— 只在回复完成时播报一次。
          把整个消息流挂 role=log/aria-live 会让 rAF 逐帧变异的流式文本刷爆
          live region(每秒最多 60 次重排队),读屏输出连续碎片噪音。 */}
      <p className="sr-only" role="status" aria-live="polite">
        {chat.isStreaming ? 'AI 正在回复' : lastMessage?.role === 'assistant' && lastMessage.content ? 'AI 已回复' : ''}
      </p>

      {/* ── 消息区 ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div ref={contentRef} className="min-h-full">
          {chat.messages.length === 0 ? (
            <EmptyState onPick={(prompt) => handleSend(prompt)} hasContent={wordCount > 0} />
          ) : (
            <div className="space-y-5">
              {chat.messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage key={message.id} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isDark={isDark}
                    isLast={index === chat.messages.length - 1}
                    canRetry={!chat.isStreaming}
                    onRetry={() => chat.retry(sendOptions)}
                    onInsert={onInsertToEditor}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 输入区 ── */}
      <div className="px-3 pb-3 pt-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] flex-shrink-0">
        <div
          className={cn(
            'rounded-2xl border transition-colors',
            'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
            'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]',
            'focus-within:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="问问 AI…(⏎ 发送 · ⇧⏎ 换行)"
            rows={1}
            className={cn(
              'block w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5',
              'text-[var(--fs-body)] leading-[var(--lh-normal)] text-[var(--ink-primary)]',
              'placeholder:text-[var(--ink-subtle)] focus:outline-none'
            )}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <button
              type="button"
              onClick={() => setIncludeContext((v) => !v)}
              aria-pressed={includeContext}
              title={includeContext ? '本轮携带全文上下文' : '本轮不携带全文'}
              className={cn(
                'inline-flex items-center gap-1.5 min-h-11 md:min-h-0 h-11 md:h-7 px-2.5 rounded-full font-mono text-[var(--fs-micro)] tracking-[0.08em] transition-colors',
                includeContext
                  ? 'bg-[color-mix(in_oklch,var(--aurora-1)_13%,transparent)] text-[var(--aurora-1)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]'
              )}
            >
              <FileText className="w-3 h-3" />
              全文 · {formatCount(wordCount)} 字
            </button>
            {chat.isStreaming ? (
              <button
                type="button"
                onClick={chat.stop}
                className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-full border border-[color-mix(in_oklch,var(--signal-danger)_40%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] transition-colors"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-full bg-[var(--ink-primary)] text-[var(--bg-void)] disabled:opacity-30 transition-opacity"
                aria-label="发送"
                title="发送 (⏎)"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 空状态 ====================

function EmptyState({ onPick, hasContent }: { onPick: (prompt: string) => void; hasContent: boolean }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-2 text-center">
      <div className="space-y-2">
        <p className="font-editorial italic text-[var(--fs-lede)] leading-[var(--lh-snug)] text-[var(--ink-secondary)]">
          让 AI 参与你的下一段思考。
        </p>
        <p className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.18em] text-[var(--ink-subtle)]">
          {hasContent ? '默认携带全文上下文' : '正文为空 · 先写点什么'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {QUICK_PROMPTS.map((item, index) => (
          <motion.button
            key={item.label}
            type="button"
            variants={prefersReducedMotion ? variants.fade : variants.fadeUp}
            initial="initial"
            animate="animate"
            transition={
              prefersReducedMotion ? { duration: 0 } : { ...transition.quick, delay: index * 0.05 }
            }
            onClick={() => onPick(item.prompt)}
            className={cn(
              'min-h-11 md:min-h-0 h-11 md:h-8 px-3.5 rounded-full text-[var(--fs-caption)] text-[var(--ink-secondary)] transition-colors',
              'border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]',
              'hover:border-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)]',
              'hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            )}
          >
            {item.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ==================== 用户消息 ====================

function UserMessage({ message }: { message: WritingChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] px-3.5 py-2.5">
        <p className="text-[var(--fs-body)] leading-[var(--lh-normal)] text-[var(--ink-primary)] whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
      <div className="flex items-center gap-1.5 pr-1 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
        {message.withContext && (
          <span className="inline-flex items-center gap-0.5">
            <FileText className="w-2.5 h-2.5" />
            含全文
          </span>
        )}
        <span>{formatClock(message.createdAt)}</span>
      </div>
    </div>
  );
}

// ==================== AI 消息 ====================

function AssistantMessage({
  message,
  isDark,
  isLast,
  canRetry,
  onRetry,
  onInsert,
}: {
  message: WritingChatMessage;
  isDark: boolean;
  isLast: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onInsert: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const pending = !!message.pending;
  // 平滑吐字:SSE 的突发 delta 均匀释放,配合 ink-bleed 的"纸面浮起"体感
  const smoothed = useSmoothStream(message.content, pending, 'fade');
  const renderable = useMemo(() => normalizeCjkInlineMarkdown(smoothed), [smoothed]);
  const hasThink = !!message.think?.trim();
  const showTyping = pending && !message.content && !hasThink;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    onInsert(message.content);
    setInserted(true);
    window.setTimeout(() => setInserted(false), 2000);
  };

  return (
    <div className="group">
      {hasThink && <WritingThinkPanel think={message.think ?? ''} streaming={pending && !message.content} />}

      {showTyping ? (
        <TypingDots />
      ) : (
        <div className={cn('writing-stream-fade', pending && message.content && 'writing-stream-caret')}>
          {message.content && (
            <MarkdownPreview
              content={renderable}
              theme={isDark ? 'dark' : 'light'}
              className="writing-chat-md"
            />
          )}
        </div>
      )}

      {message.error && (
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[var(--fs-micro)] tracking-[0.06em] text-[var(--signal-danger)]">
            ERROR · {message.error}
          </span>
          {isLast && canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 min-h-11 md:min-h-0 md:h-6 px-2 rounded-md font-mono text-[var(--fs-micro)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          )}
        </div>
      )}

      {!pending && message.content && (
        <div className="mt-1.5 flex items-center gap-0.5 opacity-60 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <MessageActionButton
            onClick={handleCopy}
            label={copied ? '已复制' : '复制'}
            icon={copied ? <Check className="w-3.5 h-3.5 text-[var(--signal-success)]" /> : <Copy className="w-3.5 h-3.5" />}
          />
          <MessageActionButton
            onClick={handleInsert}
            label={inserted ? '已插入' : '插入正文'}
            icon={inserted ? <Check className="w-3.5 h-3.5 text-[var(--signal-success)]" /> : <Import className="w-3.5 h-3.5" />}
          />
          {isLast && canRetry && (
            <MessageActionButton onClick={onRetry} label="重新生成" icon={<RefreshCw className="w-3.5 h-3.5" />} />
          )}
        </div>
      )}
    </div>
  );
}

function MessageActionButton({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 min-h-11 md:min-h-0 md:h-7 px-2.5 md:px-2 rounded-md font-mono text-[var(--fs-micro)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

// ==================== 思考面板 ====================

function WritingThinkPanel({ think, streaming }: { think: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const userToggledRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // 流式中自动展开;结束后若用户未手动干预,自动收起
  useEffect(() => {
    if (userToggledRef.current) return;
    setOpen(streaming);
  }, [streaming]);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex items-center gap-2 min-h-11 md:min-h-0 md:h-7 px-2 -ml-2 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            streaming
              ? 'bg-[var(--aurora-1)] animate-pulse'
              : 'bg-[color-mix(in_oklch,var(--ink-primary)_25%,transparent)]'
          )}
        />
        <span className="font-mono text-[var(--fs-micro)] uppercase tracking-[0.16em]">
          {streaming ? '思考中' : '思考过程'}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
          {formatCount(think.length)}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : transition.quick}
            className="overflow-hidden"
          >
            <div className="mt-1 max-h-48 overflow-y-auto border-l-2 border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] pl-3 pr-1">
              <p className="font-mono text-[var(--fs-caption)] leading-[var(--lh-normal)] text-[var(--ink-muted)] whitespace-pre-wrap break-words">
                {think}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 思考占位(骨架呼吸点,非 spinner) ====================

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2" role="status" aria-label="AI 正在思考">
      {[0, 1, 2].map((i) => (
        <span key={i} className="writing-typing-dot" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}
