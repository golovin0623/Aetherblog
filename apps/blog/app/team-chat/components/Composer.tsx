'use client';

import { useCallback, useRef, useState } from 'react';

interface Props {
  disabled?: boolean;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  /** 输入活动信号：true=正在输入，false=停止。由父级转成 WebSocket typing 信令。 */
  onTyping: (active: boolean) => void;
}

const TYPING_STOP_DELAY = 2_500;

/**
 * 消息输入器：回车发送、Shift+回车换行、附件上传，并在输入时发出「正在输入」信号
 * （微信式打字提示）—— 停止输入 2.5s 后自动收回。
 */
export default function Composer({ disabled, onSend, onUpload, onTyping }: Props) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
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

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    stopTyping();
  }, [text, disabled, onSend, stopTyping]);

  return (
    <div className="flex items-end gap-2 border-t border-[var(--ink-subtle)] p-3">
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
        className="shrink-0 rounded-full px-3 py-2 text-[var(--ink-secondary)] transition hover:bg-[var(--bg-leaf)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:opacity-40"
        aria-label="上传附件"
        title="上传图片 / 文件 / 语音"
      >
        ＋
      </button>
      <textarea
        value={text}
        disabled={disabled}
        rows={1}
        placeholder={disabled ? '选择一个会话开始聊天' : '输入消息，回车发送…'}
        onChange={(e) => {
          setText(e.target.value);
          signalTyping();
        }}
        onBlur={stopTyping}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-[var(--ink-subtle)] bg-[var(--bg-substrate)] px-4 py-2 text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)] focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled || !text.trim()}
        onClick={submit}
        className="shrink-0 rounded-2xl bg-[var(--aurora-1)] px-4 py-2 font-medium text-[var(--bg-void)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:opacity-40"
      >
        发送
      </button>
    </div>
  );
}
