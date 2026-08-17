'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Files, KeyRound, ShieldCheck } from 'lucide-react';

interface Props {
  isVisible: boolean;
  siteTitle: string;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function EnterSection({ isVisible, siteTitle }: Props) {
  return (
    <div className="text-center max-w-3xl mx-auto space-y-8 py-10">
      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
        className="space-y-6"
      >
        <motion.p variants={fadeUp} className="eyebrow">{siteTitle.toUpperCase()} · ENTER</motion.p>
        <motion.h2
          variants={fadeUp}
          className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.06] tracking-[-0.02em] text-[var(--ink-primary)]"
        >
          <span className="aurora-text">准备好了吗？</span>
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl leading-relaxed max-w-xl mx-auto"
        >
          进入需要登录 —— 与后台管理用同一套账号体系，普通注册用户即可。
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-2">
          <Link
            href="/agent/workspace"
            className="hero-primary-btn group inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-white font-medium min-w-[12rem]"
          >
            <span className="hero-btn-shimmer" aria-hidden="true" />
            <span className="relative z-10">进入工作台</span>
            <ArrowRight className="relative z-10 w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/agent/login"
            className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl border border-[var(--ink-subtle)]/30 text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/40 transition-colors font-medium"
          >
            <KeyRound className="w-4 h-4" />
            先登录
          </Link>
          <Link
            href="/agent/shared"
            className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl border border-[var(--ink-subtle)]/30 text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/40 transition-colors font-medium"
          >
            <Files className="w-4 h-4" />
            共享内容
          </Link>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="pt-6 inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--aurora-1)]/85" />
          <span>JWT · HttpOnly Cookie · 与后台同源</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
