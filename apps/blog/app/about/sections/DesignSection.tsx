'use client';

import { motion } from 'framer-motion';
import FeatureCard from '../components/FeatureCard';

interface Props {
  isVisible: boolean;
}

const stagger = {
  animate: {
    transition: { staggerChildren: 0.08 },
  },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

export default function DesignSection({ isVisible }: Props) {
  const features = [
    {
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
      ),
      title: '四层玻璃',
      description: 'Void / Substrate / Leaf / Raised 四层景深体系，每层透明度与模糊度精确计算，构建苹果级纵深空间感。',
    },
    {
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
      title: '极光色彩',
      description: 'OKLCH 感知均匀色域，从单一主色自动派生四阶极光渐变。换一个主色，整站装饰色体系同步跟随。',
    },
    {
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18" />
          <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9" />
          <path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9" />
        </svg>
      ),
      title: '呼吸律动',
      description: 'Fraunces 可变字体 opsz 轴呼吸动画、聚光灯悬浮跟随、段落交替深浅节奏，营造有生命感的阅读界面。',
    },
  ];

  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">DESIGN PHILOSOPHY</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          认知优雅
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          每一个像素，都在诠释克制之美
        </p>
        <p className="text-body text-[var(--ink-muted)] max-w-xl mx-auto">
          灵感源自 Linear、Raycast 与 Vercel。四层玻璃体系、极光色彩工程、OKLCH 感知均匀色域
        </p>
      </motion.div>

      {/* Feature Cards */}
      <motion.div
        variants={stagger}
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {features.map((f) => (
          <motion.div key={f.title} variants={fadeUp}>
            <FeatureCard icon={f.icon} title={f.title} description={f.description} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
