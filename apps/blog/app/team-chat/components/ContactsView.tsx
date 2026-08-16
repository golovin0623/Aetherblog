'use client';

import { useMemo } from 'react';
import { Bot, MessageCircle, Sparkles, Users } from 'lucide-react';
import { Avatar } from '@aetherblog/ui';
import type { ChatAgent, ChatConversation, ChatMember } from '../lib/types';

interface Props {
  conversations: ChatConversation[];
  agents: ChatAgent[];
  onlineUserIds: Set<number>;
  currentUserId: number;
  onOpenDirect: (userId: number) => void;
  /** 点击智能体：提示在会话中 @ 或纳入（智能体没有独立私聊信道）。 */
  onAgentHint: (agent: ChatAgent) => void;
}

/**
 * 联系人视图 —— 设计规范 §1「功能定义」：不做好友申请链路，
 * 联系人 = 会话成员目录（聚合去重）+ 智能体席位（/agents）。
 * 点击成员即 openDirect 复用现有端点，零新后端。
 */
export default function ContactsView({
  conversations,
  agents,
  onlineUserIds,
  currentUserId,
  onOpenDirect,
  onAgentHint,
}: Props) {
  const people = useMemo(() => {
    const map = new Map<number, ChatMember>();
    for (const c of conversations) {
      for (const m of c.members ?? []) {
        if (m.userId !== currentUserId && !map.has(m.userId)) map.set(m.userId, m);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ao = onlineUserIds.has(a.userId) ? 0 : 1;
      const bo = onlineUserIds.has(b.userId) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.nickname || a.username).localeCompare(b.nickname || b.username, 'zh-Hans-CN');
    });
  }, [conversations, currentUserId, onlineUserIds]);

  const activeAgents = useMemo(() => agents.filter((a) => a.status === 'ACTIVE'), [agents]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
      <p className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        <Users size={10} />
        团队成员 · {people.length}
      </p>
      {people.length === 0 ? (
        <p className="px-3 py-8 text-center text-[12.5px] leading-relaxed text-[var(--ink-muted)]">
          还没有共同会话的成员。
          <br />
          发起会话后，联系人会自动出现在这里。
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {people.map((m) => {
            const online = onlineUserIds.has(m.userId);
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => onOpenDirect(m.userId)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_80%,transparent)] px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
              >
                <span className="relative shrink-0">
                  <Avatar src={m.avatar} fallback={m.nickname || m.username} size="md" />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
                    style={{
                      borderColor: 'var(--bg-leaf)',
                      background: online ? 'var(--signal-success)' : 'var(--ink-subtle)',
                    }}
                    aria-label={online ? '在线' : '离线'}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[var(--ink-primary)]">
                    {m.nickname || m.username}
                  </span>
                  <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">
                    {m.memberRole} · {online ? '在线' : '离线'}
                  </span>
                </span>
                <MessageCircle
                  size={16}
                  className="shrink-0 text-[var(--ink-subtle)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--aurora-1)]"
                />
              </button>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        <Sparkles size={10} />
        智能体席位 · {activeAgents.length}
      </p>
      {activeAgents.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12.5px] text-[var(--ink-muted)]">暂无可用智能体</p>
      ) : (
        <div className="flex flex-col gap-1">
          {activeAgents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAgentHint(a)}
              className="group flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_80%,transparent)] px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)', color: 'var(--aurora-1)' }}
              >
                <Bot size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--ink-primary)]">
                  <span className="truncate">{a.name}</span>
                  <span
                    className="shrink-0 rounded px-1 py-px font-mono text-[8.5px] uppercase tracking-wider"
                    style={{ background: 'color-mix(in oklch, var(--aurora-2) 22%, transparent)', color: 'var(--aurora-1)' }}
                  >
                    AI
                  </span>
                </span>
                <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">
                  {a.description || '常驻智能体'} · 可 @ 提及
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{a.scope}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
