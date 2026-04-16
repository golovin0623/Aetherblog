'use client';

import { useEffect, useState } from 'react';

/**
 * Reading Progress Bar · 2026-04 重构
 *
 * 现代浏览器(Chrome 115+ / Edge 115+ / 新 Firefox)走 `animation-timeline: scroll()`:
 *   - 纯 CSS,零 JS,零 React re-render,合成器线程驱动 120fps
 *   - 实现见 packages/ui/src/styles/typography.css 的 .reading-progress--css
 *
 * Safari < 26 / 旧浏览器降级到 requestAnimationFrame + CSS 变量方案
 * (与本文件 2026-04 前的实现一致)。
 *
 * 通过首次 effect 内的 `CSS.supports('animation-timeline', 'scroll()')` 判定分支,
 * 避免 SSR 误判。服务端渲染阶段默认现代路径(占比更大),
 * 仅当客户端不支持时才挂载 rAF 子组件。
 */
export default function ReadingProgress() {
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    // 在客户端首次挂载时检测;不支持则切到 rAF 降级
    const supported =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline', 'scroll()');
    if (!supported) setUseFallback(true);
  }, []);

  if (useFallback) {
    return <ReadingProgressFallback />;
  }

  return (
    <div
      className="reading-progress reading-progress--css fixed top-0 left-0 right-0 z-[60] pointer-events-none"
      aria-hidden="true"
    />
  );
}

/** rAF 降级路径 —— Safari < 26 / 不支持 animation-timeline 的浏览器 */
function ReadingProgressFallback() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let rafId = 0;
    const update = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const p = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      setProgress(p);
      rafId = 0;
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      className="reading-progress fixed top-0 left-0 right-0 z-[60] pointer-events-none"
      style={{ ['--reading-progress' as string]: String(progress) }}
      aria-hidden="true"
    />
  );
}
