'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { loginAgent, useAgentAuth } from '../lib/agentAuth';

interface Props {
  siteTitle: string;
  next: string;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
};

/**
 * /agent/login —— Agent 登录入口
 *
 * 设计语言对齐 /agent 入口与 /design：surface-overlay 玻璃卡 + aurora 标题 +
 * font-mono 上眉文。表单本身极简：username + password + 登录。
 *
 * 安全：
 *  - `next` 参数仅接受站内绝对路径（单 '/'），同首页 safeInternalHref 同思路；
 *  - access token / refresh token 由后端写入 HttpOnly Cookie，前端不持有。
 */
function safeInternalHref(raw: string | undefined | null, fallback: string): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

export default function LoginClient({ siteTitle, next }: Props) {
  const router = useRouter();
  const target = safeInternalHref(next, '/agent/workspace');
  const { state } = useAgentAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已登录用户直接跳走，不让重复登录占用 token
  useEffect(() => {
    if (state.status === 'authed') {
      router.replace(target);
    }
  }, [state.status, router, target]);

  // 状态分流：
  //   loading  → 占位 skeleton（避免表单先闪现）
  //   authed   → 正在 router.replace，依然显示 skeleton（用户瞬间就跳走）
  //   guest    → 真正的登录表单
  // 这样从 BlogHeader / "进入工作台" 跳过来的已登录用户不会先看到一闪而过的输入框。
  const showCheckingState = state.status !== 'guest';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const err = await loginAgent(username.trim(), password);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    router.replace(target);
  }

  if (showCheckingState) {
    return (
      <main className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden flex items-center justify-center px-4 py-16 bg-[var(--bg-void)]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-[15%] left-[15%] w-[40%] h-[40%] bg-[var(--aurora-1)]/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[10%] w-[35%] h-[35%] bg-[var(--aurora-3)]/10 rounded-full blur-[100px]" />
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="relative z-10 w-full max-w-md surface-overlay rounded-2xl border border-[var(--ink-subtle)]/15 p-8 md:p-10 space-y-5 select-none"
        >
          <div className="space-y-3 text-center">
            <div className="mx-auto h-3 w-44 rounded bg-[var(--ink-subtle)]/15 animate-pulse" />
            <div className="mx-auto h-9 w-3/4 rounded bg-[var(--ink-subtle)]/15 animate-pulse" />
            <div className="mx-auto h-4 w-1/2 rounded bg-[var(--ink-subtle)]/12 animate-pulse" />
          </div>
          <div className="space-y-3 pt-2">
            <div className="h-3 w-24 rounded bg-[var(--ink-subtle)]/12 animate-pulse" />
            <div className="h-11 w-full rounded-xl bg-[var(--ink-subtle)]/12 animate-pulse" />
            <div className="h-3 w-20 rounded bg-[var(--ink-subtle)]/12 animate-pulse" />
            <div className="h-11 w-full rounded-xl bg-[var(--ink-subtle)]/12 animate-pulse" />
            <div className="h-12 w-full rounded-xl bg-[var(--ink-subtle)]/15 animate-pulse" />
          </div>
          <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
            {state.status === 'authed' ? '已登录 · 即将进入工作台…' : '正在确认登录状态…'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden flex items-center justify-center px-4 py-16 bg-[var(--bg-void)]">
      {/* aurora 环境光晕 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-[15%] left-[15%] w-[40%] h-[40%] bg-[var(--aurora-1)]/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[35%] h-[35%] bg-[var(--aurora-3)]/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial="initial"
        animate="animate"
        variants={{ animate: { transition: { staggerChildren: 0.08 } } }}
        className="relative z-10 w-full max-w-md surface-overlay rounded-2xl border border-[var(--ink-subtle)]/15 p-6 sm:p-8 md:p-10 space-y-7"
      >
        <motion.div variants={fadeUp} className="space-y-3 text-center">
          <p className="eyebrow inline-flex items-center justify-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> {siteTitle.toUpperCase()} · AGENT
          </p>
          <h1 className="font-display text-[clamp(2rem,9vw,3.5rem)] font-bold leading-tight text-[var(--ink-primary)] tracking-[-0.02em]">
            登录以进入工作台
          </h1>
          <p className="font-editorial italic text-[var(--ink-secondary)]">
            与博客后台同源 —— 你的现有账号可直接使用。
          </p>
        </motion.div>

        <motion.form variants={fadeUp} onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]" htmlFor="agent-login-username">
              用户名 / 邮箱
            </label>
            <input
              id="agent-login-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)] placeholder-[var(--ink-muted)]/60 outline-none focus:border-[var(--aurora-1)]/60 focus:ring-2 focus:ring-[var(--aurora-1)]/20 transition-colors"
              placeholder="例如 admin"
            />
          </div>
          <div className="space-y-2">
            <label className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]" htmlFor="agent-login-password">
              密码
            </label>
            <input
              id="agent-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/20 text-[var(--ink-primary)] placeholder-[var(--ink-muted)]/60 outline-none focus:border-[var(--aurora-1)]/60 focus:ring-2 focus:ring-[var(--aurora-1)]/20 transition-colors"
              placeholder="······"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="font-mono text-[12px] tracking-[0.06em] text-[var(--signal-danger)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          {/* 登录主行动 —— 走 §05 primary（ink-primary 实底 + bg-void 字），
              替掉旧的"紫色渐变 + 流光 shimmer"营销按钮，让进入灵境的最后一步
              与控制台内的克制气质一致；按压用苹果式轻微下沉 + 回弹。 */}
          <button
            type="submit"
            disabled={submitting || !username || !password}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink-primary)] px-7 py-3 font-medium text-[var(--bg-void)] shadow-[0_12px_32px_-14px_color-mix(in_oklch,var(--ink-primary)_55%,transparent)] transition-[transform,filter,box-shadow,opacity] duration-quick ease-aether hover:-translate-y-px hover:brightness-110 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:brightness-100"
          >
            {submitting ? (
              <span className="grid h-4 w-4 place-items-center" aria-hidden="true">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
              </span>
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {submitting ? '登录中…' : '登录'}
          </button>
        </motion.form>

        <motion.div variants={fadeUp} className="flex items-center justify-between text-[11px]">
          <Link
            href="/agent"
            className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.22em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            返回介绍
          </Link>
          <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            <ShieldCheck className="w-3 h-3 text-[var(--aurora-1)]/85" /> JWT · HttpOnly
          </span>
        </motion.div>
      </motion.div>
    </main>
  );
}
