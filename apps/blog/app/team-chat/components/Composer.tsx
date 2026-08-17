'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { ArrowUp, CornerUpLeft, ImagePlus, Mic, Paperclip, Pencil, Smile, Square, X } from 'lucide-react';
import { Avatar, spring } from '@aetherblog/ui';
import type { ChatAgent, ChatMember, ChatMessage } from '../lib/types';
import { isImageFile, prepareImage, splitFiles, type PreparedImage } from '../lib/imagePipeline';
import EmojiPanel from './EmojiPanel';
import { messageSummary } from './MessageThread';

const TYPING_STOP_DELAY = 2_500;
const VOICE_MAX_SEC = 60;
const VOICE_PEAK_BUCKETS = 32;

interface TrayItem {
  id: number;
  prep: PreparedImage;
  /** 0-100；仅发送中展示进度环。 */
  progress: number;
  uploading: boolean;
}

export interface ComposerHandle {
  /** 外部（拖拽遮罩）注入文件：图片进托盘，其余按文件消息直发。 */
  addFiles: (files: File[]) => void;
  focus: () => void;
  /** 草稿存取：切换会话时父级读走 / 回填输入内容。 */
  getText: () => string;
  setText: (text: string) => void;
  /**
   * 清空会话瞬态：托盘图片（revoke objectURL）、录音、面板与提及弹层。
   * 切换会话必须调用 —— 否则托盘残留会把图片发进错误的会话。
   */
  reset: () => void;
}

interface Props {
  disabled?: boolean;
  members: ChatMember[];
  agents: ChatAgent[];
  currentUserId: number;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  onCancelContext: () => void;
  onSend: (text: string, mentions: number[]) => void;
  onSendEdit: (msg: ChatMessage, text: string, mentions: number[]) => void;
  onSendSticker: (slug: string) => void;
  /** 上传并发送一张已压缩图片；onProgress 回报 0-100。 */
  onSendImage: (prep: PreparedImage, onProgress: (p: number) => void) => Promise<void>;
  onSendFile: (file: File) => void;
  onSendVoice: (blob: Blob, durationSec: number, peaks: number[]) => Promise<void>;
  onTyping: (active: boolean) => void;
  /** ↑（输入框为空）→ 编辑我的上一条。 */
  onEditLast: () => void;
  /** 非阻断提示（如麦克风权限被拒），父级转 Toast。 */
  onNotice?: (message: string) => void;
}

/**
 * 消息输入器 —— 设计规范 §3/§4/§5 的入口面：
 * 表情 / 贴纸面板、引用与编辑上下文条、图片托盘（粘贴 / 拖拽 / 多选 + 进度环）、
 * @提及弹层（方向键 + Enter 选择）、MediaRecorder 语音（波形采样写入 meta）、
 * Enter 发送 · Shift+Enter 换行 · ↑ 编辑上一条 · Esc 逐级退出。
 */
const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    disabled,
    members,
    agents,
    currentUserId,
    replyTo,
    editing,
    onCancelContext,
    onSend,
    onSendEdit,
    onSendSticker,
    onSendImage,
    onSendFile,
    onSendVoice,
    onTyping,
    onEditLast,
    onNotice,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [recording, setRecording] = useState<null | { startedAt: number; seconds: number; live: number[] }>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trayIdRef = useRef(1);
  const recRef = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    peaks: number[];
    timer: ReturnType<typeof setInterval>;
    ctx: AudioContext;
    cancelled: boolean;
  } | null>(null);

  // 编辑态进入时回填原文并聚焦。
  useEffect(() => {
    if (editing) {
      setText(editing.content || '');
      requestAnimationFrame(() => {
        autoGrow();
        taRef.current?.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  useEffect(() => {
    if (replyTo) taRef.current?.focus();
  }, [replyTo]);

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

  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // --- @提及 ---
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const humans = members
      .filter((m) => m.userId !== currentUserId)
      .map((m) => ({ key: `u-${m.userId}`, name: m.nickname || m.username, avatar: m.avatar, agent: false as const }));
    const bots = agents
      .filter((a) => a.status === 'ACTIVE')
      .map((a) => ({ key: `a-${a.id}`, name: a.name, avatar: a.avatar, agent: true as const }));
    return [...humans, ...bots].filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, members, agents, currentUserId]);

  const scanMention = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = before.match(/@([一-龥A-Za-z0-9_]*)$/);
    setMentionQuery(m ? m[1] : null);
    setMentionIdx(0);
  }, []);

  const pickMention = useCallback(
    (idx: number) => {
      const cand = mentionCandidates[idx];
      const el = taRef.current;
      if (!cand || !el) return;
      const pos = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, pos);
      const m = before.match(/@([一-龥A-Za-z0-9_]*)$/);
      if (!m) return;
      const start = pos - m[0].length;
      const next = `${el.value.slice(0, start)}@${cand.name} ${el.value.slice(pos)}`;
      setText(next);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        const np = start + cand.name.length + 2;
        el.setSelectionRange(np, np);
        el.focus();
        autoGrow();
      });
    },
    [mentionCandidates, autoGrow],
  );

  /**
   * 发送时从文本反解 @提及 → 会话成员 userId（服务端再过滤一次）。
   * 完整定界匹配：`@名字` 后必须是非词字符 / 行尾 —— 否则 `@Anna` 会同时命中
   * 前缀成员 `Ann`，给无关成员误发 @我 徽标（评审 P2）。
   */
  const extractMentions = useCallback(
    (content: string): number[] => {
      const out: number[] = [];
      for (const m of members) {
        if (m.userId === currentUserId) continue;
        const name = m.nickname || m.username;
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`@${escaped}(?![一-龥A-Za-z0-9_])`, 'u').test(content)) out.push(m.userId);
      }
      return out;
    },
    [members, currentUserId],
  );

  // --- 图片托盘 ---
  const addImages = useCallback(async (files: File[]) => {
    for (const f of files) {
      const prep = await prepareImage(f);
      setTray((prev) => [...prev, { id: trayIdRef.current++, prep, progress: 0, uploading: false }]);
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const { images, others } = splitFiles(files);
      if (images.length) void addImages(images);
      others.forEach((f) => onSendFile(f));
    },
    [disabled, addImages, onSendFile],
  );

  // useImperativeHandle 在 stopRecording 定义之后统一挂出（reset 依赖它）。

  const removeTray = useCallback((id: number) => {
    setTray((prev) => {
      const item = prev.find((t) => t.id === id);
      if (item) URL.revokeObjectURL(item.prep.previewUrl);
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  // --- 发送 ---
  const submit = useCallback(async () => {
    if (disabled || sending) return;
    const trimmed = text.trim();

    if (editing) {
      if (!trimmed) return;
      onSendEdit(editing, trimmed, extractMentions(trimmed));
      setText('');
      stopTyping();
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = 'auto';
      });
      return;
    }

    if (!trimmed && tray.length === 0) return;
    setSending(true);
    try {
      // 图片先行（与微信一致：图文一起发时图在前），逐张上传 + 进度环。
      for (const item of tray) {
        setTray((prev) => prev.map((t) => (t.id === item.id ? { ...t, uploading: true } : t)));
        try {
          await onSendImage(item.prep, (p) =>
            setTray((prev) => prev.map((t) => (t.id === item.id ? { ...t, progress: p } : t))),
          );
          URL.revokeObjectURL(item.prep.previewUrl);
          setTray((prev) => prev.filter((t) => t.id !== item.id));
        } catch {
          // 失败留在托盘可重试（进度归零），不产生幽灵消息。
          setTray((prev) => prev.map((t) => (t.id === item.id ? { ...t, uploading: false, progress: 0 } : t)));
        }
      }
      if (trimmed) {
        onSend(trimmed, extractMentions(trimmed));
        setText('');
      }
    } finally {
      setSending(false);
      stopTyping();
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = 'auto';
      });
    }
  }, [disabled, sending, text, tray, editing, onSendEdit, onSendImage, onSend, extractMentions, stopTyping]);

  // --- 语音（MediaRecorder + AnalyserNode 波形采样） ---
  const stopRecording = useCallback((send: boolean) => {
    const rec = recRef.current;
    if (!rec) return;
    rec.cancelled = !send;
    clearInterval(rec.timer);
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    void rec.ctx.close().catch(() => {});
  }, []);

  const startRecording = useCallback(async () => {
    if (recording || disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const startedAt = Date.now();
      const rec = { recorder, stream, chunks: [] as Blob[], peaks: [] as number[], ctx, cancelled: false, timer: setInterval(() => {}, 1e9) };
      clearInterval(rec.timer);
      rec.timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] - 128) / 128);
        rec.peaks.push(Math.min(1, max * 1.6));
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        setRecording({ startedAt, seconds, live: rec.peaks.slice(-22) });
        if (seconds >= VOICE_MAX_SEC) stopRecording(true);
      }, 150);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) rec.chunks.push(e.data);
      };
      recorder.onstop = () => {
        setRecording(null);
        const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        if (!rec.cancelled && rec.chunks.length) {
          const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' });
          // 压到固定桶数，接收端逐段点亮。
          const peaks: number[] = [];
          const bucket = Math.max(1, Math.floor(rec.peaks.length / VOICE_PEAK_BUCKETS));
          for (let i = 0; i < rec.peaks.length; i += bucket) {
            peaks.push(Math.max(...rec.peaks.slice(i, i + bucket)));
            if (peaks.length >= VOICE_PEAK_BUCKETS) break;
          }
          void onSendVoice(blob, durationSec, peaks.map((p) => Math.round(p * 100) / 100));
        }
        recRef.current = null;
      };
      recRef.current = rec;
      recorder.start();
      setRecording({ startedAt, seconds: 0, live: [] });
    } catch {
      // 无麦克风权限 / Permissions-Policy 拦截 —— 给出可见提示而非静默（评审 P1）。
      onNotice?.('无法访问麦克风：请检查浏览器地址栏的麦克风权限后重试。');
    }
  }, [recording, disabled, stopRecording, onSendVoice, onNotice]);

  useEffect(() => () => stopRecording(false), [stopRecording]);

  useImperativeHandle(
    ref,
    () => ({
      addFiles,
      focus: () => taRef.current?.focus(),
      getText: () => taRef.current?.value ?? '',
      setText: (t: string) => {
        setText(t);
        requestAnimationFrame(() => {
          autoGrow();
          if (t) taRef.current?.focus();
        });
      },
      reset: () => {
        setTray((prev) => {
          prev.forEach((t) => URL.revokeObjectURL(t.prep.previewUrl));
          return [];
        });
        setPanelOpen(false);
        setMentionQuery(null);
        stopRecording(false);
      },
    }),
    [addFiles, autoGrow, stopRecording],
  );

  const canSend = (!!text.trim() || tray.length > 0) && !disabled && !sending;
  const ctxMsg = editing || replyTo;

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-2">
      <EmojiPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onPickEmoji={(emoji) => {
          const el = taRef.current;
          const pos = el?.selectionStart ?? text.length;
          const next = text.slice(0, pos) + emoji + text.slice(pos);
          setText(next);
          requestAnimationFrame(() => {
            if (el) {
              const np = pos + emoji.length;
              el.setSelectionRange(np, np);
              el.focus();
              autoGrow();
            }
          });
        }}
        onPickSticker={(slug) => {
          setPanelOpen(false);
          onSendSticker(slug);
        }}
      />

      {/* @提及弹层 */}
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div
          className="absolute bottom-full left-12 z-[31] mb-2 w-[230px] rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)] p-1 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.55)] backdrop-blur-[40px] backdrop-saturate-[160%]"
          role="listbox"
          aria-label="提及成员"
        >
          {mentionCandidates.map((c, i) => (
            <button
              key={c.key}
              type="button"
              role="option"
              aria-selected={i === mentionIdx}
              onMouseEnter={() => setMentionIdx(i)}
              onClick={() => pickMention(i)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--ink-primary)]"
              style={i === mentionIdx ? { background: 'color-mix(in oklch, var(--aurora-1) 12%, transparent)' } : undefined}
            >
              <Avatar src={c.avatar} fallback={c.name} size="sm" />
              <span className="min-w-0 truncate">{c.name}</span>
              {c.agent && (
                <span
                  className="rounded px-1 py-px font-mono text-[8.5px] uppercase tracking-wider"
                  style={{ background: 'color-mix(in oklch, var(--aurora-2) 22%, transparent)', color: 'var(--aurora-1)' }}
                >
                  AI
                </span>
              )}
              <span className="ml-auto font-mono text-[9.5px] text-[var(--ink-muted)]">{c.agent ? 'agent' : 'member'}</span>
            </button>
          ))}
        </div>
      )}

      {/* 引用 / 编辑上下文条 */}
      {ctxMsg && (
        <div
          className="mx-1 mb-2 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] text-[var(--ink-secondary)]"
          style={{
            background: 'color-mix(in oklch, var(--aurora-1) 8%, transparent)',
            borderLeft: '2.5px solid var(--aurora-1)',
          }}
        >
          {editing ? (
            <Pencil size={14} className="shrink-0" style={{ color: 'var(--aurora-1)' }} />
          ) : (
            <CornerUpLeft size={14} className="shrink-0" style={{ color: 'var(--aurora-1)' }} />
          )}
          <span className="min-w-0 flex-1 truncate">
            <b className="block text-[11px] font-medium" style={{ color: 'var(--aurora-1)' }}>
              {editing ? '编辑消息' : `回复 ${replyTo?.senderName || '成员'}`}
            </b>
            {messageSummary(ctxMsg)}
          </span>
          <button
            type="button"
            onClick={() => {
              // 取消编辑必须同时清掉回填的旧正文 —— 否则下一次 Enter 会把旧消息重复发送（评审 P2）。
              if (editing) setText('');
              onCancelContext();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
            aria-label="取消"
            title="取消 (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* 图片托盘 */}
      {tray.length > 0 && (
        <div className="mx-1 mb-2 flex flex-wrap gap-2">
          {tray.map((t) => (
            <span
              key={t.id}
              className="relative h-[62px] w-[62px] overflow-hidden rounded-[10px] border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[var(--bg-leaf)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- objectURL 本地预览 */}
              <img src={t.prep.previewUrl} alt="待发送图片" className="h-full w-full object-cover" />
              {t.uploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-[rgba(5,6,10,0.4)]">
                  <svg viewBox="0 0 36 36" className="h-[26px] w-[26px] -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" stroke="rgba(244,239,230,0.25)" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      strokeWidth="3"
                      stroke="#F4EFE6"
                      strokeLinecap="round"
                      strokeDasharray="94.2"
                      strokeDashoffset={94.2 * (1 - t.progress / 100)}
                      style={{ transition: 'stroke-dashoffset 120ms linear' }}
                    />
                  </svg>
                </span>
              )}
              {!t.uploading && (
                <button
                  type="button"
                  onClick={() => removeTray(t.id)}
                  className="absolute right-[3px] top-[3px] flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[rgba(5,6,10,0.62)] text-[#F4EFE6] backdrop-blur-[4px]"
                  aria-label="移除"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div
        data-field
        className="flex items-end gap-1 rounded-[1.5rem] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-2 py-1.5 transition-all focus-within:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_10%,transparent)]"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          id="chat-any-file"
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) (isImageFile(f) ? addFiles([f]) : onSendFile(f));
            e.target.value = '';
          }}
        />

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setPanelOpen((v) => !v);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-40"
            aria-label="表情与贴纸"
            title="表情与贴纸"
          >
            <Smile size={18} />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-40"
            aria-label="发送图片"
            title="图片 —— 也可直接粘贴 / 拖拽"
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => document.getElementById('chat-any-file')?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-40"
            aria-label="发送文件"
            title="文件"
          >
            <Paperclip size={18} />
          </button>
        </div>

        {recording ? (
          <div className="flex min-h-[2.25rem] flex-1 items-center gap-3 px-2">
            <span className="h-[9px] w-[9px] animate-pulse rounded-full" style={{ background: 'var(--signal-danger)' }} />
            <span className="font-mono text-[13px] text-[var(--ink-primary)] [font-feature-settings:'tnum'_1]">
              {Math.floor(recording.seconds / 60)}:{String(recording.seconds % 60).padStart(2, '0')}
            </span>
            <span className="flex h-[22px] max-w-[140px] flex-1 items-center gap-[2px]" style={{ color: 'var(--aurora-1)' }} aria-hidden>
              {recording.live.map((p, i) => (
                <span key={i} className="w-[2.5px] rounded-sm bg-current" style={{ height: `${Math.max(4, p * 20)}px` }} />
              ))}
            </span>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="text-[12px] text-[var(--ink-muted)] underline underline-offset-2"
            >
              取消
            </button>
          </div>
        ) : (
          <textarea
            ref={taRef}
            value={text}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? '选择一个会话开始聊天' : '写点什么… (@ 可提及成员或智能体)'}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
              signalTyping();
              scanMention();
            }}
            onClick={scanMention}
            onBlur={stopTyping}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) {
                e.preventDefault();
                addFiles(Array.from(files));
              }
            }}
            onKeyDown={(e) => {
              if (mentionQuery !== null && mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pickMention(mentionIdx);
                  return;
                }
                if (e.key === 'Escape') {
                  setMentionQuery(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              } else if (e.key === 'ArrowUp' && !text && !editing) {
                e.preventDefault();
                onEditLast();
              } else if (e.key === 'Escape') {
                if (panelOpen) setPanelOpen(false);
                else if (ctxMsg) {
                  onCancelContext();
                  if (editing) setText('');
                }
              }
            }}
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent py-1.5 text-[15px] leading-relaxed text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-subtle)] disabled:opacity-50"
          />
        )}

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => (recording ? stopRecording(true) : void startRecording())}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:opacity-40"
            style={
              recording
                ? { background: 'color-mix(in oklch, var(--signal-danger) 16%, transparent)', color: 'var(--signal-danger)' }
                : { color: 'var(--ink-muted)' }
            }
            aria-label={recording ? '停止并发送语音' : '录制语音'}
            title={recording ? '停止并发送' : '语音消息'}
          >
            {recording ? <Square size={15} /> : <Mic size={18} />}
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.88 }}
            transition={spring.precise}
            disabled={!canSend}
            onClick={() => void submit()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]"
            style={{
              background: canSend ? 'var(--aurora-1)' : 'color-mix(in oklch, var(--ink-primary) 12%, transparent)',
              color: canSend ? 'var(--bg-void)' : 'var(--ink-subtle)',
              boxShadow: canSend ? '0 0 16px -2px color-mix(in oklch, var(--aurora-1) 55%, transparent)' : 'none',
            }}
            aria-label={editing ? '保存编辑' : '发送'}
          >
            <ArrowUp size={18} />
          </motion.button>
        </div>
      </div>
      <p className="mt-1.5 flex justify-between px-3 font-mono text-[10px] tracking-wide text-[var(--ink-subtle)]">
        <span>Enter 发送 · Shift+Enter 换行 · ↑ 编辑上一条</span>
        {recording && <span style={{ color: 'var(--signal-warn)' }}>最长 {VOICE_MAX_SEC}s</span>}
      </p>
    </div>
  );
});

export default Composer;
