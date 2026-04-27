/**
 * @file MobileBottomPullNav.tsx
 * @description 移动端底部上滑快捷导航 — Framer Motion + 速度感知手势
 *
 * 架构要点：
 * - 连续量（位置/缩放/透明度/形变）= useMotionValue，每帧 .set() 直接写 DOM transform，零 React 渲染
 * - 离散量（active / isReady / snappedTo）= useState，仅在阶段转换时更新，驱动触觉 + label 文案 + 图标颜色
 * - 释放 = animate(mv, rest, { type: 'spring', velocity: mv.getVelocity() }) 按手指速度弹簧投掷
 * - 吸附跳变 = animate() 稍硬弹簧；未跳变帧仍走 .set() 直写
 * - backdrop-filter 半径固定 4px 只动透明度；blob 固定 56×56 用 scale 驱动，全走合成器
 */

'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type AnimationPlaybackControls,
} from 'framer-motion';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';

/* ─── 类型定义 ─── */

interface PostBrief {
  slug: string;
  title: string;
}

interface MobileBottomPullNavProps {
  prevPost?: PostBrief | null;
  nextPost?: PostBrief | null;
}

type SnapTarget = 'prev' | 'center' | 'next';

/* ─── 常量 ─── */

const DEAD_ZONE = 18;
const FULL_PULL = 120;
const RELEASE_THRESHOLD = 0.4;
const SIDE_APPEAR_THRESHOLD = 0.45;
const SNAP_THRESHOLD = 60;
const UNSNAP_THRESHOLD = 25;

const CIRCLE_MAX = 56;
const SIDE_ICON_SIZE = 48;
const SIDE_SPACING = 96;

const RELEASE_SPRING = { type: 'spring' as const, stiffness: 380, damping: 32, mass: 1 };
const SNAP_SPRING = { type: 'spring' as const, stiffness: 500, damping: 28 };

/* ─── 辅助函数 ─── */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const vibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
};

/* ─── 组件 ─── */

function MobileBottomPullNavBase({ prevPost, nextPost }: MobileBottomPullNavProps) {
  // ── 离散状态（低频更新）──
  const [active, setActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [snappedTo, setSnappedTo] = useState<SnapTarget>('center');
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  const router = useRouter();

  // ── Refs ──
  const touchRef = useRef({
    startY: 0,
    startX: 0,
    pulling: false,
    atBottom: false,
    wasReady: false,
    prevSnap: 'center' as SnapTarget,
  });
  const prevPostRef = useRef(prevPost);
  const nextPostRef = useRef(nextPost);
  // 正在进行中的吸附过渡弹簧（避免后续帧用直接 .set() 打断它）
  const snapAnimRef = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => { prevPostRef.current = prevPost; }, [prevPost]);
  useEffect(() => { nextPostRef.current = nextPost; }, [nextPost]);
  useEffect(() => { setMounted(true); }, []);

  // ── Motion values（连续量，由直接 .set() 驱动）──
  const pullProgress = useMotionValue(0);
  const blobX = useMotionValue(0);
  const blobStretchX = useMotionValue(1);
  const blobStretchY = useMotionValue(1);
  const prevIconOpacity = useMotionValue(0);
  const nextIconOpacity = useMotionValue(0);
  const centerIconOpacity = useMotionValue(0);
  const prevIconScale = useMotionValue(0.3);
  const nextIconScale = useMotionValue(0.3);

  // ── 派生量（useTransform，源驱动 —— 无 React state 闭包）──
  const containerY = useTransform(pullProgress, (p) => lerp(80, 0, easeOut(clamp(p, 0, 1))));
  const containerOpacity = useTransform(pullProgress, (p) => clamp(Math.max(p, 0) * 2.5, 0, 1));
  const overlayOpacity = useTransform(pullProgress, (p) => clamp(Math.max(p, 0) * 1.5, 0, 1));
  const blobScale = useTransform(pullProgress, (p) => easeOut(clamp(p, 0, 1)));
  const blobCoreOpacity = useTransform(pullProgress, (p) => clamp(Math.max(p, 0) * 5, 0, 1));
  const arrowRotation = useTransform(pullProgress, (p) => -lerp(90, 0, clamp(Math.max(p, 0) * 2, 0, 1)));
  const arrowScale = useTransform(pullProgress, (p) => {
    const eased = easeOut(clamp(p, 0, 1));
    return clamp((eased * CIRCLE_MAX * 0.42) / 24, 0, 1);
  });
  const sideSpread = useTransform(pullProgress, (p) => {
    const sp = clamp((clamp(p, 0, 1) - SIDE_APPEAR_THRESHOLD) / (1 - SIDE_APPEAR_THRESHOLD), 0, 1);
    return easeOut(sp) * SIDE_SPACING;
  });
  const sideSpreadNeg = useTransform(sideSpread, (s) => -s);

  // ── 辅助函数 ──
  const isAtBottom = useCallback(() => {
    const st = window.scrollY;
    const sh = document.documentElement.scrollHeight;
    const ch = window.innerHeight;
    return sh - ch > 50 && st + ch >= sh - 8;
  }, []);

  const navigate = useCallback((target: SnapTarget) => {
    if (target === 'prev' && prevPostRef.current) {
      router.push(`/posts/${prevPostRef.current.slug}`);
    } else if (target === 'center') {
      window.history.length > 1 ? router.back() : router.push('/posts');
    } else if (target === 'next' && nextPostRef.current) {
      router.push(`/posts/${nextPostRef.current.slug}`);
    }
  }, [router]);

  // ── 移动端检测 ──
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    onChange(mql);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // ── 触摸事件处理 ──
  useEffect(() => {
    if (!isMobile) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = touchRef.current;
      t.atBottom = isAtBottom();
      if (!t.atBottom) return;
      const touch = e.touches[0];
      t.startY = touch.clientY;
      t.startX = touch.clientX;
      t.pulling = false;
      t.wasReady = false;
      t.prevSnap = 'center';
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = touchRef.current;
      if (!t.atBottom) return;

      const touch = e.touches[0];
      const deltaY = t.startY - touch.clientY;

      if (deltaY < DEAD_ZONE) {
        if (t.pulling) {
          t.pulling = false;
          snapAnimRef.current?.stop();
          snapAnimRef.current = null;
          pullProgress.set(0);
          blobX.set(0);
          blobStretchX.set(1);
          blobStretchY.set(1);
          prevIconOpacity.set(0);
          nextIconOpacity.set(0);
          centerIconOpacity.set(0);
          prevIconScale.set(0.3);
          nextIconScale.set(0.3);
          setActive(false);
          setIsReady(false);
          setSnappedTo('center');
          t.wasReady = false;
          t.prevSnap = 'center';
        }
        return;
      }

      if (!t.pulling) {
        t.pulling = true;
        vibrate(8);
        setActive(true);
      }

      e.preventDefault();

      const progress = clamp((deltaY - DEAD_ZONE) / FULL_PULL, 0, 1);
      const lateralOffset = touch.clientX - t.startX;
      const ready = progress >= RELEASE_THRESHOLD;

      if (ready !== t.wasReady) {
        if (ready) vibrate(12);
        t.wasReady = ready;
        setIsReady(ready);
      }

      // 带迟滞的吸附状态机（强约束：退出需跨越 UNSNAP_THRESHOLD）
      let snap: SnapTarget = t.prevSnap;
      if (ready && progress > SIDE_APPEAR_THRESHOLD) {
        const hasPrev = !!prevPostRef.current;
        const hasNext = !!nextPostRef.current;
        if (snap === 'center') {
          if (lateralOffset < -SNAP_THRESHOLD && hasPrev) { snap = 'prev'; vibrate(10); }
          else if (lateralOffset > SNAP_THRESHOLD && hasNext) { snap = 'next'; vibrate(10); }
        } else if (snap === 'prev') {
          if (lateralOffset > -UNSNAP_THRESHOLD) { snap = 'center'; vibrate(5); }
        } else if (snap === 'next') {
          if (lateralOffset < UNSNAP_THRESHOLD) { snap = 'center'; vibrate(5); }
        }
      } else {
        snap = 'center';
      }

      const snapChanged = snap !== t.prevSnap;
      if (snapChanged) {
        t.prevSnap = snap;
        setSnappedTo(snap);
      }

      // ── 推导瞬时的两侧展开距离（用于 blob 基准位置 + 与图标状态相关的派生量）──
      const sideP = clamp((progress - SIDE_APPEAR_THRESHOLD) / (1 - SIDE_APPEAR_THRESHOLD), 0, 1);
      const sideEased = easeOut(sideP);
      const spread = sideEased * SIDE_SPACING;

      const blobBaseX = snap === 'prev' ? -spread : snap === 'next' ? spread : 0;

      // 黏滞的拖拽偏移：blob 抗拒离开吸附位，但允许手指轻微拖动它
      let dragDist = 0;
      if (ready) {
        if (snap === 'center') dragDist = lateralOffset;
        else if (snap === 'prev' && lateralOffset > -50) dragDist = lateralOffset + 50;
        else if (snap === 'next' && lateralOffset < 50) dragDist = lateralOffset - 50;
      }
      const blobXTarget = blobBaseX + clamp(dragDist * 0.25, -20, 20);
      const stretchFactor = ready ? Math.abs(dragDist) / 100 : 0;
      const stretchXTarget = 1 + clamp(stretchFactor, 0, 0.4);
      const stretchYTarget = 1 - clamp(stretchFactor * 0.4, 0, 0.15);

      // 与状态相关的图标通道 —— 每帧直接写入
      const prevOpTarget = snap === 'prev' ? 1 : snap === 'center' ? sideEased * 0.5 : 0;
      const nextOpTarget = snap === 'next' ? 1 : snap === 'center' ? sideEased * 0.5 : 0;
      const centerOpTarget = snap === 'center' ? 1 : 0;
      const prevScaleTarget = snap === 'prev' ? 1.2 : 0.3 + 0.7 * sideEased;
      const nextScaleTarget = snap === 'next' ? 1.2 : 0.3 + 0.7 * sideEased;

      // ── 写入各通道 ──
      pullProgress.set(progress);
      blobStretchX.set(stretchXTarget);
      blobStretchY.set(stretchYTarget);
      prevIconOpacity.set(prevOpTarget);
      nextIconOpacity.set(nextOpTarget);
      centerIconOpacity.set(centerOpTarget);
      prevIconScale.set(prevScaleTarget);
      nextIconScale.set(nextScaleTarget);

      // blobX：吸附过渡时走弹簧动画；其他情况直接 .set()
      if (snapChanged) {
        snapAnimRef.current?.stop();
        const anim = animate(blobX, blobXTarget, SNAP_SPRING);
        snapAnimRef.current = anim;
        anim.then(() => {
          // 仅当此动画仍是当前动画时才置空
          if (snapAnimRef.current === anim) snapAnimRef.current = null;
        });
      } else if (!snapAnimRef.current) {
        blobX.set(blobXTarget);
      }
      // 其他情况：吸附弹簧仍在运行 —— 不打断它，约 250ms 内会跟上
    };

    const onTouchEnd = () => {
      const t = touchRef.current;
      if (!t.pulling) return;

      t.pulling = false;
      t.atBottom = false;

      // 立即执行导航（不等待弹簧动画结束）
      if (t.wasReady) {
        const target = t.prevSnap;
        vibrate([5, 50, 15]);
        requestAnimationFrame(() => navigate(target));
      }

      // 取消正在进行的吸附弹簧，让释放动画接管
      snapAnimRef.current?.stop();
      snapAnimRef.current = null;

      // 用各通道当前速度做弹簧释放（framer-motion 会基于 .set() 历史追踪 d/dt）
      const anims = [
        animate(pullProgress, 0, { ...RELEASE_SPRING, velocity: pullProgress.getVelocity() }),
        animate(blobX, 0, { ...RELEASE_SPRING, velocity: blobX.getVelocity() }),
        animate(blobStretchX, 1, { ...RELEASE_SPRING, velocity: blobStretchX.getVelocity() }),
        animate(blobStretchY, 1, { ...RELEASE_SPRING, velocity: blobStretchY.getVelocity() }),
        animate(prevIconOpacity, 0, { ...RELEASE_SPRING, velocity: prevIconOpacity.getVelocity() }),
        animate(nextIconOpacity, 0, { ...RELEASE_SPRING, velocity: nextIconOpacity.getVelocity() }),
        animate(centerIconOpacity, 0, { ...RELEASE_SPRING, velocity: centerIconOpacity.getVelocity() }),
        animate(prevIconScale, 0.3, { ...RELEASE_SPRING, velocity: prevIconScale.getVelocity() }),
        animate(nextIconScale, 0.3, { ...RELEASE_SPRING, velocity: nextIconScale.getVelocity() }),
      ];

      setIsReady(false);
      setSnappedTo('center');
      t.wasReady = false;
      t.prevSnap = 'center';

      // 保持遮罩挂载直至弹簧稳定，然后卸载以停止合成层。
      // 用 touchRef.pulling 做守卫，防止重叠手势（用户在弹簧动画中又开始新一次下拉）
      // 在拉动仍在进行时让遮罩失活。
      Promise.all(anims).then(() => {
        if (!touchRef.current.pulling) setActive(false);
      });
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [
    isMobile, isAtBottom, navigate,
    pullProgress, blobX, blobStretchX, blobStretchY,
    prevIconOpacity, nextIconOpacity, centerIconOpacity,
    prevIconScale, nextIconScale,
  ]);

  if (!isMobile || !mounted || !active) return null;

  const hasPrev = !!prevPost;
  const hasNext = !!nextPost;
  const centerIsActive = snappedTo === 'center';

  const labelText = snappedTo === 'prev' && hasPrev
    ? '上一篇'
    : snappedTo === 'next' && hasNext
      ? '下一篇'
      : '返回';

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[200] pointer-events-none"
      aria-hidden="true"
      style={{ opacity: containerOpacity }}
    >
      {/* 静态模糊遮罩 —— 仅 opacity 参与动画，backdrop-filter 始终为 4px */}
      <motion.div
        className="absolute inset-0 bg-black/5 dark:bg-black/20"
        style={{
          opacity: overlayOpacity,
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          willChange: 'opacity',
        }}
      />

      {/* 导航容器 */}
      <motion.div
        className="absolute left-1/2 flex flex-col items-center"
        style={{
          bottom: '56px',
          x: '-50%',
          y: containerY,
          willChange: 'transform',
        }}
      >
        {/* 图标与 blob 层 */}
        <div className="relative flex items-center justify-center" style={{ height: `${CIRCLE_MAX}px`, width: '100%' }}>

          {/* 统一 blob —— 固定 56×56，仅通过 transform 实现缩放与拉伸 */}
          <motion.div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: `${CIRCLE_MAX}px`,
              height: `${CIRCLE_MAX}px`,
              x: blobX,
              scale: blobScale,
              scaleX: blobStretchX,
              scaleY: blobStretchY,
              opacity: blobCoreOpacity,
              background: 'var(--bg-secondary, rgba(235, 235, 240, 0.9))',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12), inset 0 0 1px 1px rgba(255,255,255,0.6)',
              animation: centerIsActive && isReady ? 'blobPulse 2s ease-in-out infinite' : 'none',
              zIndex: 1,
              willChange: 'transform, opacity',
            }}
          />

          {/* 上一篇图标 */}
          {hasPrev && (
            <motion.div
              className="absolute flex items-center justify-center z-10"
              style={{
                width: `${SIDE_ICON_SIZE}px`,
                height: `${SIDE_ICON_SIZE}px`,
                x: sideSpreadNeg,
                scale: prevIconScale,
                opacity: prevIconOpacity,
                willChange: 'transform, opacity',
              }}
            >
              <ChevronLeft
                style={{
                  width: '24px',
                  height: '24px',
                  color: snappedTo === 'prev' ? 'var(--text-primary, #000)' : 'var(--text-muted, #777)',
                  strokeWidth: snappedTo === 'prev' ? 2.5 : 2,
                  transition: 'color 0.25s, stroke-width 0.25s',
                }}
              />
            </motion.div>
          )}

          {/* 中央图标（返回箭头） */}
          <motion.div
            className="absolute flex items-center justify-center z-10"
            style={{
              width: `${CIRCLE_MAX}px`,
              height: `${CIRCLE_MAX}px`,
              scale: arrowScale,
              opacity: centerIconOpacity,
              willChange: 'transform, opacity',
            }}
          >
            <motion.div style={{ rotate: arrowRotation }}>
              <ArrowLeft
                style={{
                  width: '24px',
                  height: '24px',
                  color: centerIsActive && isReady
                    ? 'var(--text-primary, #000)'
                    : centerIsActive
                      ? 'var(--text-secondary, #444)'
                      : 'var(--text-muted, #888)',
                  strokeWidth: centerIsActive && isReady ? 2.5 : 2,
                  transition: 'color 0.2s, stroke-width 0.2s',
                  filter: !isReady && centerIsActive
                    ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))'
                    : 'none',
                }}
              />
            </motion.div>
          </motion.div>

          {/* 下一篇图标 */}
          {hasNext && (
            <motion.div
              className="absolute flex items-center justify-center z-10"
              style={{
                width: `${SIDE_ICON_SIZE}px`,
                height: `${SIDE_ICON_SIZE}px`,
                x: sideSpread,
                scale: nextIconScale,
                opacity: nextIconOpacity,
                willChange: 'transform, opacity',
              }}
            >
              <ChevronRight
                style={{
                  width: '24px',
                  height: '24px',
                  color: snappedTo === 'next' ? 'var(--text-primary, #000)' : 'var(--text-muted, #777)',
                  strokeWidth: snappedTo === 'next' ? 2.5 : 2,
                  transition: 'color 0.25s, stroke-width 0.25s',
                }}
              />
            </motion.div>
          )}
        </div>

        {/* 标签文案 */}
        <div
          className="mt-1 text-[11px] font-medium whitespace-nowrap"
          style={{
            color: 'var(--text-secondary, #666)',
            opacity: isReady ? 1 : 0,
            transform: isReady ? 'translateY(0)' : 'translateY(6px)',
            transition: 'opacity 0.2s, transform 0.2s',
          }}
        >
          {labelText}
        </div>

        {/* 松手提示 */}
        <div
          className="mt-1.5 text-[10px] font-medium"
          style={{
            color: 'var(--text-muted, #999)',
            opacity: isReady ? 0.6 : 0,
            transform: isReady ? 'translateY(0)' : 'translateY(4px)',
            transition: 'opacity 0.25s, transform 0.25s',
          }}
        >
          松手{labelText}
        </div>
      </motion.div>

      <style jsx>{`
        @keyframes blobPulse {
          0%, 100% { box-shadow: 0 2px 20px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04); }
          50% { box-shadow: 0 4px 30px rgba(0,0,0,0.12), 0 0 0 1.5px rgba(0,0,0,0.06); }
        }
      `}</style>
    </motion.div>,
    document.body
  );
}

export default memo(MobileBottomPullNavBase);
