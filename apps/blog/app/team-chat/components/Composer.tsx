'use client';

import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowUp } from 'lucide-react';
import { spring } from '@aetherblog/ui';

interface Props {
  disabled?: boolean;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  /** 输入活动信号：true=正在输入，false=停止。由父级转成 WebSocket typing 信令。 */
  onTyping: (active: boolean) => void;
}

const TYPING_STOP_DELAY = 2_500;

/**
 * 消息输入器：回车发送、Shift+回车换行、附件上传，输入时发出「正在输入」信号
 * （微信式打字提示）—— 停止输入 2.5s 后自动收回。输入框随内容自增高至上限。
 */
export default function Composer({ disabled, onSend, onUpload, onTyping }: Props) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signalTyping = useCallback(() => {
    if (!typingRef.current) {
      typingRef.current = true;
      onTyping(true);
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      typingRef.current = false;
      onTyping(false);
    }, TYPING_STOP_DELAY);
  }, [onTyping]);

  const stopTyping = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (typingRef.current) {
      typingRef.current = false;
      onTyping(false);
    }
  }, [onTyping]);

  // 随内容自增高（上限 160px），发送后复位。
  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    stopTyping();
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
  }, [text, disabled, onSend, stopTyping]);

  const canSend = !!text.trim() && !disabled;

  return (
    <div className="shrink-0 px-3 pb-3 pt-2">
      <div className="flex items-end gap-2 rounded-[1.5rem] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-2 py-1.5 transition-colors focus-within:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-40"
          aria-label="上传附件"
          title="图片 / 文件 / 语音"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          ref={taRef}
          value={text}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? '选择一个会话开始聊天' : '输入消息…'}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
            signalTyping();
          }}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent py-1.5 text-[15px] leading-relaxed text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-subtle)] disabled:opacity-50"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.88 }}
          transition={spring.precise}
          disabled={!canSend}
          onClick={submit}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]"
          style={{
            background: canSend ? 'var(--aurora-1)' : 'color-mix(in oklch, var(--ink-primary) 12%, transparent)',
            color: canSend ? 'var(--bg-void)' : 'var(--ink-subtle)',
          }}
          aria-label="发送"
        >
          <ArrowUp size={18} />
        </motion.button>
      </div>
      <p className="mt-1.5 px-3 font-mono text-[10px] tracking-wide text-[var(--ink-subtle)]">
        Enter 发送 · Shift + Enter 换行
      </p>
    </div>
  );
}
