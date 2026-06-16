'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi } from '../lib/chatApi';
import type { ChatAgent } from '../lib/types';

interface Props {
  conversationId: number;
}

/**
 * 会话内的智能体栏：展示已纳入的 Agent，可纳入 / 移除，并以 Agent 身份发言
 * （人工操作 Agent 人设；Phase 3 起 AI 自动回复复用同一后端路径）。
 */
export default function AgentBar({ conversationId }: Props) {
  const [seated, setSeated] = useState<ChatAgent[]>([]);
  const [available, setAvailable] = useState<ChatAgent[]>([]);
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // 点击选择器外部 / 按 Esc 关闭。
  useEffect(() => {
    if (!picking) return;
    const onPointer = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPicking(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicking(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [picking]);

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
    try {
      const all = await chatApi.listAgents();
      const seatedIds = new Set(seated.map((a) => a.id));
      setAvailable(all.filter((a) => a.status === 'ACTIVE' && !seatedIds.has(a.id)));
      setPicking(true);
    } catch (e) {
      window.alert((e as Error).message);
    }
  }, [seated]);

  const seat = useCallback(
    async (agentId: number) => {
      try {
        await chatApi.seatAgent(conversationId, agentId);
        setPicking(false);
        await refresh();
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
    [conversationId, refresh],
  );

  const unseat = useCallback(
    async (agent: ChatAgent) => {
      if (!window.confirm(`将「${agent.name}」移出会话？`)) return;
      try {
        await chatApi.unseatAgent(conversationId, agent.id);
        await refresh();
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
    [conversationId, refresh],
  );

  // 以 Agent 身份发言（MVP：prompt 录入；消息经 WebSocket 实时扇出给会话成员）。
  const speakAs = useCallback(
    async (agent: ChatAgent) => {
      const text = window.prompt(`以「${agent.name}」身份发送：`);
      if (!text || !text.trim()) return;
      try {
        await chatApi.postAgentMessage(conversationId, agent.id, text.trim(), crypto.randomUUID());
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
    [conversationId],
  );

  return (
    <div className="relative flex flex-wrap items-center gap-2 border-b border-[var(--ink-subtle)] px-4 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        智能体
      </span>
      {seated.map((a) => (
        <span
          key={a.id}
          className="group inline-flex items-center gap-1 rounded-full bg-[var(--bg-leaf)] px-2 py-1 text-xs text-[var(--ink-primary)]"
        >
          <button type="button" onClick={() => speakAs(a)} title="以该智能体身份发言">
            🤖 {a.name}
          </button>
          <button
            type="button"
            onClick={() => unseat(a)}
            className="text-[var(--ink-muted)] hover:text-[var(--signal-danger)]"
            aria-label="移出会话"
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={openPicker}
          className="rounded-full border border-[var(--ink-subtle)] px-2 py-1 text-xs text-[var(--ink-secondary)] transition hover:bg-[var(--bg-leaf)]"
        >
          ＋ 纳入智能体
        </button>

        {picking && (
          <div className="absolute left-0 top-full z-10 mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-[var(--ink-subtle)] bg-[var(--bg-raised)] p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-xs text-[var(--ink-muted)]">选择智能体</span>
              <button type="button" onClick={() => setPicking(false)} className="text-[var(--ink-muted)]">
                ×
              </button>
            </div>
            {available.length === 0 ? (
              <p className="px-1 py-2 text-xs text-[var(--ink-muted)]">没有可纳入的智能体</p>
            ) : (
              available.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => seat(a.id)}
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-[var(--ink-primary)] transition hover:bg-[var(--bg-leaf)]"
                  title={a.description || a.name}
                >
                  🤖 {a.name}
                  <span className="ml-1 text-[10px] text-[var(--ink-muted)]">{a.scope}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
