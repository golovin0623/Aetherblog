'use client';

import { motion } from 'framer-motion';
import FeatureCard from '../components/FeatureCard';
import AnimatedCounter from '../components/AnimatedCounter';

interface Props {
  isVisible: boolean;
}

const stagger = {
  animate: {
    transition: { staggerChildren: 0.1 },
  },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

// Module-scope: icon JSX references stay stable across re-renders so
// React.memo on FeatureCard can actually skip re-renders via shallow compare.
const stacks = [
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: 'Go 1.24',
    description: 'Echo v4 框架 + sqlx + zerolog 结构化日志。高并发、低延迟、类型安全的后端引擎。',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    ),
    title: 'Next.js 15',
    description: 'App Router + ISR + Server Components。SSR/SSG 混合渲染，首屏秒开，SEO 友好。',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
    title: 'PostgreSQL 17',
    description: 'pgvector 向量索引 + tsvector 全文搜索。关系数据与语义搜索统一于一个数据库。',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    title: 'Redis 7',
    description: '会话缓存、速率限制、实时计数器。毫秒级响应，为高频读写场景保驾护航。',
  },
];

export default function TechStackSection({ isVisible }: Props) {
  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">TECH STACK</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          四栈驱动
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          现代技术选型，每一层都追求最优解
        </p>
      </motion.div>

      {/* Stack Cards */}
      <motion.div
        variants={stagger}
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        {stacks.map((s) => (
          <motion.div key={s.title} variants={fadeUp}>
            <FeatureCard icon={s.icon} title={s.title} description={s.description} />
          </motion.div>
        ))}
      </motion.div>

      {/* Counters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isVisible ? { opacity: 1 } : {}}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="flex justify-center gap-12"
      >
        <div className="text-center">
          <div className="text-h2 font-display font-bold text-[var(--ink-primary)]">
            <AnimatedCounter target={31} isVisible={isVisible} />
          </div>
          <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
            数据库迁移
          </p>
        </div>
        <div className="text-center">
          <div className="text-h2 font-display font-bold text-[var(--ink-primary)]">
            <AnimatedCounter target={23} isVisible={isVisible} />
          </div>
          <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
            API 模块
          </p>
        </div>
      </motion.div>
    </div>
  );
}
