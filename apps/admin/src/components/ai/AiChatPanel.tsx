/**
 * AI 对话历史面板
 *
 * 功能：
 * 1. 类似 ChatGPT 的对话界面
 * 2. 支持随时提问和上下文延续
 * 3. 显示对话历史
 * 4. 支持引用当前文档内容
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Send,
  User,
  Bot,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  FileText,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationMessage } from '@/types/writing-workflow';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface AiChatPanelProps {
  messages: ConversationMessage[];
  onSendMessage: (content: string, includeContext?: boolean) => Promise<void>;
  onClearHistory: () => void;
  onClose: () => void;
  currentDocumentContext?: {
    title: string;
    content: string;
    wordCount: number;
  };
}

export function AiChatPanel({
  messages,
  onSendMessage,
  onClearHistory,
  onClose,
  currentDocumentContext,
}: AiChatPanelProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [includeContext, setIncludeContext] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const messageContent = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      await onSendMessage(messageContent, includeContext);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="h-full border-l border-[var(--border-subtle)] bg-[var(--bg-card)] flex flex-col"
    >
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-[var(--text-primary)]">AI 对话</h3>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={onClearHistory}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-red-500"
                title="清空历史"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 上下文引用开关 */}
        {currentDocumentContext && (
          <label className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)] cursor-pointer group">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border-subtle)] text-primary focus:ring-primary"
            />
            <div className="flex items-center gap-2 flex-1">
              <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                  引用当前文档
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {currentDocumentContext.wordCount} 字
                </p>
              </div>
            </div>
          </label>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <Bot className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">开始与 AI 对话</p>
            <p className="text-xs mt-1">我可以帮你改进文章内容</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}

        {/* 加载指示器 */}
        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3 h-3 animate-spin text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-muted)]">AI 正在思考...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary/50 resize-none"
            rows={3}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={cn(
              'p-2.5 rounded-lg transition-all',
              input.trim() && !isLoading
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== 消息气泡组件 ====================

interface MessageBubbleProps {
  message: ConversationMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const Icon = isUser ? User : Bot;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const timeAgo = formatDistanceToNow(message.timestamp, {
    addSuffix: true,
    locale: zhCN,
  });

  return (
    <div className={cn('flex items-start gap-2', isUser && 'flex-row-reverse')}>
      {/* 头像 */}
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-blue-500/10' : 'bg-primary/10'
        )}
      >
        <Icon className={cn('w-4 h-4', isUser ? 'text-blue-500' : 'text-primary')} />
      </div>

      {/* 内容 */}
      <div className={cn('flex-1 max-w-[85%] group', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'p-3 rounded-lg border transition-all',
            isUser
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]'
          )}
        >
          <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>

          {/* 元数据 */}
          {message.metadata && (
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--text-muted)]">
                {message.metadata.tool && `工具: ${message.metadata.tool}`}
              </p>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-xs text-[var(--text-muted)]">{timeAgo}</span>
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
            title="复制"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
