'use client';

import { motion } from 'framer-motion';
import HeroParallaxContent from '@/app/components/HeroParallaxContent';

interface Props {
  isVisible: boolean;
}

const stagger = {
  animate: {
    transition: {
      staggerChildren: 0.12,
    },
  },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

export default function HeroSection({ isVisible }: Props) {
  return (
    <div className="relative min-h-[80vh] flex flex-col items-center justify-center text-center">
      {/* Aurora ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-[var(--aurora-1)]/10 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-[var(--aurora-4)]/8 rounded-full blur-[100px]" />
      </div>

      <HeroParallaxContent className="relative z-10 w-full flex flex-col items-center justify-center">
        <motion.div
          variants={stagger}
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          className="space-y-6"
        >
          {/* Eyebrow */}
          <motion.p variants={fadeUp} className="eyebrow">
            AETHERBLOG
          </motion.p>

          {/* Title with aurora gradient + breath */}
          <motion.h1
            variants={fadeUp}
            className="text-h1 md:text-display font-display font-bold aurora-text"
            style={{ animation: isVisible ? 'breath-soft 7.2s ease-in-out infinite' : 'none' }}
          >
            以太之上，思想成形
          </motion.h1>

          {/* Subtitle */}
          <motion.p variants={fadeUp} className="text-lede md:text-h4 text-[var(--ink-secondary)] max-w-2xl mx-auto">
            AI 驱动的下一代智能博客系统
          </motion.p>

          {/* Body */}
          <motion.p variants={fadeUp} className="text-body text-[var(--ink-muted)] max-w-xl mx-auto">
            7 大核心能力，从创作到发布，重新定义博客体验
          </motion.p>
        </motion.div>
      </HeroParallaxContent>

      {/* Scroll down pulse arrow */}
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
