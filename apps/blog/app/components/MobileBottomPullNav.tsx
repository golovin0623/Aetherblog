/**
 * @file MobileBottomPullNav.tsx
 * @description 移动端底部上滑快捷导航 — 灵感源自 Chrome 移动端下拉刷新手势
 *
 * 交互逻辑：
 * 1. 用户在文章底部（评论区下方）继续上滑时，从屏幕底部升起一个胶囊导航
 * 2. 手指左右滑动可在三个操作间切换：上一篇 / 返回 / 下一篇
 * 3. 松手时执行选中的操作
 *
 * 视觉设计：采用项目 "Cognitive Elegance" 风格 — 毛玻璃胶囊 + 流光选中环 + 环境渐变
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ArrowLeft, ChevronsUp } from 'lucide-react';

/* ─── Types ─── */

interface PostBrief {
  slug: string;
  title: string;
}

interface MobileBottomPullNavProps {
  prevPost?: PostBrief | null;
  nextPost?: PostBrief | null;
}

interface GestureState {
  active: boolean;
  /** 0 → 1, how far the capsule is revealed */
  progress: number;
  /** 0 = prev, 1 = back (center), 2 = next */
  selected: number;
}

/* ─── Constants ─── */

/** Pixel threshold before the pull gesture activates */
const DEAD_ZONE = 18;
/** Pull distance (px) that corresponds to progress = 1 */
const FULL_PULL = 110;
/** Horizontal movement (px) required to switch selection */
const SELECT_THRESHOLD = 36;
/** Minimum progress (0-1) required to execute an action on release */
const RELEASE_THRESHOLD = 0.35;

/* ─── Component ─── */

export default function MobileBottomPullNav({ prevPost, nextPost }: MobileBottomPullNavProps) {
  const [gesture, setGesture] = useState<GestureState>({
    active: false,
    progress: 0,
    selected: 1,
  });
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  const router = useRouter();

  // ── Refs for gesture tracking (avoid stale closures) ──
  const touchRef = useRef({ startY: 0, startX: 0, pulling: false, atBottom: false });
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
    // 页面必须有足够滚动区域，并且当前已滚至底部
    return sh - ch > 50 && st + ch >= sh - 8;
  }, []);

  /** 执行导航操作 */
  const navigate = useCallback((index: number) => {
    if (index === 0 && prevPostRef.current) {
      router.push(`/posts/${prevPostRef.current.slug}`);
    } else if (index === 1) {
      window.history.length > 1 ? router.back() : router.push('/posts');
    } else if (index === 2 && nextPostRef.current) {
      router.push(`/posts/${nextPostRef.current.slug}`);
    }
  }, [router]);

  /** RAF-节流的手势状态更新 */
  const scheduleGestureUpdate = useCallback((state: GestureState) => {
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
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = touchRef.current;
      if (!t.atBottom) return;

      const touch = e.touches[0];
      const deltaY = t.startY - touch.clientY; // 正值 = 上滑

      if (deltaY < DEAD_ZONE) {
        if (t.pulling) {
          t.pulling = false;
          scheduleGestureUpdate({ active: false, progress: 0, selected: 1 });
        }
        return;
      }

      // 进入上滑手势
      if (!t.pulling) {
        t.pulling = true;
        // 尝试触发轻微触觉反馈
        try { navigator.vibrate?.(8); } catch { /* 静默 */ }
      }

      e.preventDefault(); // 阻止原生橡皮筋效果

      const progress = Math.min(1, (deltaY - DEAD_ZONE) / FULL_PULL);
      const deltaX = touch.clientX - t.startX;

      let selected = 1; // 默认：返回
      if (deltaX < -SELECT_THRESHOLD && prevPostRef.current) selected = 0;
      if (deltaX > SELECT_THRESHOLD && nextPostRef.current) selected = 2;

      scheduleGestureUpdate({ active: true, progress, selected });
    };

    const onTouchEnd = () => {
      const t = touchRef.current;
      if (!t.pulling) return;

      t.pulling = false;
      t.atBottom = false;

      // 读取最新手势状态并决定是否执行
      setGesture((prev) => {
        if (prev.progress >= RELEASE_THRESHOLD) {
          const idx = prev.selected;
          // 延迟一帧让视觉反馈显示
          requestAnimationFrame(() => navigate(idx));
        }
        return { active: false, progress: 0, selected: 1 };
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
  }, [isMobile, isAtBottom, navigate, scheduleGestureUpdate]);

  // ── Render ──
  if (!isMobile || !mounted) return null;

  const { active, progress, selected } = gesture;
  const isReady = progress >= RELEASE_THRESHOLD;

  const actions = [
    { key: 'prev', label: '上一篇', Icon: ChevronLeft, enabled: !!prevPost },
    { key: 'back', label: '返回', Icon: ArrowLeft, enabled: true },
    { key: 'next', label: '下一篇', Icon: ChevronRight, enabled: !!nextPost },
  ] as const;

  // 胶囊从底部升起：progress 0 → 完全隐藏, 1 → 完全可见
  const capsuleTranslateY = active ? (1 - progress) * 100 : 100;
  const capsuleOpacity = active ? Math.min(1, progress * 2) : 0;
  const capsuleScale = active ? 0.9 + progress * 0.1 : 0.9;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] pointer-events-none"
      aria-hidden="true"
      style={{
        visibility: active ? 'visible' : 'hidden',
        opacity: capsuleOpacity,
      }}
    >
      {/* 半透明遮罩 */}
      <div
        className="absolute inset-0 bg-black/10 dark:bg-black/25"
        style={{ opacity: Math.min(1, progress * 1.2) }}
      />

      {/* ── 胶囊容器 ── */}
      <div
        className="absolute left-1/2 flex flex-col items-center"
        style={{
          bottom: '28px',
          transform: `translate(-50%, ${capsuleTranslateY}%) scale(${capsuleScale})`,
          transition: active ? 'none' : 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* 上滑提示箭头 */}
        <div
          className="mb-2 transition-opacity duration-200"
          style={{ opacity: isReady ? 0 : Math.min(1, progress * 3) }}
        >
          <ChevronsUp className="w-4 h-4 text-[var(--text-muted)] animate-bounce" />
        </div>

        {/* 毛玻璃胶囊 */}
        <div className="relative flex items-center gap-2 rounded-full bg-[var(--bg-secondary)]/90 dark:bg-[#1a1a26]/90 backdrop-blur-2xl border border-[var(--border-subtle)] dark:border-white/[0.08] shadow-[0_8px_40px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.04)] px-3 py-2.5">
          {/* 环境渐变光晕 */}
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/[0.07] via-transparent to-purple-500/[0.07]" />
            {/* 选中态追踪光晕 */}
            <div
              className="absolute top-0 bottom-0 w-1/3 transition-all duration-200 ease-out"
              style={{
                left: `${(selected / 3) * 100}%`,
                background: isReady
                  ? 'radial-gradient(ellipse at center, var(--color-primary, #818cf8) 0%, transparent 70%)'
                  : 'none',
                opacity: 0.1,
              }}
            />
          </div>

          {/* 滑动选中指示器 — 跟随选中项平滑移动 */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[52px] rounded-full transition-all duration-200 ease-out pointer-events-none"
            style={{
              width: '62px',
              left: `${12 + selected * 66}px`,
              background: isReady
                ? 'linear-gradient(135deg, rgba(129,140,248,0.15), rgba(167,139,250,0.10))'
                : 'rgba(255,255,255,0.04)',
              boxShadow: isReady
                ? '0 0 20px rgba(129,140,248,0.12), inset 0 0 0 1px rgba(129,140,248,0.2)'
                : 'none',
            }}
          />

          {/* ── 三个操作按钮 ── */}
          {actions.map((action, i) => {
            const isSel = selected === i;
            const { Icon } = action;

            return (
              <div
                key={action.key}
                className="relative z-10 flex flex-col items-center"
                style={{
                  width: '58px',
                  opacity: action.enabled ? 1 : 0.25,
                  transform: isSel && isReady ? 'scale(1.12)' : 'scale(1)',
                  transition: 'transform 0.2s ease-out, opacity 0.2s',
                }}
              >
                <div
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-200 ${
                    isSel && action.enabled && isReady
                      ? 'ring-[1.5px] ring-[var(--color-primary)]'
                      : ''
                  }`}
                >
                  <Icon
                    className={`w-[18px] h-[18px] transition-colors duration-150 ${
                      isSel && action.enabled
                        ? 'text-[var(--color-primary)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                    strokeWidth={isSel ? 2.5 : 2}
                  />
                </div>
                <span
                  className={`text-[10px] leading-tight font-medium whitespace-nowrap transition-colors duration-150 mt-0.5 ${
                    isSel && action.enabled
                      ? 'text-[var(--color-primary)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {action.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* 就绪态指示文字 */}
        <div
          className="mt-2 text-[10px] font-medium text-[var(--text-muted)] transition-all duration-200"
          style={{
            opacity: isReady ? 0.7 : 0,
            transform: isReady ? 'translateY(0)' : 'translateY(4px)',
          }}
        >
          松手{actions[selected].enabled ? actions[selected].label : ''}
        </div>
      </div>
    </div>,
    document.body
  );
}
