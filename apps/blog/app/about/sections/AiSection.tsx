'use client';

import { motion } from 'framer-motion';
import AnimatedCounter from '../components/AnimatedCounter';

interface Props {
  isVisible: boolean;
}

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const slideRight = {
  initial: { opacity: 0, x: -24 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const toolIcons = [
  { label: '摘要', icon: 'Aa' },
  { label: '标签', icon: '#' },
  { label: '标题', icon: 'H1' },
  { label: '润色', icon: 'Tx' },
  { label: '大纲', icon: '::' },
  { label: '翻译', icon: 'Tr' },
  { label: '续写', icon: '>>' },
];

export default function AiSection({ isVisible }: Props) {
  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">AI COPILOT</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          AI，你的创作搭档
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          六大供应商、七个智能工具、SSE 流式实时反馈
        </p>
      </motion.div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Left: AI stream mockup */}
        <motion.div
          variants={slideRight}
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          className="relative surface-leaf rounded-2xl border border-[var(--ink-subtle)]/20 p-6 overflow-hidden"
        >
          <div className="ai-stream space-y-2">
            <span className="delta">AI 正在为您的文章生成摘要...</span>
            <span className="delta" style={{ animationDelay: '100ms' }}>这篇文章探讨了现代博客系统的</span>
            <span className="delta" style={{ animationDelay: '200ms' }}>架构设计与智能化趋势，</span>
            <span className="delta" style={{ animationDelay: '300ms' }}>涵盖了从前端渲染到后端服务的</span>
            <span className="delta" style={{ animationDelay: '400ms' }}>全栈技术选型...</span>
          </div>
          <span className="ink-cursor" aria-hidden="true" />
        </motion.div>

        {/* Right: Tool grid */}
        <div className="space-y-8">
          <motion.div
            initial="initial"
            animate={isVisible ? 'animate' : 'initial'}
            variants={{
              animate: { transition: { staggerChildren: 0.06, delayChildren: 0.3 } },
            }}
            className="grid grid-cols-4 gap-3"
          >
            {toolIcons.map((t) => (
              <motion.div
                key={t.label}
                variants={fadeUp}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/10 hover:border-[var(--aurora-1)]/30 transition-colors"
              >
                <span className="font-mono text-lg text-[var(--aurora-1)] font-semibold">{t.icon}</span>
                <span className="text-micro text-[var(--ink-muted)]">{t.label}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Counters */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isVisible ? { opacity: 1 } : {}}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="flex gap-8 justify-center md:justify-start"
          >
            <div className="text-center">
              <div className="text-h2 font-display font-bold text-[var(--ink-primary)]">
                <AnimatedCounter target={6} isVisible={isVisible} suffix="+" />
              </div>
              <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
                供应商
              </p>
            </div>
            <div className="text-center">
              <div className="text-h2 font-display font-bold text-[var(--ink-primary)]">
                <AnimatedCounter target={7} isVisible={isVisible} />
              </div>
              <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
                AI 工具
              </p>
            </div>
            <div className="text-center">
              <div className="text-h2 font-display font-bold aurora-text">
                SSE
              </div>
              <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
                流式传输
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
