'use client';

import React from 'react';

/**
 * @file useSpotlightEffect.ts
 * @description 聚光灯效果自定义 Hook，统一管理鼠标跟随高光交互逻辑
 * @ref Issue #245 - 提取重复的 spotlight 逻辑到自定义 Hook
 */

interface UseSpotlightEffectOptions {
  /**
   * 聚光灯圆形渐变的半径（px），默认 600
   */
  radius?: number;
  /**
   * 是否为 `position: fixed` 且在视口 (0,0) 处的元素。
   * 为 true 时直接使用 `clientX/clientY`，无需 `getBoundingClientRect`。
   */
  fixed?: boolean;
}

interface UseSpotlightEffectReturn {
  /** 绑定到聚光灯覆盖层 <div> 的 ref */
  spotlightRef: React.RefObject<HTMLDivElement | null>;
  /** 当前是否处于 hover 状态 */
  isHovering: boolean;
  /** 设置 hover 状态（BlogHeader 等需要额外控制） */
  setIsHovering: React.Dispatch<React.SetStateAction<boolean>>;
  /** 绑定到容器的 onMouseEnter */
  handleMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  /** 绑定到容器的 onMouseLeave */
  handleMouseLeave: () => void;
  /** 绑定到容器的 onMouseMove */
  handleMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * 聚光灯效果 Hook
 *
 * 原先在 ArticleCard、FeaturedPost、AuthorProfileCard、BlogHeader 四个组件中
 * 重复实现的鼠标跟随高光逻辑，统一提取至此。
 *
 * @example
 * ```tsx
 * const { spotlightRef, isHovering, handleMouseEnter, handleMouseLeave, handleMouseMove }
 *   = useSpotlightEffect({ radius: 600 });
 *
 * <div onMouseMove={handleMouseMove} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
 *   <div ref={spotlightRef} style={{ opacity: isHovering ? 'var(--spotlight-opacity)' : 0 }} />
 * </div>
 * ```
 */
export function useSpotlightEffect(
  options: UseSpotlightEffectOptions = {},
): UseSpotlightEffectReturn {
  const { radius = 600, fixed = false } = options;

  const spotlightRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number>(0);
  const rectRef = React.useRef<{ left: number; top: number } | null>(null);
  const [isHovering, setIsHovering] = React.useState(false);

  // 清理动画帧
  React.useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const handleMouseEnter = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      setIsHovering(true);
      if (!fixed) {
        const rect = e.currentTarget.getBoundingClientRect();
        rectRef.current = {
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
        };
      }
    },
    [fixed],
  );

  const handleMouseLeave = React.useCallback(() => {
    setIsHovering(false);
    rectRef.current = null;
  }, []);

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!spotlightRef.current) return;
      if (!fixed && !rectRef.current) return;

      // fixed 元素直接使用视口坐标，非 fixed 元素使用缓存的文档坐标
      const x = fixed ? e.clientX : e.pageX - rectRef.current!.left;
      const y = fixed ? e.clientY : e.pageY - rectRef.current!.top;

      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        if (!spotlightRef.current) {
          frameRef.current = 0;
          return;
        }
        spotlightRef.current.style.background = `radial-gradient(${radius}px circle at ${x}px ${y}px, var(--spotlight-color), transparent 40%)`;
        frameRef.current = 0;
      });
    },
    [fixed, radius],
  );

  return {
    spotlightRef,
    isHovering,
    setIsHovering,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
  };
}

export default useSpotlightEffect;
