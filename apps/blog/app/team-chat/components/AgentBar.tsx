'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Plus, Sparkles, X } from 'lucide-react';
import { ConfirmModal, Modal, spring } from '@aetherblog/ui';
import { chatApi } from '../lib/chatApi';
import { newClientId } from '../lib/ids';
import type { ChatAgent } from '../lib/types';

interface Props {
  conversationId: number;
}

/**
 * 会话内智能体栏：展示已入座 Agent，可纳入 / 移除，并以 Agent 身份发言
 * （人工操作 Agent 人设；Phase 3 起 AI 自动回复复用同一后端路径）。
 * 所有交互走共享 Modal / ConfirmModal —— 不使用浏览器原生 prompt / confirm / alert。
 */
export default function AgentBar({ conversationId }: Props) {
  const [seated, setSeated] = useState<ChatAgent[]>([]);
  const [available, setAvailable] = useState<ChatAgent[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speakAgent, setSpeakAgent] = useState<ChatAgent | null>(null);
  const [removeAgent, setRemoveAgent] = useState<ChatAgent | null>(null);
  const [speakText, setSpeakText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const speakRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSeated(await chatApi.listConversationAgents(conversationId));
    } catch {
      /* ignore */
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openPicker = useCallback(async () => {
    setError('');
    try {
      const all = await chatApi.listAgents();
      const seatedIds = new Set(seated.map((a) => a.id));
      setAvailable(all.filter((a) => a.status === 'ACTIVE' && !seatedIds.has(a.id)));
      setPickerOpen(true);
    } catch (e) {
      setError((e as Error).message);
      setPickerOpen(true);
    }
  }, [seated]);

  const seat = useCallback(
    async (agentId: number) => {
      setBusy(true);
      try {
        await chatApi.seatAgent(conversationId, agentId);
        setPickerOpen(false);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [conversationId, refresh],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeAgent) return;
    try {
      await chatApi.unseatAgent(conversationId, removeAgent.id);
      await refresh();
    } catch {
      /* ignore */
    } finally {
      setRemoveAgent(null);
    }
  }, [removeAgent, conversationId, refresh]);

  const sendAs = useCallback(async () => {
    if (busy || !speakAgent) return;
    const text = speakText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await chatApi.postAgentMessage(conversationId, speakAgent.id, text, newClientId());
      setSpeakAgent(null);
      setSpeakText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, speakAgent, speakText, conversationId]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        <Sparkles size={12} />
        智能体
      </span>

      {seated.map((a) => (
        <span
          key={a.id}
          className="group inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-1 text-[13px] text-[var(--ink-primary)]"
          style={{ background: 'color-mix(in oklch, var(--aurora-1) 12%, transparent)' }}
        >
          <button
            type="button"
            onClick={() => {
              setError('');
              setSpeakText('');
              setSpeakAgent(a);
            }}
            className="inline-flex items-center gap-1.5"
            title="以该智能体身份发言"
          >
            <Bot size={14} style={{ color: 'var(--aurora-1)' }} />
            {a.name}
          </button>
          <button
            type="button"
            onClick={() => setRemoveAgent(a)}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors hover:text-[var(--signal-danger)]"
            aria-label={`移出 ${a.name}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={() => void openPicker()}
        className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] py-1 pl-2 pr-2.5 text-[13px] text-[var(--ink-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] hover:text-[var(--aurora-1)]"
      >
        <Plus size={14} />
        纳入智能体
      </button>

      {/* 纳入选择器 */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="纳入智能体" size="sm">
        <div className="flex flex-col gap-1">
          {error && <p className="mb-2 text-sm text-[var(--signal-danger)]">{error}</p>}
          {available.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--ink-muted)]">没有可纳入的智能体</p>
          ) : (
            available.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => void seat(a.id)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] disabled:opacity-50"
                title={a.description || a.name}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)', color: 'var(--aurora-1)' }}
                >
                  <Bot size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--ink-primary)]">{a.name}</span>
                  {a.description && (
                    <span className="block truncate text-[12px] text-[var(--ink-muted)]">{a.description}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                  {a.scope}
                </span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* 以 Agent 身份发言 */}
      <Modal
        isOpen={!!speakAgent}
        onClose={() => setSpeakAgent(null)}
        title={speakAgent ? `以「${speakAgent.name}」身份发送` : ''}
        size="md"
      >
        <div className="flex flex-col gap-4">
          {error && <p className="text-sm text-[var(--signal-danger)]">{error}</p>}
          <textarea
            ref={speakRef}
            autoFocus
            rows={4}
            value={speakText}
            onChange={(e) => setSpeakText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAs();
            }}
            placeholder="输入要以该智能体身份发送的内容…"
            className="w-full resize-none rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-4 py-3 text-[15px] leading-relaxed text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-subtle)] focus:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
          />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘/Ctrl + Enter 发送</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSpeakAgent(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
              >
                取消
              </button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={spring.precise}
                disabled={busy || !speakText.trim()}
                onClick={() => void sendAs()}
                className="rounded-xl px-5 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: 'var(--aurora-1)', color: 'var(--bg-void)' }}
              >
                {busy ? '发送中…' : '发送'}
              </motion.button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!removeAgent}
        title="移出智能体"
        message={removeAgent ? `将「${removeAgent.name}」移出本会话？历史消息保留。` : ''}
        confirmText="移出"
        cancelText="取消"
        variant="warning"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveAgent(null)}
      />
    </div>
  );
}
