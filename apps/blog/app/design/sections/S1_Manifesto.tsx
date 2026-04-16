'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
  siteTitle: string;
}

export default function S1_Manifesto({ isVisible, siteTitle }: Props) {
  return (
    <div className="text-center max-w-4xl mx-auto space-y-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="font-mono text-[12px] uppercase tracking-[0.32em] text-[var(--aurora-1)]/85"
      >
        {siteTitle} · DESIGN SYSTEM · AETHER CODEX
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        className="font-display text-[clamp(3rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em] text-[var(--ink-primary)]"
        style={{ textWrap: 'balance' as any }}
      >
        <span className="aurora-text">设计的推理链</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
        className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl max-w-2xl mx-auto leading-relaxed"
      >
        为什么我们做每一个决定。
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        className="text-[var(--ink-secondary)]/80 max-w-xl mx-auto leading-relaxed"
      >
        设计系统的价值不在组件数量,而在<strong className="text-[var(--ink-primary)]">推理链公开</strong>。
        本页把 Aether Codex 的色彩、字体、玻璃、动效、签名时刻全部拆开,每一个决定都附证据。
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={isVisible ? { opacity: 0.6 } : { opacity: 0 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.8 }}
        className="pt-10 flex justify-center"
      >
        <div className="flex flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          <span>Scroll</span>
          <span className="text-lg animate-bounce">↓</span>
        </div>
      </motion.div>
    </div>
  );
}
