'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Users } from 'lucide-react';
import { Modal, spring } from '@aetherblog/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 打开会话：'u' 按用户 ID 私聊，'t' 按团队 ID 群聊。抛错时由本组件就地展示。 */
  onCreate: (kind: 'u' | 't', id: number) => Promise<void>;
}

const KINDS = [
  { k: 'u' as const, label: '私聊', icon: User, hint: '对方用户 ID', placeholder: '例如 1024' },
  { k: 't' as const, label: '群聊', icon: Users, hint: '团队 ID', placeholder: '例如 7' },
];

/**
 * 发起会话弹层 —— 取代原 window.prompt。分段切换私聊 / 群聊，输入数字 ID 打开。
 * （后端 MVP 以数字 ID 定位；按用户名搜索为后续增强。）
 */
export default function NewConversationModal({ open, onClose, onCreate }: Props) {
  const [kind, setKind] = useState<'u' | 't'>('u');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = KINDS.find((x) => x.k === kind)!;

  const submit = async () => {
    const id = Number(value.trim());
    if (!id || id <= 0) {
      setError('请输入有效的数字 ID');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onCreate(kind, id);
      setValue('');
      onClose();
    } catch (e) {
      setError((e as Error).message || '打开会话失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="发起会话" size="sm">
      <div className="flex flex-col gap-5">
        {/* 类型切换 —— iOS 风格分段控制器 */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-1">
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
                {on && (
                  <motion.span
                    layoutId="new-conv-seg"
                    transition={spring.precise}
                    className="absolute inset-0 -z-10 rounded-xl"
                    style={{ background: 'var(--aurora-1)' }}
                    aria-hidden
                  />
                )}
                <Icon size={15} />
                {opt.label}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            {active.hint}
          </span>
          <input
            autoFocus
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.replace(/[^0-9]/g, ''));
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder={active.placeholder}
            className="w-full rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-4 py-2.5 text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-subtle)] focus:border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
          />
        </label>

        {error && <p className="text-sm text-[var(--signal-danger)]">{error}</p>}

        <p className="text-[13px] leading-relaxed text-[var(--ink-muted)]">
          {kind === 'u'
            ? '输入对方的数字用户 ID 开始私聊。'
            : '输入团队 ID 进入团队群聊（需为该团队成员）。'}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
          >
            取消
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={spring.precise}
            disabled={busy || !value.trim()}
            onClick={() => void submit()}
            className="rounded-xl px-5 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--aurora-1)', color: 'var(--bg-void)' }}
          >
            {busy ? '打开中…' : '打开会话'}
          </motion.button>
        </div>
      </div>
    </Modal>
  );
}
