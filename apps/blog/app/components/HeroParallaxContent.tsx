'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

/**
 * Hero 内容区的视差滚动特效组件
 * 当页面向下滚动时，Hero 内容区会产生一个与滚动反向但轻微的位移（仿佛它被页面推远），
 * 同时透明度逐渐降低，以强调下方“书页”盖上来的纵深感。
 */
export default function HeroParallaxContent({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 追踪整体窗口滚动
  const { scrollY } = useScroll();
  
  // 视差位移：页面向下滚动时，内容缓慢向上偏移，仿佛被下方书页轻柔推远
  const y = useTransform(scrollY, [0, 600], [0, -150]);
  
  // 透明度衰减：在较长的滚动窗口内平滑消隐，与位移节奏统一
  const opacity = useTransform(scrollY, [0, 500], [1, 0]);
  
  // 缩放：微妙的纵深感，与 y 位移使用相同的滚动窗口
  const scale = useTransform(scrollY, [0, 600], [1, 0.95]);

  return (
    <motion.div
      ref={containerRef}
      className={className}
      style={{ y, opacity, scale }}
    >
      {children}
    </motion.div>
  );
}
