'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, User, Users } from 'lucide-react';
import { Avatar, Modal, spring } from '@aetherblog/ui';
import { useDebounce } from '@aetherblog/hooks';
import { chatApi } from '../lib/chatApi';
import type { ChatDMTarget, ChatMyTeam } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 打开会话：'u' 私聊目标用户，'t' 团队群聊。抛错时由本组件就地展示。 */
  onCreate: (kind: 'u' | 't', id: number) => Promise<void>;
}

const KINDS = [
  { k: 'u' as const, label: '私聊', icon: User },
  { k: 't' as const, label: '群聊', icon: Users },
];

/**
 * 发起会话弹层 —— 选人式交互（对齐 Slack / Mattermost：目录搜索选人，不暴露数字 ID）。
 * 私聊：按昵称 / 用户名搜索，结果由服务端 chat_dm_scope 策略过滤（搜得到 ⇔ 打得开）；
 * 群聊：直接列出我所在的团队点选。
 */
export default function NewConversationModal({ open, onClose, onCreate }: Props) {
  const [kind, setKind] = useState<'u' | 't'>('u');
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<ChatDMTarget[]>([]);
  const [teams, setTeams] = useState<ChatMyTeam[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const debouncedQuery = useDebounce(query.trim(), 250);
  // 竞态守卫：只采纳最后一次搜索的结果。
  const searchSeq = useRef(0);

  // 弹层每次打开重置为初始态。
  useEffect(() => {
    if (open) {
      setKind('u');
      setQuery('');
      setTargets([]);
      setError('');
      setBusyId(null);
    }
  }, [open]);

  // 私聊：防抖搜索。空查询清空结果（服务端同样拒绝空查询目录 dump）。
  useEffect(() => {
    if (!open || kind !== 'u') return;
    if (!debouncedQuery) {
      setTargets([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    chatApi
      .searchDMTargets(debouncedQuery)
      .then((list) => {
        if (searchSeq.current === seq) setTargets(list ?? []);
      })
      .catch((e) => {
        if (searchSeq.current === seq) setError((e as Error).message || '搜索失败');
      })
      .finally(() => {
        if (searchSeq.current === seq) setSearching(false);
      });
  }, [open, kind, debouncedQuery]);

  // 群聊：首次切到该 tab 时加载我的团队。
  useEffect(() => {
    if (!open || kind !== 't' || teams !== null) return;
    chatApi
      .listMyTeams()
      .then((list) => setTeams(list ?? []))
      .catch((e) => {
        setTeams([]);
        setError((e as Error).message || '团队列表加载失败');
      });
  }, [open, kind, teams]);

  const pick = async (k: 'u' | 't', id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    setError('');
    try {
      await onCreate(k, id);
      onClose();
    } catch (e) {
      setError((e as Error).message || '打开会话失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="发起会话" size="sm">
      <div className="flex flex-col gap-4">
        {/* 类型切换 —— iOS 风格分段控制器。
            指示器用单元素 transform 滑动，禁止 layoutId：共享布局元素在 AnimatePresence
            退出子树中重挂载会卡死退出流程（fm11 已知缺陷），弹窗残留隐形遮罩挡死整页。 */}
        <div className="relative grid grid-cols-2 rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-1">
          <motion.span
            aria-hidden
            initial={false}
            animate={{ x: kind === 'u' ? '0%' : '100%' }}
            transition={spring.precise}
            className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl"
            style={{ background: 'var(--aurora-1)' }}
          />
          {KINDS.map((opt) => {
            const on = kind === opt.k;
            const Icon = opt.icon;
            return (
              <button
                key={opt.k}
                type="button"
                onClick={() => {
                  setKind(opt.k);
                  setError('');
                }}
                className="relative z-10 flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium transition-colors"
                style={{ color: on ? 'var(--bg-void)' : 'var(--ink-secondary)' }}
              >
                <Icon size={15} />
                {opt.label}
              </button>
            );
          })}
        </div>

        {kind === 'u' && (
          <div
            data-field
            className="flex items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2.5 transition-colors focus-within:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
          >
            <Search size={15} className="shrink-0 text-[var(--ink-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError('');
              }}
              placeholder="搜索昵称或用户名"
              aria-label="搜索私聊对象"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-subtle)]"
            />
          </div>
        )}

        {/* 结果区：固定高度滚动，避免弹层随结果抖动 */}
        <div className="flex max-h-64 min-h-[9rem] flex-col gap-1 overflow-y-auto">
          {kind === 'u' ? (
            searching ? (
              // 骨架屏（禁止 spinner）：与结果行同构的占位 + pulse
              Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="flex animate-pulse items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-3 py-2.5"
                >
                  <span className="h-9 w-9 shrink-0 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="h-3 w-24 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
                    <span className="h-2.5 w-16 rounded bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
                  </span>
                </div>
              ))
            ) : targets.length > 0 ? (
              targets.map((t) => (
                <button
                  key={t.userId}
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void pick('u', t.userId)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] disabled:opacity-60"
                >
                  <Avatar src={t.avatar} fallback={t.nickname || t.username} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[var(--ink-primary)]">
                      {t.nickname || t.username}
                    </span>
                    <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">@{t.username}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--ink-subtle)] transition-colors group-hover:text-[var(--aurora-1)]">
                    {busyId === t.userId ? '打开中…' : '私聊'}
                  </span>
                </button>
              ))
            ) : (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-[12.5px] leading-relaxed text-[var(--ink-muted)]">
                {debouncedQuery ? '没有可私聊的匹配成员。' : '输入昵称或用户名搜索成员开始私聊。'}
              </p>
            )
          ) : teams === null ? (
            Array.from({ length: 2 }, (_, i) => (
              <div
                key={i}
                className="flex animate-pulse items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-3 py-2.5"
              >
                <span className="h-9 w-9 shrink-0 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
                <span className="h-3 w-28 rounded bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
              </div>
            ))
          ) : teams.length > 0 ? (
            teams.map((t) => (
              <button
                key={t.teamId}
                type="button"
                disabled={busyId !== null}
                onClick={() => void pick('t', t.teamId)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] disabled:opacity-60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]">
                  <Users size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[var(--ink-primary)]">{t.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ink-muted)]">{t.memberCount} 名成员</span>
                </span>
                <span className="shrink-0 text-[12px] text-[var(--ink-subtle)] transition-colors group-hover:text-[var(--aurora-1)]">
                  {busyId === t.teamId ? '打开中…' : '进入群聊'}
                </span>
              </button>
            ))
          ) : (
            <p className="flex flex-1 items-center justify-center px-4 text-center text-[12.5px] leading-relaxed text-[var(--ink-muted)]">
              你还不是任何团队的成员。请联系管理员加入团队。
            </p>
          )}
        </div>

        {error && <p className="text-sm text-[var(--signal-danger)]">{error}</p>}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
          >
            取消
          </button>
        </div>
      </div>
    </Modal>
  );
}
