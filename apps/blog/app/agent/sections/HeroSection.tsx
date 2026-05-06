'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import HeroParallaxContent from '@/app/components/HeroParallaxContent';

interface Props {
  isVisible: boolean;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

export default function HeroSection({ isVisible }: Props) {
  return (
    <div className="relative min-h-[80vh] flex flex-col items-center justify-center text-center">
      {/* 极光环境光晕 — 与 /about HeroSection 相同的双源构图 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-[var(--aurora-1)]/10 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-[var(--aurora-3)]/10 rounded-full blur-[100px]" />
      </div>

      <HeroParallaxContent className="relative z-10 w-full flex flex-col items-center justify-center">
        <motion.div
          variants={stagger}
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          className="space-y-6"
        >
          {/* 上眉文 */}
          <motion.p variants={fadeUp} className="eyebrow inline-flex items-center justify-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> AETHERBLOG · AGENT
          </motion.p>

          {/* 标题：极光渐变 + 4.8s 全局呼吸节奏 */}
          <motion.h1
            variants={fadeUp}
            className="text-h1 md:text-display font-display font-bold aurora-text"
            style={{
              animation: isVisible ? 'breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1) infinite' : 'none',
              textWrap: 'balance' as unknown as 'inherit',
            }}
          >
            与思想共智
          </motion.h1>

          {/* 副标题 */}
          <motion.p
            variants={fadeUp}
            className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl max-w-2xl mx-auto leading-relaxed"
          >
            一个由你的博客知识图谱驱动的对话与代理工作台。
          </motion.p>

          {/* 正文 */}
          <motion.p variants={fadeUp} className="text-body text-[var(--ink-muted)] max-w-xl mx-auto">
            它读过你写的每一篇文章，记得你定义过的每一个标签。问它，让它替你思考。
          </motion.p>

          {/* CTA */}
          <motion.div variants={fadeUp} className="pt-2 flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/agent/workspace"
              className="hero-primary-btn group inline-flex items-center justify-center gap-2.5 px-7 py-3 rounded-xl text-white font-medium min-w-[10rem]"
            >
              <span className="hero-btn-shimmer" aria-hidden="true" />
              <span className="relative z-10">进入工作台</span>
              <ArrowRight className="relative z-10 w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#agent-manifesto"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--ink-subtle)]/30 text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--aurora-1)]/40 transition-colors font-medium"
            >
              先了解能做什么
            </a>
          </motion.div>

          <motion.p variants={fadeUp} className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]/80 pt-4">
            需要登录 · 普通注册用户与管理员皆可
          </motion.p>
        </motion.div>
      </HeroParallaxContent>

      {/* 滚动指示器 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isVisible ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
      >
        <motion.svg
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12l7 7 7-7" />
        </motion.svg>
      </motion.div>
    </div>
  );
}
