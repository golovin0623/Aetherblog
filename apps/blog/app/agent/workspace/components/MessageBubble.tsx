'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
  const messageFontStyle = useMemo<CSSProperties | undefined>(() => {
    if (!fontSize) return undefined;
    return {
      fontSize: `${fontSize}px`,
      '--agent-message-font-size': `${fontSize}px`,
    } as CSSProperties;
  }, [fontSize]);

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

  const hasThink = !isUser && !!message.think?.trim();
  const showThinkingPanel = !isUser && (!!message.pending || hasThink);
  // 流式中（pending）且尚未收到正文 token —— 显示 typing dots
  const showTypingDots = !isUser && message.pending && !message.content && !message.error;
  // 流式中且已有正文 —— bubble 边沿走呼吸 aurora，让"正在生成"的状态可视化
  const isStreaming = !isUser && message.pending && !!message.content;

  // LobeHub 风格操作条：不占用 YOU/AGENT 标题行，默认隐藏，hover/focus 时浮现。
  const hasActions = !!message.content || canEditUser || canRetryAssistant;
  const actionButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]';
  const messageActions = hasActions ? (
    <div
      className={`mt-1.5 flex w-fit items-center gap-0.5 rounded-xl border border-[var(--ink-subtle)]/12 bg-[var(--bg-raised)]/65 p-0.5 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto ${
        isUser ? 'ml-auto' : 'mr-auto'
      }`}
      aria-label="消息操作"
    >
      {!!message.content && (
        <button
          type="button"
          onClick={handleCopy}
          className={actionButtonClass}
          aria-label={copied ? '已复制' : '复制消息'}
          title={copied ? '已复制' : '复制'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {canEditUser && (
        <button
          type="button"
          onClick={() => onEdit?.(message)}
          className={actionButtonClass}
          aria-label="编辑这条消息"
          title="编辑（将截断后续对话）"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {canRetryAssistant && (
        <button
          type="button"
          onClick={() => onRetry?.(message)}
          className={`${actionButtonClass} hover:text-[var(--aurora-1)]`}
          aria-label="重新生成回复"
          title="重新生成"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ) : null;

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
        className="group/msg relative mx-auto w-full max-w-[820px]"
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
          </span>
          <span
            aria-hidden="true"
            className="h-px flex-1 bg-gradient-to-l from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
          />
        </div>

        {/* 思考面板（仅 assistant）—— Lobehub 式独立折叠卡，永远不混入 meta 行 */}
        {showThinkingPanel && (
          <div className="mx-auto mb-3 w-full max-w-[680px]">
            <ThinkingPanel
              message={message}
              fontSize={fontSize}
              streamAnimation={streamAnimation}
            />
          </div>
        )}

        {/* 正文 —— 没有气泡，直接铺在画布上，以 text-shadow 浮印 */}
        <div className="mx-auto w-full max-w-[680px]">
          <div
            className="agent-message-font agent-engraved-text break-words"
            style={messageFontStyle}
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

          {messageActions}
        </div>

        {sourcesList && <div className="mx-auto w-full max-w-[680px]">{sourcesList}</div>}
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
      className={`group/msg relative mx-auto flex w-full max-w-[820px] flex-col ${
        isUser ? 'items-end' : 'items-start'
      }`}
      aria-label={isUser ? '用户消息' : 'Agent 回复'}
    >
      {/* 元信息 + 状态行。头像放在 header，不再作为正文横向 gutter，
          这样思考块 / 回答卡 / 输入框共享同一条居中 rail。 */}
      <div
        className={`mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] ${
          isUser ? 'flex-row-reverse self-end' : 'self-start'
        }`}
      >
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[12px] ${
            isUser
              ? 'bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)]'
              : 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
          }`}
          aria-hidden="true"
        >
          {isUser ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        </span>
        <span>{isUser ? 'YOU' : 'AGENT'}</span>
        <span aria-hidden="true">·</span>
        <span suppressHydrationWarning>
          {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {/* 思考面板（仅 assistant）—— Lobehub 式独立折叠卡，永远不混入 meta 行 */}
      {showThinkingPanel && (
        <div className="w-full">
          <ThinkingPanel
            message={message}
            fontSize={fontSize}
            streamAnimation={streamAnimation}
          />
        </div>
      )}

      {/* 主体气泡 */}
      <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`agent-message-font rounded-2xl px-4 py-3 leading-relaxed text-[14.5px] break-words transition-[border-color,box-shadow,transform] duration-300 ${
            isUser
              ? 'max-w-[85%] whitespace-pre-wrap bg-[linear-gradient(155deg,color-mix(in_oklch,var(--aurora-1)_14%,transparent),color-mix(in_oklch,var(--aurora-1)_6%,transparent))] text-[var(--ink-primary)] border border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] shadow-[0_10px_28px_-18px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]'
              : message.error
              ? 'w-full max-w-full whitespace-pre-wrap bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] text-[var(--ink-primary)]'
              : isStreaming
              ? 'agent-bubble-pending surface-leaf w-full max-w-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] text-[var(--ink-primary)] shadow-[0_14px_32px_-22px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]'
              : 'surface-leaf w-full max-w-full border border-[var(--ink-subtle)]/15 text-[var(--ink-primary)] shadow-[0_12px_30px_-24px_rgba(0,0,0,0.42)] hover:border-[color-mix(in_oklch,var(--aurora-1)_24%,var(--ink-subtle))] hover:shadow-[0_16px_38px_-24px_color-mix(in_oklch,var(--aurora-1)_35%,transparent)]'
          }`}
          style={messageFontStyle}
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
            >
              <StreamMarkdown content={renderableContent} />
              <span className="agent-caret text-[var(--aurora-1)]" aria-hidden="true" />
            </div>
          ) : (
            // 完成态：切到完整 MarkdownRenderer，math / shiki / alert 全部上色
            <div
              className="agent-md"
            >
              <MarkdownRenderer content={finalContent} />
            </div>
          )}
        </div>
      </div>

      {messageActions}

      {/* sources */}
      {!isUser && message.sources && message.sources.length > 0 && (
        <div className="mt-3 w-full max-w-full">
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
    </motion.article>
  );
}

function markdownToPreviewText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^[>\s-]*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ThinkingPanel —— Lobehub 风格统一思考面板
 *
 * 取代旧的 inline `ThinkingMeta` + 独立 `ThinkingBlock` 双轨实现 —— 把"思考状态行"
 * 和"思考内容折叠卡"合并成一块挂在主回答正文上方的独立 UI，永远不混进 AGENT
 * meta 行（YOU/AGENT · 时间）。这样：
 *
 *  · 移动端不再因为 meta 行被左右 hairline 挤压而把 CJK 标签（"已深度思考"）
 *    逐字纵向断行；
 *  · 视觉层级更接近 LobeChat / Claude / Gemini 等 Agent 工具：思考内容是
 *    "可折叠副面板"，不是"正文标题的一部分"。
 *
 * 渲染态：
 *   收起 pill（永远显示一行）
 *     · 流式 + 未首 token  → 左缘 aurora shimmer + Brain + "正在思考" + 实时秒数
 *     · 流式 + 已首 token  → 同上但 label = "正在生成"
 *     · 已完成 + 有 think  → Brain + "已深度思考" + 总秒数 + N chars，可展开
 *     · 已完成 + 无 think  → Brain + "已深度思考" + 总秒数（不可展开）
 *     · 错误中断           → "已中断" + 秒数
 *
 *   展开（仅在有 think 内容时可用）
 *     · 滚动 pre 框，流式中 stick-to-bottom（终端 tail -f 体验）。
 */
function ThinkingPanel({
  message,
  fontSize,
  streamAnimation,
}: {
  message: AgentMessage;
  fontSize?: number;
  streamAnimation: StreamAnimationMode;
}) {
  const isStreaming = !!message.pending;
  const [open, setOpen] = useState(false);
  const userToggledRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  // 思考内容和正文内容各自使用独立的平滑流。这样大段 reasoning 还在
  // 视觉追帧时，正文 delta 仍能按自己的节奏同步渲染，不被思考缓冲拖住。
  const smoothedThink = useSmoothStream(message.think ?? '', isStreaming, streamAnimation);
  const thinkFontStyle = useMemo<CSSProperties | undefined>(() => {
    if (!fontSize) return undefined;
    return {
      fontSize: `${fontSize}px`,
      '--agent-message-font-size': `${fontSize}px`,
    } as CSSProperties;
  }, [fontSize]);

  const hasThink = !!message.think && message.think.length > 0;
  const expandable = hasThink;

  useEffect(() => {
    if (!hasThink || userToggledRef.current) return;
    if (isStreaming) {
      setOpen(true);
      return;
    }
    const id = window.setTimeout(() => setOpen(false), 520);
    return () => window.clearTimeout(id);
  }, [hasThink, isStreaming]);

  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  useLayoutEffect(() => {
    if (!open || !isStreaming) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, isStreaming, smoothedThink]);

  const renderableThink = useMemo(
    () => normalizeCjkInlineMarkdown(smoothedThink),
    [smoothedThink],
  );
  const tail = useMemo(() => {
    const trimmed = markdownToPreviewText(smoothedThink);
    if (!trimmed) return '';
    if (trimmed.length <= 86) return trimmed;
    return `${trimmed.slice(0, 86)}…`;
  }, [smoothedThink]);

  if (!message.startedAt) return null;

  const endTs = isStreaming ? now : (message.finishedAt ?? message.startedAt);
  const elapsed = Math.max(0, endTs - message.startedAt) / 1000;
  const elapsedStr = `${elapsed.toFixed(1)} 秒`;

  let label: string;
  if (isStreaming && hasThink && !message.firstTokenAt) {
    label = '正在思考';
  } else if (isStreaming) {
    label = message.firstTokenAt ? '正在生成' : '等待响应';
  } else if (message.error) {
    label = '已中断';
  } else if (hasThink) {
    label = '已深度思考';
  } else {
    label = '已生成';
  }

  const charCount = hasThink ? message.think!.length : 0;
  const showShimmer = isStreaming;

  const containerClass = `group/think relative w-full flex items-center gap-2 pl-3 pr-2.5 py-2.5 rounded-xl border text-left transition-[border-color,background-color,box-shadow] overflow-hidden ${
    isStreaming
      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)] border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] shadow-[0_12px_28px_-24px_rgba(0,0,0,0.35)]'
      : message.error
      ? 'bg-[color-mix(in_oklch,var(--signal-warn)_6%,transparent)] border-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)]'
      : 'bg-[var(--bg-raised)]/48 border-[var(--ink-subtle)]/14 hover:border-[var(--aurora-1)]/30'
  } ${expandable ? 'cursor-pointer' : 'cursor-default'}`;

  const inner = (
    <>
      {showShimmer && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
        >
          <span className="agent-think-shimmer" />
        </span>
      )}
      <span
        className={`relative grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg ${
          isStreaming
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]'
            : message.error
            ? 'bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] text-[var(--signal-warn)]'
            : 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-muted)]'
        }`}
        aria-hidden="true"
      >
        <Brain className="w-3.5 h-3.5" />
      </span>
      <span className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`text-[12px] font-medium flex-shrink-0 whitespace-nowrap ${
            isStreaming ? 'text-[var(--aurora-1)]' : message.error ? 'text-[var(--signal-warn)]' : 'text-[var(--ink-secondary)]'
          }`}
        >
          {label}
        </span>
        {isStreaming && (
          <span className="inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_9%,transparent)] px-2 text-[10.5px] text-[var(--aurora-1)]">
            <span className="agent-thinking-live-dot" aria-hidden="true" />
            实时
          </span>
        )}
        {!open && tail && (
          <span className="hidden min-w-[8rem] max-w-[min(44vw,34rem)] flex-1 truncate text-[12px] text-[var(--ink-muted)] sm:inline">
            {tail}
          </span>
        )}
      </span>
      <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-[var(--ink-muted)] tabular-nums">
        <span className="whitespace-nowrap">用时 {elapsedStr}</span>
        {hasThink && (
          <>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{charCount} 字符</span>
          </>
        )}
      </span>
      {expandable && (
        <span className="flex-shrink-0 text-[var(--ink-muted)]">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      )}
    </>
  );

  return (
    <div className="relative mb-2.5 max-w-full">
      {expandable ? (
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className={containerClass}
        >
          {inner}
        </button>
      ) : (
        <div className={containerClass} aria-live={isStreaming ? 'polite' : undefined}>
          {inner}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expandable && open && (
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
              className={`agent-thumb-scroll agent-thinking-scroll mt-2 max-h-[min(340px,42vh)] overflow-y-auto p-3.5 rounded-xl border ${
                isStreaming
                  ? 'bg-[color-mix(in_oklch,var(--aurora-1)_5%,var(--bg-raised))] border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]'
                  : 'bg-[var(--bg-raised)]/55 border-[var(--ink-subtle)]/15'
              }`}
            >
              {isStreaming ? (
                <div
                  className={`agent-think-md agent-stream-fade${
                    streamAnimation === 'fade' ? ' agent-stream-fade--fade' : ''
                  }`}
                  style={thinkFontStyle}
                >
                  <StreamMarkdown content={renderableThink} />
                </div>
              ) : (
                <div
                  className="agent-md agent-think-md"
                  style={thinkFontStyle}
                >
                  <MarkdownRenderer content={renderableThink} />
                </div>
              )}
              {isStreaming && (
                <span className="agent-caret text-[var(--aurora-1)]" aria-hidden="true" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
