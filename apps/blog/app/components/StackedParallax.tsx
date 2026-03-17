'use client';

import { motion, useScroll, useTransform } from 'framer-motion';

/**
 * 下方叠层页面的内容视差滚动组件
 * 作用：在页面向下滚动（即叠层向上拉起）的过程中，使叠层内部的内容额外向上平滑偏移。
 * 效果：完美且动态地“吃掉”叠层顶部为了同心圆留出的巨大 `pt-100` 留白。
 * 当叠层滚动到贴紧顶部导航栏时，内部的内容也会由于视差偏移恰好贴近导航栏，消除突兀的空间感。
 */
export default function StackedParallax({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { scrollY } = useScroll();
  
  // 视差位移：当整体页面从 0 滚动到 500px 时，内部内容相对于整个叠层容器向上额外移动 80px。
  // 这会恰好消耗掉顶部 100px padding 中的 80px，只留下完美的 20px 间距。
  const y = useTransform(scrollY, [0, 500], [0, -80]);

  return (
    <motion.div className={className} style={{ y }}>
      {children}
    </motion.div>
  );
}
