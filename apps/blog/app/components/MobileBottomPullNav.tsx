/**
 * @file MobileBottomPullNav.tsx
 * @description 移动端底部上滑快捷导航 — 灵感源自 Google Chrome 移动端下拉刷新手势
 *
 * 交互逻辑（Chrome 风格）：
 * 1. 用户在文章底部继续上滑 → 中心圆圈（返回箭头）从底部升起，尺寸渐增，箭头旋转
 * 2. 上滑过半 → 两侧按钮（上一篇/下一篇）从中心展开渐入
 * 3. 达到就绪态 → 圆圈出现选中态背景 + 脉冲动画，显示提示文字
 * 4. 按住横滑 → 选中背景磁性吸附到目标按钮，圆圈弹性变形（椭圆拉伸）
 * 5. 松手 → 执行选中操作（返回/上一篇/下一篇）
 */

'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';

/* ─── Types ─── */

interface PostBrief {
  slug: string;
  title: string;
}

interface MobileBottomPullNavProps {
  prevPost?: PostBrief | null;
  nextPost?: PostBrief | null;
}

type SnapTarget = 'prev' | 'center' | 'next';

interface GestureState {
  /** 手势是否激活中 */
  active: boolean;
  /** 0→1 纵向上拉进度 */
  pullProgress: number;
  /** 相对于手势起始点的水平偏移量（向左为负，向右为正），单位 px */
  lateralOffset: number;
  /** 当前吸附到的按钮 */
  snappedTo: SnapTarget;
  /** 上拉进度是否已达到就绪阈值 */
  isReady: boolean;
}

/* ─── Constants ─── */

/** 上拉激活前的无效区 */
const DEAD_ZONE = 18;
/** 达到满进度所需的上拉距离 */
const FULL_PULL = 120;
/** 触发动作所需的最小进度 */
const RELEASE_THRESHOLD = 0.4;
/** 侧边按钮开始出现的进度阈值 */
const SIDE_APPEAR_THRESHOLD = 0.45;
/** 吸附到侧边按钮所需的水平偏移量 */
const SNAP_THRESHOLD = 60;
/** 迟滞：从吸附状态回到中心所需越过的最小绝对距离 */
const UNSNAP_THRESHOLD = 25;

/** 中心圆大小范围 */
const CIRCLE_MIN = 0;
const CIRCLE_MAX = 56;
/** 侧边图标大小 */
const SIDE_ICON_SIZE = 48;
/** 中心圆与侧边按钮之间的间距 */
const SIDE_SPACING = 96;

/* ─── Helpers ─── */

/** 将值钳制在 [min, max] 范围内 */
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** 三次缓出函数 */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** 线性插值 */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 尝试触发触觉反馈 */
const vibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
};

/* ─── Component ─── */

function MobileBottomPullNavBase({ prevPost, nextPost }: MobileBottomPullNavProps) {
  const [gesture, setGesture] = useState<GestureState>({
    active: false,
    pullProgress: 0,
    lateralOffset: 0,
    snappedTo: 'center',
    isReady: false,
  });
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
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<GestureState | null>(null);

  useEffect(() => { prevPostRef.current = prevPost; }, [prevPost]);
  useEffect(() => { nextPostRef.current = nextPost; }, [nextPost]);
  useEffect(() => { setMounted(true); }, []);

  // ── Mobile detection ──
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    onChange(mql);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // ── Helpers ──
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

  /** 经 RAF 节流的手势状态更新 */
  const scheduleUpdate = useCallback((state: GestureState) => {
    pendingRef.current = state;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        if (pendingRef.current) setGesture(pendingRef.current);
        rafRef.current = null;
      });
    }
  }, []);

  // ── Touch handlers ──
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
      const deltaY = t.startY - touch.clientY; // positive = swipe up

      if (deltaY < DEAD_ZONE) {
        if (t.pulling) {
          t.pulling = false;
          scheduleUpdate({
            active: false,
            pullProgress: 0,
            lateralOffset: 0,
            snappedTo: 'center',
            isReady: false,
          });
        }
        return;
      }

      // 进入上拉手势
      if (!t.pulling) {
        t.pulling = true;
        vibrate(8);
      }

      e.preventDefault();

      const pullProgress = clamp((deltaY - DEAD_ZONE) / FULL_PULL, 0, 1);
      const lateralOffset = touch.clientX - t.startX;
      const isReady = pullProgress >= RELEASE_THRESHOLD;

      // 进入就绪状态时触发触觉反馈
      if (isReady && !t.wasReady) {
        vibrate(12);
        t.wasReady = true;
      } else if (!isReady && t.wasReady) {
        t.wasReady = false;
      }

      // 具有强迟滞的吸附逻辑
      let snappedTo: SnapTarget = t.prevSnap;

      if (isReady && pullProgress > SIDE_APPEAR_THRESHOLD) {
        const hasPrev = !!prevPostRef.current;
        const hasNext = !!nextPostRef.current;

        if (snappedTo === 'center') {
          // 从中心脱离需要越过吸附阈值
          if (lateralOffset < -SNAP_THRESHOLD && hasPrev) {
            snappedTo = 'prev';
            vibrate(10);
          } else if (lateralOffset > SNAP_THRESHOLD && hasNext) {
            snappedTo = 'next';
            vibrate(10);
          }
        } else if (snappedTo === 'prev') {
          // 从"上一篇"脱离，需向右移动超过 -UNSNAP_THRESHOLD
          if (lateralOffset > -UNSNAP_THRESHOLD) {
            snappedTo = 'center';
            vibrate(5);
          }
        } else if (snappedTo === 'next') {
          // 从"下一篇"脱离，需向左移动超过 UNSNAP_THRESHOLD
          if (lateralOffset < UNSNAP_THRESHOLD) {
            snappedTo = 'center';
            vibrate(5);
          }
        }
      } else {
        snappedTo = 'center';
      }

      t.prevSnap = snappedTo;

      scheduleUpdate({
        active: true,
        pullProgress,
        lateralOffset,
        snappedTo,
        isReady,
      });
    };

    const onTouchEnd = () => {
      const t = touchRef.current;
      if (!t.pulling) return;

      t.pulling = false;
      t.atBottom = false;

      setGesture((prev) => {
        if (prev.isReady) {
          const target = prev.snappedTo;
          vibrate([5, 50, 15]);
          requestAnimationFrame(() => navigate(target));
        }
        return {
          active: false,
          pullProgress: 0,
          lateralOffset: 0,
          snappedTo: 'center',
          isReady: false,
        };
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
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isMobile, isAtBottom, navigate, scheduleUpdate]);

  // ── Render ──
  if (!isMobile || !mounted) return null;

  const { active, pullProgress, lateralOffset, snappedTo, isReady } = gesture;
  const easedProgress = easeOut(pullProgress);

  // ── Computed visual values ──

  // 中心圆大小：0 → CIRCLE_MAX
  const circleSize = lerp(CIRCLE_MIN, CIRCLE_MAX, easedProgress);
  // 箭头旋转：90°（向上）→ 0°（向左）
  const arrowRotation = lerp(90, 0, clamp(pullProgress * 2, 0, 1));
  // 整体 translateY：从底部向上升起
  const translateY = active ? lerp(80, 0, easedProgress) : 80;
  const opacity = active ? clamp(pullProgress * 2.5, 0, 1) : 0;

  // 侧边按钮可见性：超过阈值后出现
  const sideProgress = clamp((pullProgress - SIDE_APPEAR_THRESHOLD) / (1 - SIDE_APPEAR_THRESHOLD), 0, 1);
  const sideEased = easeOut(sideProgress);
  const sideOpacity = sideEased;
  // 侧边按钮从中心向两侧展开
  const sideSpread = lerp(0, SIDE_SPACING, sideEased);
  const sideScale = lerp(0.3, 1, sideEased);

  // ── Magnetic snap deformation (Single Unified Blob) ──
  
  let blobX = 0;
  let blobScaleX = 1;
  let blobScaleY = 1;

  // 1. Identify where the blob "wants" to be base on current snap state
  const blobBaseX = snappedTo === 'prev' ? -sideSpread : snappedTo === 'next' ? sideSpread : 0;

  if (isReady && active) {
    let dragDist = 0;
    
    // 2. 计算手指与圆球理想基准位置之间的距离
    // 但仅在手指拉力*方向与吸附位置相反*时才拉伸形变
    if (snappedTo === 'center') {
      dragDist = lateralOffset;
    } else if (snappedTo === 'prev') {
      // 仅在从 -50 位置向右（回到中心方向）拉动时才拉伸
      if (lateralOffset > -50) dragDist = lateralOffset + 50;
    } else if (snappedTo === 'next') {
      // 仅在从 50 位置向左（回到中心方向）拉动时才拉伸
      if (lateralOffset < 50) dragDist = lateralOffset - 50;
    }

    // 3. Apply stickiness: blob moves slightly with finger but strongly resists
    blobX = blobBaseX + clamp(dragDist * 0.25, -20, 20);

    // 4. Apply elastic deformation: stretches more as finger pulls further from snapped center
    const stretchFactor = Math.abs(dragDist) / 100;
    blobScaleX = 1 + clamp(stretchFactor, 0, 0.4);  // Max 40% wider
    blobScaleY = 1 - clamp(stretchFactor * 0.4, 0, 0.15); // Max 15% shorter
  } else {
    // 未就绪或手指已释放时，严格遵守基准位置和球形形状
    blobX = blobBaseX;
  }

  // ── Active icon highlighting ──
  const isCenterActive = snappedTo === 'center';
  const isPrevActive = snappedTo === 'prev';
  const isNextActive = snappedTo === 'next';

  // 透明度：非激活图标完全隐藏，减少视觉干扰
  const prevIconOpacity = isPrevActive ? 1 : (isCenterActive ? sideOpacity * 0.5 : 0);
  const nextIconOpacity = isNextActive ? 1 : (isCenterActive ? sideOpacity * 0.5 : 0);
  const centerIconOpacity = isCenterActive ? 1 : 0;

  const hasPrev = !!prevPost;
  const hasNext = !!nextPost;

  // 确定标签文本
  const labelText = snappedTo === 'prev' && hasPrev
    ? '上一篇'
    : snappedTo === 'next' && hasNext
      ? '下一篇'
      : '返回';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] pointer-events-none"
      aria-hidden="true"
      style={{
        visibility: active ? 'visible' : 'hidden',
        opacity,
      }}
    >
      {/* 半透明背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/5 dark:bg-black/20"
        style={{
          opacity: clamp(pullProgress * 1.5, 0, 1),
          // 强力滑动时对背景施加轻微模糊
          backdropFilter: `blur(${clamp(pullProgress * 2, 0, 4)}px)`,
          transition: active ? 'none' : 'opacity 0.3s ease-out, backdrop-filter 0.3s',
        }}
      />

      {/* ── Navigation Container ── */}
      <div
        className="absolute left-1/2 flex flex-col items-center"
        style={{
          bottom: '56px',
          transform: `translate(-50%, ${translateY}px)`,
          transition: active ? 'none' : 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* ── Icons & Background Layer ── */}
        <div className="relative flex items-center justify-center" style={{ height: `${CIRCLE_MAX}px`, width: '100%' }}>

          {/* ── ONE Unified Selection Blob (Magnetic Background) ── */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: `${circleSize}px`, // Follows pull growth 0 -> CIRCLE_MAX
              height: `${circleSize}px`,
              transform: `translateX(${blobX}px) scaleX(${blobScaleX}) scaleY(${blobScaleY})`,
              background: 'var(--bg-secondary, rgba(235, 235, 240, 0.9))',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12), inset 0 0 1px 1px rgba(255,255,255,0.6)',
              opacity: clamp(pullProgress * 5, 0, 1), // Rises sharply from 0 to 1
              // Spring physics transition for blob movement and rescale
              transition: active
                ? 'transform 0.35s cubic-bezier(0.34, 1.56, 0.5, 1), width 0.2s, height 0.2s'
                : 'all 0.4s ease-out',
              animation: isCenterActive && isReady ? 'blobPulse 2s ease-in-out infinite' : 'none',
              zIndex: 1, // Behind the icons
            }}
          />

          {/* ── Prev Icon ── */}
          {hasPrev && (
            <div
              className="absolute flex items-center justify-center z-10"
              style={{
                width: `${SIDE_ICON_SIZE}px`,
                height: `${SIDE_ICON_SIZE}px`,
                transform: `translateX(${-sideSpread}px) scale(${isPrevActive ? 1.2 : sideScale})`,
                opacity: prevIconOpacity,
                transition: active
                  ? 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s'
                  : 'all 0.3s ease-out',
              }}
            >
              <ChevronLeft
                style={{
                  width: '24px', height: '24px',
                  color: isPrevActive ? 'var(--text-primary, #000)' : 'var(--text-muted, #777)',
                  strokeWidth: isPrevActive ? 2.5 : 2,
                  transition: 'all 0.25s',
                }}
              />
            </div>
          )}

          {/* ── Center Icon (Back) ── */}
          <div
            className="absolute flex items-center justify-center z-10"
            style={{
              width: `${CIRCLE_MAX}px`,
              height: `${CIRCLE_MAX}px`,
              transition: active ? 'none' : 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <ArrowLeft
              style={{
                width: `${clamp(circleSize * 0.42, 0, 24)}px`,
                height: `${clamp(circleSize * 0.42, 0, 24)}px`,
                transform: `rotate(${-arrowRotation}deg)`,
                color: isCenterActive && isReady
                  ? 'var(--text-primary, #000)'
                  : isCenterActive
                    ? 'var(--text-secondary, #444)'
                    : 'var(--text-muted, #888)',
                opacity: centerIconOpacity,
                strokeWidth: isCenterActive && isReady ? 2.5 : 2,
                transition: 'color 0.2s, opacity 0.2s',
                // Subtle drop shadow when standing strictly alone (unready)
                filter: (!isReady && isCenterActive && circleSize > 15) 
                  ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' 
                  : 'none'
              }}
            />
          </div>

          {/* ── Next Icon ── */}
          {hasNext && (
            <div
              className="absolute flex items-center justify-center z-10"
              style={{
                width: `${SIDE_ICON_SIZE}px`,
                height: `${SIDE_ICON_SIZE}px`,
                transform: `translateX(${sideSpread}px) scale(${isNextActive ? 1.2 : sideScale})`,
                opacity: nextIconOpacity,
                transition: active
                  ? 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s'
                  : 'all 0.3s ease-out',
              }}
            >
              <ChevronRight
                style={{
                  width: '24px', height: '24px',
                  color: isNextActive ? 'var(--text-primary, #000)' : 'var(--text-muted, #777)',
                  strokeWidth: isNextActive ? 2.5 : 2,
                  transition: 'all 0.25s',
                }}
              />
            </div>
          )}
        </div>

        {/* ── Label Text ── */}
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

        {/* ── Release Hint ── */}
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
      </div>

      {/* ── Keyframe animation for blob pulse ── */}
      <style jsx>{`
        @keyframes blobPulse {
          0%, 100% { box-shadow: 0 2px 20px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04); }
          50% { box-shadow: 0 4px 30px rgba(0,0,0,0.12), 0 0 0 1.5px rgba(0,0,0,0.06); }
        }
      `}</style>
    </div>,
    document.body
  );
}

export default memo(MobileBottomPullNavBase);
