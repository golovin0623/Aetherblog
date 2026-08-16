'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  User,
  Copy,
  Check,
  Brain,
  Pencil,
  RefreshCcw,
  Languages,
  TextQuote,
  GitBranch,
  Trash2,
  X,
} from 'lucide-react';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';
import StreamMarkdown from './StreamMarkdown';
import RetrievalReceipt, { type RetrievalReceiptHandle } from './RetrievalReceipt';
import type { AgentMessage } from '../../lib/agentSessions';
import type { KnowledgeContextMode } from '../../lib/agentChatStream';
import { normalizeCjkInlineMarkdown } from '../../lib/cjkMarkdown';
import { linkifyCitations, parseCitationRank } from '../../lib/citations';
import { estimateTokens, formatTokenCount } from '../../lib/tokenEstimate';
import { useSmoothStream, type StreamAnimationMode } from '../../lib/smooth';

/** 显示模式：bubble = 彩色卡片承载；engraved = 文字浮印纸面（版书）。 */
export type DisplayMode = 'bubble' | 'engraved';

/** 重试可携带的编排覆盖 —— 目前只有"改用自动检索"一种（selected 上下文
 *  未命中时的一键出路）。 */
export interface RetryOptions {
  knowledgeMode?: KnowledgeContextMode;
}

interface Props {
  message: AgentMessage;
  /** 用户点击「编辑」—— 仅 user 消息可见；onEdit 把消息回填到 composer
   *  并截断该消息及之后的所有消息（"从此处分叉重新对话"）。 */
  onEdit?: (message: AgentMessage) => void;
  /** 用户点击「重试」—— 仅 assistant 消息可见；onRetry 用上一条 user 消息
   *  重新发起 streaming。错误态与完成态都展示。 */
  onRetry?: (message: AgentMessage, options?: RetryOptions) => void;
  /** 「翻译」—— 仅 assistant 完成态；流式写入 message.translation。 */
  onTranslate?: (message: AgentMessage) => void;
  /** 关闭译文面板（清掉 message.translation）。 */
  onDismissTranslation?: (message: AgentMessage) => void;
  /** 「引用」—— 把消息以 blockquote 形式插入 composer。 */
  onQuote?: (message: AgentMessage) => void;
  /** 「分支」—— 以该消息为止复制出一条新会话。 */
  onFork?: (message: AgentMessage) => void;
  /** 「删除」—— 删除单条消息（带撤销 toast）。 */
  onDelete?: (message: AgentMessage) => void;
  /** 是否处于全局 streaming busy 状态 —— 此时 edit/retry 应禁用，避免与
   *  另一条进行中的 stream 抢同一会话状态机。 */
  busy?: boolean;
  /** 显示模式 —— 气泡（默认）或版书（浮印纸面）。 */
  displayMode?: DisplayMode;
  /** 流式吐字模式 —— none / fade / smooth；默认 smooth。 */
  streamAnimation?: StreamAnimationMode;
  /** 字体大小（px），默认 14.5 与文章正文同档。 */
  fontSize?: number;
  /** 把 (providerCode, modelId) 解析成展示名 —— 由父级从模型清单构建。 */
  resolveModelLabel?: (providerCode: string | null | undefined, modelId: string | null | undefined) => string | null;
  /** admin 才允许点击 /admin/ 开头的检索来源链接。 */
  allowAdminHref?: boolean;
}

/**
 * 单条消息气泡 ——
 *
 *  · user 消息靠右紧凑卡（不走 Markdown，原样保留换行）；
 *  · assistant 消息靠左宽栏：
 *    - 检索回执（retrieval）挂在正文上方 —— 时间线上先检索后作答；
 *    - 流式中：StreamMarkdown 边出边渲染（remark-gfm，无 shiki）+ 内联光标；
 *    - 流式完：切换到 MarkdownRenderer 完整渲染（math / code shiki / alert 等），
 *      正文里的 [n]/【n】引用标记链接到回执命中条目；
 *    - 元数据 footer：模型 · 用时 · 首字 · ~token 估算；
 *    - 译文面板：操作条「翻译」流式写入，可关可复制；
 *  · think 段折叠：流式中默认展开 live preview；流式完自动收起；
 *  · hover 浮现操作条：复制 / 引用 / 翻译 / 分支 / 重试 / 删除。
 */
function MessageBubbleBase({
  message,
  onEdit,
  onRetry,
  onTranslate,
  onDismissTranslation,
  onQuote,
  onFork,
  onDelete,
  busy,
  displayMode = 'bubble',
  streamAnimation = 'smooth',
  fontSize,
  resolveModelLabel,
  allowAdminHref,
}: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const receiptRef = useRef<RetrievalReceiptHandle>(null);

  // 正文吐字平滑由 WorkspaceClient 的 rAF 管线统一负责 —— 流式期间
  // message.content 已是按"过渡动画"档位匀速推进的屏幕态，这里直接渲染。

  const citationRankMax = !isUser && message.retrieval ? message.retrieval.hits.length : 0;

  // CJK 友好预处理 + 引用标记链接化（仅 assistant 且有检索回执时）。
  const renderableContent = useMemo(() => {
    const normalized = normalizeCjkInlineMarkdown(message.content);
    return citationRankMax > 0
      ? linkifyCitations(normalized, message.id, citationRankMax)
      : normalized;
  }, [message.content, message.id, citationRankMax]);

  const finalContent = useMemo(() => {
    if (isUser) return message.content;
    return renderableContent;
  }, [isUser, message.content, renderableContent]);

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

  // 引用标记点击 → 展开回执并滚动高亮对应命中（委托监听,链接由 markdown 渲染)。
  const handleBodyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest?.('a[href^="#cite-"]');
    if (!anchor) return;
    e.preventDefault();
    const rank = parseCitationRank(anchor.getAttribute('href') ?? '');
    if (rank != null) receiptRef.current?.reveal(rank);
  }, []);

  // user 消息允许「编辑/复制」；编辑会丢弃后续消息，所以 streaming 中禁用。
  const canEditUser = isUser && !!onEdit && !busy && !!message.content;
  // assistant 消息允许「重试/复制」；重试同样会触发 streaming，自然要等当前
  // 流跑完。pending 自身不可重试（要么等完成、要么按 abort 后再点重试）。
  const canRetryAssistant =
    !isUser && !!onRetry && !busy && !message.pending && (!!message.content || !!message.error);
  const canTranslate =
    !isUser &&
    !!onTranslate &&
    !busy &&
    !message.pending &&
    !!message.content &&
    !message.translation?.pending;
  const canQuote = !!onQuote && !!message.content && !message.pending;
  const canFork = !!onFork && !busy && !message.pending;
  const canDelete = !!onDelete && !busy && !message.pending;

  const hasThink = !isUser && !!message.think?.trim();
  const showThinkingPanel = !isUser && (!!message.pending || hasThink);
  // 流式中（pending）且尚未收到正文 token —— 显示 typing dots
  const showTypingDots = !isUser && message.pending && !message.content && !message.error;
  // 流式中且已有正文 —— bubble 边沿走呼吸 aurora，让"正在生成"的状态可视化
  const isStreaming = !isUser && message.pending && !!message.content;
  const showMessageBody = isUser || !!message.error || !!message.content || (!showThinkingPanel && showTypingDots);
  const selectedContextNotGrounded = message.errorCode === 'selected_context_not_grounded';

  // ---- 元数据 footer（assistant 完成态）----
  const metaLine = useMemo(() => {
    if (isUser || message.pending || !message.startedAt || !message.finishedAt) return null;
    const parts: string[] = [];
    const label = resolveModelLabel?.(message.providerCode, message.modelId);
    if (label) parts.push(label);
    else if (message.modelId) parts.push(message.modelId);
    else if (message.modelId === null) parts.push('自动路由');
    const total = (message.finishedAt - message.startedAt) / 1000;
    parts.push(`用时 ${total.toFixed(1)}s`);
    if (message.firstTokenAt && message.firstTokenAt > message.startedAt) {
      parts.push(`首字 ${((message.firstTokenAt - message.startedAt) / 1000).toFixed(1)}s`);
    }
    if (message.content) {
      parts.push(`~${formatTokenCount(estimateTokens(message.content))} tok`);
    }
    return parts.join(' · ');
  }, [
    isUser,
    message.pending,
    message.startedAt,
    message.finishedAt,
    message.firstTokenAt,
    message.content,
    message.modelId,
    message.providerCode,
    resolveModelLabel,
  ]);

  // LobeHub 风格操作条：不占用标题行，默认隐藏，hover/focus 时浮现。
  const hasActions =
    !!message.content || canEditUser || canRetryAssistant || canFork || canDelete;
  // 操作条容器底就是 --bg-raised —— hover 必须走 ink 淡染,否则悬浮不可见。
  const actionButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]';
  const messageActions = hasActions ? (
    <div
      className={`flex w-fit items-center gap-0.5 rounded-xl border border-[var(--ink-subtle)]/12 bg-[var(--bg-raised)] p-0.5 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto`}
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
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--signal-success)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {canQuote && (
        <button
          type="button"
          onClick={() => onQuote?.(message)}
          className={actionButtonClass}
          aria-label="引用这条消息"
          title="引用到输入框"
        >
          <TextQuote className="h-3.5 w-3.5" />
        </button>
      )}
      {canTranslate && (
        <button
          type="button"
          onClick={() => onTranslate?.(message)}
          className={actionButtonClass}
          aria-label="翻译这条消息"
          title="翻译（中 ⇄ EN）"
        >
          <Languages className="h-3.5 w-3.5" />
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
      {canFork && (
        <button
          type="button"
          onClick={() => onFork?.(message)}
          className={actionButtonClass}
          aria-label="从此处分支新会话"
          title="分支会话（复制到此为止的对话）"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete?.(message)}
          className={`${actionButtonClass} hover:text-[var(--signal-danger)]`}
          aria-label="删除这条消息"
          title="删除消息"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ) : null;

  // footer 行：assistant 左侧固定 meta（安静的 mono 行），操作条随 hover 浮现。
  const messageFooter =
    hasActions || metaLine ? (
      <div
        className={`mt-1.5 flex w-full items-center gap-3 ${
          isUser ? 'flex-row-reverse' : ''
        }`}
      >
        {messageActions}
        {metaLine && (
          <span
            className="min-w-0 truncate font-mono text-[10px] tracking-[0.02em] text-[var(--ink-muted)]/85 tnum"
            title={metaLine}
          >
            {metaLine}
          </span>
        )}
      </div>
    ) : null;

  // 检索回执（assistant） —— 正文上方。
  const receiptBlock =
    !isUser && message.retrieval ? (
      <RetrievalReceipt
        ref={receiptRef}
        receipt={message.retrieval}
        messageId={message.id}
        allowAdminHref={allowAdminHref}
      />
    ) : null;

  // 译文面板（assistant）。
  const translationBlock =
    !isUser && message.translation ? (
      <TranslationBlock
        message={message}
        fontStyle={messageFontStyle}
        onRetranslate={onTranslate}
        onDismiss={onDismissTranslation}
      />
    ) : null;

  // 错误 footer 的补充编排：selected 上下文未命中 → 一键改自动检索重试。
  const retryAutoButton =
    selectedContextNotGrounded && canRetryAssistant ? (
      <button
        type="button"
        onClick={() => onRetry?.(message, { knowledgeMode: 'auto' })}
        className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_45%,transparent)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--aurora-2)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)]"
        aria-label="改用自动检索重试"
      >
        <Sparkles className="h-3 w-3" /> 自动检索重试
      </button>
    ) : null;

  // 共用的 sources 列表（旧版 SSE `sources` 事件的历史消息兼容渲染）
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

        {receiptBlock && (
          <div className="mx-auto w-full max-w-[680px]">{receiptBlock}</div>
        )}

        {showMessageBody && (
          /* 正文 —— 没有气泡，直接铺在画布上，以 text-shadow 浮印 */
          <div className="mx-auto w-full max-w-[680px]">
            <div
              className="agent-message-font agent-engraved-text break-words"
              style={messageFontStyle}
              onClick={handleBodyClick}
            >
              {isUser ? (
                <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
              ) : message.error ? (
                // 与气泡模式同款：部分内容保留 Markdown 渲染，错误信息作 footer。
                <div>
                  {message.content && (
                    <div className="agent-md agent-engraved-md">
                      <MarkdownRenderer content={finalContent} />
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                      ERROR · {message.error}
                    </span>
                    {retryAutoButton}
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
                </div>
              ) : showTypingDots ? (
                <TypingDots />
              ) : message.pending ? (
                <div
                  className={`agent-engraved-streaming agent-stream-caret agent-stream-fade${
                    streamAnimation === 'fade' ? ' agent-stream-fade--fade' : ''
                  }`}
                >
                  <StreamMarkdown content={renderableContent} />
                </div>
              ) : (
                <div className="agent-md agent-engraved-md agent-md-settle">
                  <MarkdownRenderer content={finalContent} />
                </div>
              )}
            </div>

            {translationBlock}
            {messageFooter}
          </div>
        )}

        {sourcesList && <div className="mx-auto w-full max-w-[680px]">{sourcesList}</div>}
      </motion.article>
    );
  }

  // ============== 气泡模式（bubble，默认）==============
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={`group/msg relative mx-auto flex w-full min-w-0 max-w-[820px] flex-col ${
        isUser ? 'items-end' : 'items-start'
      }`}
      aria-label={isUser ? '用户消息' : 'Agent 回复'}
    >
      {/* identity —— Codex 式克制:一枚角色圆点(assistant 极光 · user 中性墨)
          + 静音时间戳,把视觉权重整体让回正文。 */}
      <div
        className={`mb-1.5 flex items-center gap-1.5 text-[11px] tnum text-[var(--ink-muted)] ${
          isUser ? 'flex-row-reverse self-end' : 'self-start'
        }`}
      >
        <span
          aria-hidden="true"
          className={
            isUser
              ? 'h-1.5 w-1.5 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_28%,transparent)]'
              : 'h-1.5 w-1.5 rounded-full bg-[var(--aurora-1)] shadow-[0_0_6px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)]'
          }
        />
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

      {receiptBlock}

      {showMessageBody && (
        <>
          {/* 主体气泡 */}
          <div className={`flex w-full min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`agent-message-font min-w-0 break-words rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed transition-[border-color,box-shadow,transform] duration-quick ease-aether ${
                isUser
                  ? 'max-w-[85%] whitespace-pre-wrap border border-[var(--ink-subtle)]/14 bg-[var(--bg-raised)] text-[var(--ink-primary)] shadow-[0_1px_0_inset_color-mix(in_oklch,var(--ink-primary)_5%,transparent),0_8px_22px_-20px_rgba(0,0,0,0.5)]'
                  : message.error && !message.content
                  ? 'w-full max-w-full whitespace-pre-wrap border border-[color-mix(in_oklch,var(--signal-danger)_26%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_7%,transparent)] text-[var(--ink-primary)]'
                  : message.error
                  ? 'surface-leaf w-full max-w-full border border-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--ink-primary)]'
                  : isStreaming
                  ? 'agent-bubble-pending surface-leaf w-full max-w-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] text-[var(--ink-primary)]'
                  : 'surface-leaf w-full max-w-full border border-[var(--ink-subtle)]/12 text-[var(--ink-primary)] shadow-[0_10px_30px_-26px_rgba(0,0,0,0.5)]'
              }`}
              style={messageFontStyle}
              onClick={handleBodyClick}
            >
              {isUser ? (
                message.content
              ) : message.error ? (
                // 错误 / 中断态 —— 已收到的部分内容仍走 Markdown 完整渲染（中断
                // 不该把排好版的回复打回纯文本原文），错误信息收敛成卡内 footer。
                <>
                  {message.content && (
                    <div className="agent-md">
                      <MarkdownRenderer content={finalContent} />
                    </div>
                  )}
                  <div
                    className={`flex flex-wrap items-center gap-3 ${
                      message.content
                        ? 'mt-3 border-t border-[var(--ink-subtle)]/12 pt-2.5'
                        : ''
                    }`}
                  >
                    <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                      ERROR · {message.error}
                    </span>
                    {retryAutoButton}
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
                </>
              ) : showTypingDots ? (
                <TypingDots />
              ) : message.pending ? (
                // 流式中：StreamMarkdown 边出边渲染（远轻于完整 MarkdownRenderer），
                // 光标由 CSS 内联挂在最后一个文本块尾部（agent-stream-caret）。
                <div
                  className={`agent-stream-caret agent-stream-fade${streamAnimation === 'fade' ? ' agent-stream-fade--fade' : ''}`}
                >
                  <StreamMarkdown content={renderableContent} />
                </div>
              ) : (
                // 完成态：切到完整 MarkdownRenderer，math / shiki / alert 全部上色；
                // agent-md-settle 让切换以 220ms 淡入落定，不做硬跳。
                <div className="agent-md agent-md-settle">
                  <MarkdownRenderer content={finalContent} />
                </div>
              )}
            </div>
          </div>

          {translationBlock && <div className="w-full">{translationBlock}</div>}
          {messageFooter}
        </>
      )}

      {/* sources（旧事件兼容） */}
      {sourcesList && <div className="w-full max-w-full">{sourcesList}</div>}
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
 * TranslationBlock —— 消息内联译文面板
 *
 * 由操作条「翻译」触发；translation.pending 期间流式追加并展示 shimmer 光带，
 * 完成后可复制 / 重新翻译 / 关闭。视觉：aurora-3（cyan）作为"辅助理解层"的
 * 点色，与正文（aurora-1）、知识（aurora-2）区分开。
 */
function TranslationBlock({
  message,
  fontStyle,
  onRetranslate,
  onDismiss,
}: {
  message: AgentMessage;
  fontStyle?: CSSProperties;
  onRetranslate?: (message: AgentMessage) => void;
  onDismiss?: (message: AgentMessage) => void;
}) {
  const t = message.translation!;
  const [copied, setCopied] = useState(false);

  async function copyTranslation() {
    try {
      await navigator.clipboard.writeText(t.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`relative mt-2 w-full overflow-hidden rounded-xl border ${
        t.pending
          ? 'border-[color-mix(in_oklch,var(--aurora-3)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-3)_6%,transparent)]'
          : 'border-[color-mix(in_oklch,var(--aurora-3)_20%,transparent)] bg-[color-mix(in_oklch,var(--aurora-3)_4%,transparent)]'
      }`}
      aria-label="译文"
    >
      {t.pending && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-0 top-0 w-[1.5px] bg-[color-mix(in_oklch,var(--aurora-3)_55%,transparent)]"
        >
          <span className="agent-think-shimmer" />
        </span>
      )}
      <div className="flex items-center gap-2 border-b border-[color-mix(in_oklch,var(--aurora-3)_14%,transparent)] py-1.5 pl-3 pr-1.5">
        <Languages className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-3)]" aria-hidden="true" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-[color-mix(in_oklch,var(--aurora-3)_82%,var(--ink-secondary))]">
          译文 · {t.lang === 'en' ? 'English' : '中文'}
        </span>
        {t.pending && (
          <span className="inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--aurora-3)]">
            <span className="agent-thinking-live-dot" aria-hidden="true" />
            翻译中
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5">
          {!t.pending && t.content && (
            <button
              type="button"
              onClick={copyTranslation}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]"
              aria-label={copied ? '已复制译文' : '复制译文'}
              title={copied ? '已复制' : '复制译文'}
            >
              {copied ? <Check className="h-3 w-3 text-[var(--signal-success)]" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
          {!t.pending && (
            <button
              type="button"
              onClick={() => onDismiss?.(message)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)]"
              aria-label="关闭译文"
              title="关闭译文"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
      <div className="px-3.5 py-2.5" style={fontStyle}>
        {t.error ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[11px] text-[var(--signal-warn)]">{t.error}</span>
            {onRetranslate && (
              <button
                type="button"
                onClick={() => onRetranslate(message)}
                className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--aurora-3)_40%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--aurora-3)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-3)_10%,transparent)]"
              >
                <RefreshCcw className="h-3 w-3" /> 重试
              </button>
            )}
          </div>
        ) : t.pending && !t.content ? (
          <TypingDots />
        ) : t.pending ? (
          <div className="agent-stream-caret">
            <StreamMarkdown content={t.content} />
          </div>
        ) : (
          <div className="agent-md agent-md-settle">
            <MarkdownRenderer content={t.content} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * ThinkingPanel —— Lobehub 风格统一思考面板
 *
 * 把"思考状态行"和"思考内容折叠卡"合并成一块挂在主回答正文上方的独立 UI。
 *
 * 渲染态：
 *   收起 pill（永远显示一行）
 *     · 流式 + 未首 token + 有知识检索 → "正在检索知识"（retrieval 回执还没到）
 *     · 流式 + 未首 token  → 左缘 aurora shimmer + Brain + "正在思考/等待响应"
 *     · 流式 + 已首 token  → "正在生成"
 *     · 已完成 + 有 think  → "已深度思考" + 总秒数 + N chars，可展开
 *     · 已完成 + 无 think  → "已生成" + 总秒数（不可展开）
 *     · 错误中断           → "已中断" + 秒数
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

  // 知识检索阶段：请求带知识上下文、retrieval 回执与首 token 都还没到 ——
  // 把"正在检索"显式亮出来，回答编排的第一步不再是黑盒。
  const searchingKnowledge =
    isStreaming &&
    !message.firstTokenAt &&
    !hasThink &&
    !message.retrieval &&
    message.knowledgeMode !== 'none';

  let label: string;
  if (isStreaming && hasThink && !message.firstTokenAt) {
    label = '正在思考';
  } else if (isStreaming && searchingKnowledge) {
    label = '正在检索知识';
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
      : 'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] border-[var(--ink-subtle)]/14 hover:border-[var(--aurora-1)]/30'
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
                  : 'bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] border-[var(--ink-subtle)]/15'
              }`}
            >
              {isStreaming ? (
                <div
                  className={`agent-think-md agent-stream-caret agent-stream-fade${
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
  if (a.allowAdminHref !== b.allowAdminHref) return false;
  // 父级用 useCallback 稳定回调 —— 引用不变就视为等价；
  // 真要变（比如父切了 active session）也通常伴随 busy 或 message 变化。
  if (a.onEdit !== b.onEdit || a.onRetry !== b.onRetry) return false;
  if (
    a.onTranslate !== b.onTranslate ||
    a.onDismissTranslation !== b.onDismissTranslation ||
    a.onQuote !== b.onQuote ||
    a.onFork !== b.onFork ||
    a.onDelete !== b.onDelete ||
    a.resolveModelLabel !== b.resolveModelLabel
  ) {
    return false;
  }
  if (ma === mb) return true;
  if (
    ma.id === mb.id &&
    ma.content === mb.content &&
    ma.think === mb.think &&
    ma.pending === mb.pending &&
    ma.error === mb.error &&
    ma.errorCode === mb.errorCode &&
    ma.finishedAt === mb.finishedAt &&
    ma.firstTokenAt === mb.firstTokenAt &&
    ma.sources === mb.sources &&
    ma.retrieval === mb.retrieval &&
    ma.translation === mb.translation &&
    ma.modelId === mb.modelId &&
    ma.providerCode === mb.providerCode &&
    ma.knowledgeMode === mb.knowledgeMode
  ) {
    return true;
  }
  return false;
}

export default memo(MessageBubbleBase, areEqual);
