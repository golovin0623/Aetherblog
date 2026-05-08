'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Sparkles, User, Copy, Check, Brain, Pencil, RefreshCcw } from 'lucide-react';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';
import StreamMarkdown from './StreamMarkdown';
import type { AgentMessage } from '../../lib/agentSessions';
import { normalizeCjkInlineMarkdown } from '../../lib/cjkMarkdown';
import { useSmoothStream, type StreamAnimationMode } from '../../lib/smooth';

/** 显示模式：bubble = 彩色卡片承载；engraved = 文字浮印纸面（版书）。 */
export type DisplayMode = 'bubble' | 'engraved';

interface Props {
  message: AgentMessage;
  /** 用户点击「编辑」—— 仅 user 消息可见；onEdit 把消息回填到 composer
   *  并截断该消息及之后的所有消息（"从此处分叉重新对话"）。 */
  onEdit?: (message: AgentMessage) => void;
  /** 用户点击「重试」—— 仅 assistant 消息可见；onRetry 用上一条 user 消息
   *  重新发起 streaming。错误态与完成态都展示。 */
  onRetry?: (message: AgentMessage) => void;
  /** 是否处于全局 streaming busy 状态 —— 此时 edit/retry 应禁用，避免与
   *  另一条进行中的 stream 抢同一会话状态机。 */
  busy?: boolean;
  /** 显示模式 —— 气泡（默认）或版书（浮印纸面）。 */
  displayMode?: DisplayMode;
  /** 流式吐字模式 —— none / fade / smooth；默认 smooth。 */
  streamAnimation?: StreamAnimationMode;
  /** 字体大小（px），默认 14.5 与文章正文同档。 */
  fontSize?: number;
}

/**
 * 单条消息气泡 ——
 *
 *  · user 消息靠右紧凑卡（不走 Markdown，原样保留换行）；
 *  · assistant 消息靠左宽栏：
 *    - 流式中：StreamMarkdown 边出边渲染（remark-gfm，无 shiki）+ 闪烁光标；
 *    - 流式完：切换到 MarkdownRenderer 完整渲染（math / code shiki / alert 等）；
 *    - 流式中且 thinking：左侧呼吸光带 + bubble 边沿 aurora 呼吸；
 *  · 顶部"已深度思考 · X.Xs"或"正在思考 · 2.4s"的状态行；
 *  · think 段折叠：流式中默认折叠但可点开看 live preview；流式完同样默认收起；
 *  · 右上 hover 显出 copy。
 */
function MessageBubbleBase({
  message,
  onEdit,
  onRetry,
  busy,
  displayMode = 'bubble',
  streamAnimation = 'smooth',
  fontSize,
}: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  // 流式吐字节流 —— 模型 SSE 大颗粒抖动 → UI 看到匀速 typewriter。
  // 仅 assistant pending 时启用；user 消息和 finished assistant 直接 raw。
  const smoothedContent = useSmoothStream(
    message.content,
    !isUser && !!message.pending,
    streamAnimation,
  );

  // CJK 友好预处理 —— 修正 `**xx：**汉字` 等 CommonMark 闭合盲点。
  const renderableContent = useMemo(
    () => normalizeCjkInlineMarkdown(smoothedContent),
    [smoothedContent],
  );

  const finalContent = useMemo(
    () => (isUser ? message.content : normalizeCjkInlineMarkdown(message.content)),
    [isUser, message.content],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 拒绝写剪贴板时静默 */
    }
  }

  // user 消息允许「编辑/复制」；编辑会丢弃后续消息，所以 streaming 中禁用。
  const canEditUser = isUser && !!onEdit && !busy && !!message.content;
  // assistant 消息允许「重试/复制」；重试同样会触发 streaming，自然要等当前
  // 流跑完。pending 自身不可重试（要么等完成、要么按 abort 后再点重试）。
  const canRetryAssistant =
    !isUser && !!onRetry && !busy && !message.pending && (!!message.content || !!message.error);

  // 流式中（pending）且尚未收到正文 token —— 显示 typing dots
  const showTypingDots = !isUser && message.pending && !message.content && !message.error;
  // 流式中且已有正文 —— bubble 边沿走呼吸 aurora，让"正在生成"的状态可视化
  const isStreaming = !isUser && message.pending && !!message.content;

  // 共用的 hover 操作行（复制 / 编辑 / 重试）—— bubble 与 engraved 模式各自挂一份，
  // 视觉位置不同但逻辑一致。
  const hoverActions = (
    <div
      className={`ml-1 inline-flex items-center gap-2 normal-case tracking-normal opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity ${
        isUser && displayMode === 'bubble' ? 'flex-row-reverse' : ''
      }`}
    >
      {!!message.content && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="复制消息"
          title="复制"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" /> 已复制
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> 复制
            </>
          )}
        </button>
      )}
      {canEditUser && (
        <button
          type="button"
          onClick={() => onEdit?.(message)}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="编辑这条消息"
          title="编辑（将截断后续对话）"
        >
          <Pencil className="w-3 h-3" /> 编辑
        </button>
      )}
      {canRetryAssistant && (
        <button
          type="button"
          onClick={() => onRetry?.(message)}
          className="inline-flex items-center gap-1 hover:text-[var(--aurora-1)]"
          aria-label="重试这条回复"
          title="重新生成"
        >
          <RefreshCcw className="w-3 h-3" /> 重试
        </button>
      )}
    </div>
  );

  // 共用的 sources 列表
  const sourcesList =
    !isUser && message.sources && message.sources.length > 0 ? (
      <div className="mt-3 max-w-full">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)] mb-1.5">
          § Sources
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {message.sources.map((s) => (
            <li key={s.slug + s.title}>
              <a
                href={`/posts/${s.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 text-[11.5px] text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] hover:border-[var(--aurora-1)]/40 transition-colors"
              >
                {s.title || s.slug}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  // ============== 版书模式（engraved）==============
  // identity 行变成居中浮动分隔标识，正文以浮印质感渲染在画布上 ——
  // 设计灵感来自宋版书的栏标 + 文章详情页的 .reading-column。
  if (displayMode === 'engraved') {
    return (
      <motion.article
        layout="position"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="group/msg relative max-w-3xl mx-auto"
        aria-label={isUser ? '用户消息' : 'Agent 回复'}
      >
        {/* 居中浮动 identity 行：左右两条渐隐 hairline */}
        <div className="my-5 flex items-center gap-3 px-1">
          <span
            aria-hidden="true"
            className="h-px flex-1 bg-gradient-to-r from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
          />
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--ink-muted)]">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
                isUser
                  ? 'bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)]'
                  : 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
              }`}
              aria-hidden="true"
            >
              {isUser ? <User className="w-2.5 h-2.5" /> : <Sparkles className="w-2.5 h-2.5" />}
            </span>
            {isUser ? 'YOU' : 'AGENT'}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums normal-case tracking-[0.14em]" suppressHydrationWarning>
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {!isUser && <ThinkingMeta message={message} />}
            {hoverActions}
          </span>
          <span
            aria-hidden="true"
            className="h-px flex-1 bg-gradient-to-l from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
          />
        </div>

        {/* think 块（仅 assistant） */}
        {!isUser && message.think && (
          <div className="mb-3">
            <ThinkingBlock
              think={message.think}
              streaming={!!message.pending && !message.firstTokenAt}
            />
          </div>
        )}

        {/* 正文 —— 没有气泡，直接铺在画布上，以 text-shadow 浮印 */}
        <div
          className="agent-engraved-text break-words"
          style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
        >
          {isUser || message.error ? (
            <div className="whitespace-pre-wrap leading-relaxed">
              {message.content}
              {message.error && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                    ERROR · {message.error}
                  </span>
                  {canRetryAssistant && (
                    <button
                      type="button"
                      onClick={() => onRetry?.(message)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10.5px] uppercase tracking-[0.18em] border border-[color-mix(in_oklch,var(--signal-danger)_45%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                      aria-label="重新生成回复"
                    >
                      <RefreshCcw className="w-3 h-3" /> 重试
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : showTypingDots ? (
            <TypingDots />
          ) : message.pending ? (
            <div
              className={`agent-engraved-streaming agent-stream-fade${
                streamAnimation === 'fade' ? ' agent-stream-fade--fade' : ''
              }`}
            >
              <StreamMarkdown content={renderableContent} />
              <span className="agent-caret text-[var(--aurora-1)]" aria-hidden="true" />
            </div>
          ) : (
            <div className="agent-md agent-engraved-md">
              <MarkdownRenderer content={finalContent} />
            </div>
          )}
        </div>

        {sourcesList}
      </motion.article>
    );
  }

  // ============== 气泡模式（bubble，默认）==============
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={`group/msg relative ${isUser ? 'flex flex-row-reverse' : 'flex flex-row'} gap-3 max-w-3xl mx-auto`}
      aria-label={isUser ? '用户消息' : 'Agent 回复'}
    >
      {/* 头像 */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[12px] ${
          isUser
            ? 'bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)]'
            : 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
        }`}
        aria-hidden="true"
      >
        {isUser ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
        {/* 元信息 + 状态行 */}
        <div
          className={`flex items-center gap-2 mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] ${
            isUser ? 'flex-row-reverse' : ''
          }`}
        >
          <span>{isUser ? 'YOU' : 'AGENT'}</span>
          <span aria-hidden="true">·</span>
          <span suppressHydrationWarning>
            {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {!isUser && <ThinkingMeta message={message} />}
          {/* hover actions —— 与 ChatGPT / Claude 一致的位置：紧贴 meta 行，
              hover 整条消息时才浮现。focus-within 让键盘用户也能拿到焦点。 */}
          <div
            className={`ml-1 inline-flex items-center gap-2 normal-case tracking-normal opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity ${
              isUser ? 'flex-row-reverse' : ''
            }`}
          >
            {/* 复制：user / assistant 都允许，pending 中的 assistant 也允许复制
                已生成部分（与 ChatGPT 一致）。仅在没有正文时隐藏。 */}
            {!!message.content && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
                aria-label="复制消息"
                title="复制"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> 复制
                  </>
                )}
              </button>
            )}
            {canEditUser && (
              <button
                type="button"
                onClick={() => onEdit?.(message)}
                className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
                aria-label="编辑这条消息"
                title="编辑（将截断后续对话）"
              >
                <Pencil className="w-3 h-3" /> 编辑
              </button>
            )}
            {canRetryAssistant && (
              <button
                type="button"
                onClick={() => onRetry?.(message)}
                className="inline-flex items-center gap-1 hover:text-[var(--aurora-1)]"
                aria-label="重试这条回复"
                title="重新生成"
              >
                <RefreshCcw className="w-3 h-3" /> 重试
              </button>
            )}
          </div>
        </div>

        {/* think 块（仅 assistant） */}
        {!isUser && message.think && (
          <ThinkingBlock think={message.think} streaming={!!message.pending && !message.firstTokenAt} />
        )}

        {/* 主体气泡 */}
        <div
          className={`max-w-full rounded-2xl px-4 py-3 leading-relaxed text-[14.5px] break-words ${
            isUser
              ? 'whitespace-pre-wrap bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--ink-primary)] border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]'
              : message.error
              ? 'whitespace-pre-wrap bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] text-[var(--ink-primary)]'
              : isStreaming
              ? 'agent-bubble-pending surface-leaf border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] text-[var(--ink-primary)]'
              : 'surface-leaf border border-[var(--ink-subtle)]/15 text-[var(--ink-primary)]'
          }`}
        >
          {isUser || message.error ? (
            <>
              {message.content}
              {message.error && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                    ERROR · {message.error}
                  </span>
                  {canRetryAssistant && (
                    <button
                      type="button"
                      onClick={() => onRetry?.(message)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10.5px] uppercase tracking-[0.18em] border border-[color-mix(in_oklch,var(--signal-danger)_45%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
                      aria-label="重新生成回复"
                    >
                      <RefreshCcw className="w-3 h-3" /> 重试
                    </button>
                  )}
                </div>
              )}
            </>
          ) : showTypingDots ? (
            <TypingDots />
          ) : message.pending ? (
            // 流式中：StreamMarkdown 边出边渲染（远轻于完整 MarkdownRenderer）
            <div
              className={`agent-stream-fade${streamAnimation === 'fade' ? ' agent-stream-fade--fade' : ''}`}
              style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
            >
              <StreamMarkdown content={renderableContent} />
              <span className="agent-caret text-[var(--aurora-1)]" aria-hidden="true" />
            </div>
          ) : (
            // 完成态：切到完整 MarkdownRenderer，math / shiki / alert 全部上色
            <div
              className="agent-md"
              style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
            >
              <MarkdownRenderer content={finalContent} />
            </div>
          )}
        </div>

        {/* sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 max-w-full">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)] mb-1.5">
              § Sources
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {message.sources.map((s) => (
                <li key={s.slug + s.title}>
                  <a
                    href={`/posts/${s.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 text-[11.5px] text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] hover:border-[var(--aurora-1)]/40 transition-colors"
                  >
                    {s.title || s.slug}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.article>
  );
}

/**
 * ThinkingBlock —— Codex 级思考块
 *
 *   收起态：单行 pill（可点击展开）
 *     · 流式中：左缘 shimmer 光带 + Brain 图标 + "正在思考"+ 字数实时计数 + tail 摘要
 *     · 完成后：Brain 图标 + "已深度思考"+ 总字数
 *
 *   展开态：可滚动 think 文本框，流式中自动 stick-to-bottom；
 *           展开时也同时显示完整时长 / 字数指标。
 *
 * 设计动机：用户在 LobeChat / Claude Code 中看到的"思考"卡片之所以舒服，是因为
 * 它在传达"模型在工作"这件事时不喧宾夺主 —— 边沿一缕光，预览一行字，体感上
 * 像是听到打字机的轻响，而不是横幅广告闯入。这里我们用 surface-leaf + 极光左缘
 * 还原同样的"克制感"。
 */
function ThinkingBlock({ think, streaming }: { think: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // 展开时让滚动条自动跟随尾部 —— 类似终端 tail -f 体验
  useLayoutEffect(() => {
    if (!open || !streaming) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, streaming, think]);

  const charCount = think.length;
  // 取最后一段非空文本作为收起时的"思路尾巴"——只用作视觉提示，不参与语义
  const tail = (() => {
    const trimmed = think.replace(/\s+$/, '');
    if (trimmed.length <= 36) return trimmed;
    return `…${trimmed.slice(-36)}`;
  })();

  return (
    <div className="relative mb-2.5 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`group/think relative w-full flex items-center gap-2 pl-3 pr-3 py-2 rounded-xl border text-left transition-colors overflow-hidden ${
          streaming
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
            : 'bg-[var(--bg-raised)]/55 border-[var(--ink-subtle)]/16 hover:border-[var(--aurora-1)]/30'
        }`}
      >
        {/* 左缘 aurora 光带：仅 streaming 时显示 */}
        {streaming && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
          >
            <span className="agent-think-shimmer" />
          </span>
        )}
        <Brain
          className={`w-3.5 h-3.5 flex-shrink-0 ${
            streaming ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
          }`}
        />
        <span
          className={`font-mono text-[10.5px] uppercase tracking-[0.22em] flex-shrink-0 ${
            streaming ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
          }`}
        >
          {streaming ? '正在思考' : '已深度思考'}
        </span>
        <span aria-hidden="true" className="font-mono text-[10px] text-[var(--ink-muted)]">·</span>
        <span className="font-mono text-[10.5px] text-[var(--ink-muted)] tabular-nums flex-shrink-0">
          {charCount} chars
        </span>
        {/* tail 摘要：只在收起态 + 有内容时显示，截断 */}
        {!open && tail && (
          <span className="hidden sm:inline truncate text-[12px] italic text-[var(--ink-muted)]/85 ml-1.5 min-w-0">
            {tail}
          </span>
        )}
        <span className="ml-auto flex-shrink-0 text-[var(--ink-muted)]">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="think-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={previewRef}
              className="agent-thumb-scroll mt-2 max-h-[260px] overflow-y-auto p-3 rounded-xl bg-[var(--bg-raised)]/55 border border-[var(--ink-subtle)]/15"
            >
              <pre className="whitespace-pre-wrap break-words leading-relaxed text-[12.5px] text-[var(--ink-secondary)] font-sans">
                {think}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ThinkingMeta —— 渲染「正在思考 · 2.4s」/「已深度思考 · 3.1s」状态行（小字 inline）。
 *
 *   - pending && !firstToken      → "正在思考 · X.Xs" + breath dot
 *   - pending && firstToken to     → "正在生成 · X.Xs"
 *   - !pending && finishedAt set   → "已深度思考 · X.Xs"（不再实时计时）
 */
function ThinkingMeta({ message }: { message: AgentMessage }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!message.pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [message.pending]);

  if (!message.startedAt) return null;
  const isStreaming = message.pending;
  const endTs = isStreaming ? now : (message.finishedAt ?? message.startedAt);
  const elapsed = Math.max(0, endTs - message.startedAt) / 1000;
  const elapsedStr = `${elapsed.toFixed(1)}s`;

  let label: string;
  if (isStreaming && !message.firstTokenAt) {
    label = '正在思考';
  } else if (isStreaming) {
    label = '正在生成';
  } else if (message.error) {
    label = '已中断';
  } else {
    label = '已深度思考';
  }

  return (
    <>
      <span aria-hidden="true">·</span>
      <span className={`inline-flex items-center gap-1 ${isStreaming ? 'text-[var(--aurora-1)]' : ''}`}>
        {isStreaming && (
          <span
            aria-hidden="true"
            className="w-1 h-1 rounded-full bg-current"
            style={{ animation: 'breath-soft 1.2s ease-in-out infinite' }}
          />
        )}
        {label}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{elapsedStr}</span>
      </span>
    </>
  );
}

/**
 * TypingDots —— 三点 typing 指示器
 *
 * 视觉策略：三点本身做"漂浮 + 缩放 + 透明度"复合呼吸（agent-dot-pulse），
 * 背后再叠一圈 aurora 径向光晕 blur。这两层加起来能在 14px 高度内表达
 * 出"模型正在思考"的呼吸感，而不需要更多面积。
 */
function TypingDots() {
  return (
    <span className="relative inline-flex items-center gap-1.5 text-[var(--aurora-1)] py-1 px-0.5">
      <span
        aria-hidden="true"
        className="absolute -inset-3 rounded-full blur-md opacity-60"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--aurora-1) 30%, transparent), transparent)',
          animation: 'breath-soft 2.4s ease-in-out infinite',
        }}
      />
      <span className="relative agent-dot" />
      <span className="relative agent-dot" style={{ animationDelay: '0.16s' }} />
      <span className="relative agent-dot" style={{ animationDelay: '0.32s' }} />
    </span>
  );
}

/**
 * memo 比较器：只有当本条消息真的变了才重渲。这是 throttling 之外的另一道
 * 防线——同会话下其它消息的 setSessions 引发的 reduce 不会拖累已经定稿的
 * 历史 bubbles 重渲（每个 markdown bubble 重渲都要重新跑 shiki，代价很重）。
 */
function areEqual(a: Props, b: Props) {
  const ma = a.message;
  const mb = b.message;
  // busy 翻转直接影响按钮可点性（disabled / hidden），必须穿透 memo 重渲。
  if (a.busy !== b.busy) return false;
  // 设置变化（显示模式 / 吐字模式 / 字号）也要穿透：用户切档时即时生效。
  if (a.displayMode !== b.displayMode) return false;
  if (a.streamAnimation !== b.streamAnimation) return false;
  if (a.fontSize !== b.fontSize) return false;
  // 父级用 useCallback 稳定 onEdit / onRetry —— 它们的引用不变就视为等价；
  // 真要变（比如父切了 active session）也通常伴随 busy 或 message 变化。
  if (a.onEdit !== b.onEdit || a.onRetry !== b.onRetry) return false;
  if (ma === mb) return true;
  if (
    ma.id === mb.id &&
    ma.content === mb.content &&
    ma.think === mb.think &&
    ma.pending === mb.pending &&
    ma.error === mb.error &&
    ma.finishedAt === mb.finishedAt &&
    ma.firstTokenAt === mb.firstTokenAt &&
    ma.sources === mb.sources
  ) {
    return true;
  }
  return false;
}

export default memo(MessageBubbleBase, areEqual);
