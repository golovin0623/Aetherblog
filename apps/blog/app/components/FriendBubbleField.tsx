'use client';

/**
 * FriendBubbleField —— Apple Watch 表盘式友链星群
 * -----------------------------------------------------------
 * 交互模型对标 watchOS 主屏 + macOS Dock:
 *  1. 蜂窝几何:数学计算的错行圆阵,逐行居中,天然形成蜂窝错位;
 *  2. 球面衰减:离星群中心越远的气泡基础缩放越小(表盘的球面透视);
 *  3. 指针磁吸:光标滑过时,影响半径内的气泡以余弦衰减放大并上浮,
 *     由 spring.precise 弹簧平滑(Dock 的鱼眼手感);
 *  4. 涟漪绽放:入场时从星群中心向外按距离延迟弹出(watchOS 开屏);
 *  5. 待机漂浮:每颗气泡以 ambient 时长错相位缓漂,星群"活着";
 *  6. prefers-reduced-motion:磁吸/漂浮关闭,入场降级为淡入。
 */

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { spring } from '@aetherblog/ui';
import {
  markCachedImageFailed,
  markCachedImageLoaded,
  useCachedImage,
} from '@aetherblog/hooks';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';
import type { FriendLink } from '../lib/services';

/* ── 表盘几何常量 ─────────────────────────────────────── */
const ICON_MOBILE = 52;
const ICON_DESKTOP = 72;
const GAP_MOBILE = 16;
const GAP_DESKTOP = 20;
/** 移动端图标下方名字所占高度(桌面端纯图标,靠磁吸呼出卡片) */
const LABEL_SPACE_MOBILE = 30;
/** 指针磁吸最大增幅 */
const MAX_BOOST = 0.32;
/** 磁吸影响半径 = 图标直径 × 系数 */
const INFLUENCE = 2.35;
/** 球面衰减:最边缘气泡缩小到 1 - EDGE_FALLOFF */
const EDGE_FALLOFF = 0.16;
/** 指针离场时的"无穷远"坐标,让所有 boost 归零 */
const OFFSCREEN = -10000;
/** 涟漪绽放总时长(秒):最远气泡的入场延迟 */
const BLOOM_SPAN = 0.36;

// 多层阴影:外部投影 + 内部高光 → 3D 气泡质感
const BUBBLE_SHADOW = [
  '0 2px 8px rgba(0,0,0,0.12)',
  '0 6px 20px rgba(0,0,0,0.08)',
  'inset 0 1px 1px rgba(255,255,255,0.15)',
].join(', ');

interface BubbleSlot {
  x: number;
  y: number;
  row: number;
  /** 0..1,距星群中心的归一化距离 */
  centerDist: number;
}

interface FieldLayout {
  slots: BubbleSlot[];
  height: number;
}

/** 蜂窝布局:偶数行 N 列、奇数行 N-1 列,逐行水平居中 */
function layoutHoneycomb(
  count: number,
  width: number,
  size: number,
  gap: number,
  labelSpace: number,
): FieldLayout {
  const cell = size + gap;
  // 列数取「容器可容纳」与「√N 近圆簇」的较小者:
  // watchOS 的星群是团簇而非长条,列数随数量开方增长,让 14 颗星
  // 排成 5+4+5 的圆簇而不是 9+5 的扁带。
  const fitCols = Math.floor((width + gap) / cell);
  const clusterCols = Math.ceil(Math.sqrt(count) * 1.25);
  const cols = Math.max(3, Math.min(fitCols, clusterCols));
  // 桌面(无标签)用 0.866 六边形紧密堆积;移动端为标签留出行距
  const rowPitch = labelSpace > 0 ? size + labelSpace + gap * 0.5 : cell * 0.866;

  const raw: Array<{ x: number; y: number; row: number }> = [];
  let row = 0;
  let placed = 0;
  while (placed < count) {
    const rowCap = Math.max(row % 2 === 1 ? cols - 1 : cols, 1);
    const rowCount = Math.min(rowCap, count - placed);
    const startX = (width - (rowCount * cell - gap)) / 2;
    for (let i = 0; i < rowCount; i++) {
      raw.push({
        x: startX + i * cell + size / 2,
        y: row * rowPitch + size / 2,
        row,
      });
    }
    placed += rowCount;
    row += 1;
  }

  const height = row === 0 ? 0 : (row - 1) * rowPitch + size + labelSpace;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.max(
    1,
    ...raw.map((p) => Math.hypot(p.x - cx, p.y - cy)),
  );
  return {
    slots: raw.map((p) => ({
      ...p,
      centerDist: Math.hypot(p.x - cx, p.y - cy) / maxDist,
    })),
    height,
  };
}

/* ═══════════════════════════════════════════════════════════
 * 单颗气泡
 * ═══════════════════════════════════════════════════════════ */

interface WatchBubbleProps {
  friend: FriendLink;
  slot: BubbleSlot;
  size: number;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  magnetEnabled: boolean;
  reduceMotion: boolean;
  showLabel: boolean;
  hovered: boolean;
  onHoverChange: (id: number | null) => void;
  /** 待机漂浮的相位索引 */
  driftIndex: number;
}

const WatchBubble: React.FC<WatchBubbleProps> = ({
  friend,
  slot,
  size,
  pointerX,
  pointerY,
  magnetEnabled,
  reduceMotion,
  showLabel,
  hovered,
  onHoverChange,
  driftIndex,
}) => {
  const { x, y, row, centerDist } = slot;
  // 球面透视:边缘气泡基础缩放按距离平方衰减
  const baseScale = 1 - EDGE_FALLOFF * centerDist * centerDist;
  const radius = size * INFLUENCE;

  /* 指针磁吸:距离 → 余弦衰减增幅 → 弹簧平滑 */
  const boost = useTransform(
    [pointerX, pointerY] as [MotionValue<number>, MotionValue<number>],
    ([px, py]: number[]) => {
      if (!magnetEnabled) return 0;
      const d = Math.hypot(px - x, py - y);
      if (d >= radius) return 0;
      return (MAX_BOOST * (Math.cos((d / radius) * Math.PI) + 1)) / 2;
    },
  );
  const scale = useSpring(
    useTransform(boost, (b) => baseScale * (1 + b)),
    { stiffness: spring.precise.stiffness, damping: spring.precise.damping },
  );
  const lift = useSpring(
    useTransform(boost, (b) => -10 * (b / MAX_BOOST)),
    { stiffness: spring.precise.stiffness, damping: spring.precise.damping },
  );

  /* 头像加载(带缓存与降级)。themeColor 需拦住空字符串(产线 DB 存在),
     否则降级渐变失效渲染成"黑洞球"。 */
  const safeAvatar = sanitizeImageUrl(friend.logo || '', '');
  const safeUrl = sanitizeImageUrl(friend.url, '#');
  const themeColor = (friend.themeColor || '').trim() || '#6366f1';
  const hasValidAvatar = safeAvatar !== '' && safeAvatar.trim() !== '';
  const cachedAvatar = useCachedImage(hasValidAvatar ? safeAvatar : '', {
    enabled: hasValidAvatar,
    timeoutMs: 5000,
  });
  const showFallback = !hasValidAvatar || cachedAvatar.isError;

  const handleImageLoad = useCallback(
    (img: HTMLImageElement) => {
      markCachedImageLoaded(safeAvatar, img.naturalWidth || undefined, img.naturalHeight || undefined);
    },
    [safeAvatar],
  );
  const handleImageError = useCallback(() => markCachedImageFailed(safeAvatar), [safeAvatar]);

  const handleEnter = useCallback(() => onHoverChange(friend.id), [friend.id, onHoverChange]);
  const handleLeave = useCallback(() => onHoverChange(null), [onHoverChange]);

  const domain = useMemo(() => {
    try {
      return new URL(safeUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }, [safeUrl]);

  // 涟漪绽放:延迟正比于到星群中心的距离
  const bloomDelay = centerDist * BLOOM_SPAN;

  return (
    <div
      className="absolute"
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        zIndex: hovered ? 30 : 1,
      }}
    >
      {/* L2 · 入场绽放层 */}
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={
          reduceMotion
            ? { duration: 0.01 }
            : { ...spring.soft, delay: bloomDelay }
        }
        className="h-full w-full"
      >
        {/* L3 · 待机漂浮层(CSS ambient,reduced-motion 下自动停用) */}
        <div
          className="friend-bubble-drift h-full w-full"
          style={{
            animationDelay: `calc(var(--dur-ambient) * ${-((driftIndex % 7) * 0.42).toFixed(2)})`,
            animationDuration: `calc(var(--dur-ambient) * ${(3 + (driftIndex % 5) * 0.35).toFixed(2)})`,
          }}
        >
          {/* L4 · 磁吸缩放层 */}
          <motion.div className="h-full w-full" style={{ scale, y: lift }}>
            <motion.a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`访问 ${friend.name} 的网站`}
              className="group relative block h-full w-full rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]"
              whileTap={{ scale: 0.9, transition: { ...spring.precise } }}
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
              onFocus={handleEnter}
              onBlur={handleLeave}
            >
              {/* 品牌色氛围光:hover 时气泡自体发光 */}
              <div
                className="absolute -inset-2.5 rounded-full blur-lg transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)]"
                style={{ backgroundColor: themeColor, opacity: hovered ? 0.38 : 0 }}
                aria-hidden="true"
              />

              {/* 圆形图标主体 */}
              <div
                className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full"
                style={{ boxShadow: BUBBLE_SHADOW }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: showFallback
                      ? `linear-gradient(145deg, ${themeColor}, ${themeColor}cc)`
                      : 'var(--bg-raised)',
                  }}
                  aria-hidden="true"
                />
                {/* 玻璃高光弧 —— Apple 球面反射 */}
                <div
                  className="pointer-events-none absolute inset-0 z-[2]"
                  style={{
                    background:
                      'radial-gradient(ellipse 70% 40% at 50% 12%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 50%, transparent 70%)',
                  }}
                  aria-hidden="true"
                />
                {!showFallback ? (
                  <Image
                    src={safeAvatar}
                    alt={friend.name}
                    width={size}
                    height={size}
                    onLoadingComplete={handleImageLoad}
                    onError={handleImageError}
                    className={`relative z-[1] h-full w-full object-cover transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)] ${
                      cachedAvatar.isLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                    aria-hidden="true"
                    /* 外部任意域名头像,关闭 next/image 白名单校验与 srcset 优化 */
                    unoptimized
                  />
                ) : (
                  <span
                    className="relative z-[1] select-none font-semibold text-white"
                    style={{ fontSize: Math.round(size * 0.36) }}
                    aria-hidden="true"
                  >
                    {friend.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* 移动端:图标下方名字(桌面端由磁吸呼出卡片承担) */}
              {showLabel && (
                <span
                  className="absolute left-1/2 top-full mt-1.5 block max-w-[calc(100%+24px)] -translate-x-1/2 truncate text-center text-micro font-medium leading-tight text-[var(--ink-muted)]"
                >
                  {friend.name}
                </span>
              )}
            </motion.a>
          </motion.div>
        </div>
      </motion.div>

      {/* watchOS 呼出卡:悬浮/聚焦时以 bouncy 弹簧浮现(仅桌面) */}
      {!showLabel && (
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: row === 0 ? -8 : 8, scale: 0.86, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, y: row === 0 ? -4 : 4, scale: 0.9, x: '-50%' }}
              transition={{ ...spring.bouncy }}
              className="surface-overlay pointer-events-none absolute left-1/2 z-40 w-max max-w-[220px] rounded-full px-4 py-2"
              style={
                row === 0
                  ? { top: 'calc(100% + 14px)' }
                  : { bottom: 'calc(100% + 14px)' }
              }
              role="tooltip"
            >
              {/* watchOS 式名称呼出:一行胶囊,尽量少遮挡邻近气泡 */}
              <p className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: themeColor }}
                  aria-hidden="true"
                />
                <span className="truncate text-caption font-semibold text-[var(--ink-primary)]">
                  {friend.name}
                </span>
                {domain && (
                  <span className="truncate font-mono text-micro text-[var(--ink-muted)]">
                    {domain}
                  </span>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
 * 星群容器
 * ═══════════════════════════════════════════════════════════ */

interface FriendBubbleFieldProps {
  friends: FriendLink[];
  isMobile: boolean;
}

export default function FriendBubbleField({ friends, isMobile }: FriendBubbleFieldProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

  const pointerX = useMotionValue(OFFSCREEN);
  const pointerY = useMotionValue(OFFSCREEN);

  const size = isMobile ? ICON_MOBILE : ICON_DESKTOP;
  const gap = isMobile ? GAP_MOBILE : GAP_DESKTOP;
  const labelSpace = isMobile ? LABEL_SPACE_MOBILE : 0;
  const magnetEnabled = !isMobile && !reduceMotion;

  // 量宽:首帧 layoutEffect 同步测量,resize 时重排
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => (width > 0 ? layoutHoneycomb(friends.length, width, size, gap, labelSpace) : null),
    [friends.length, width, size, gap, labelSpace],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!magnetEnabled || !fieldRef.current) return;
      const rect = fieldRef.current.getBoundingClientRect();
      pointerX.set(event.clientX - rect.left);
      pointerY.set(event.clientY - rect.top);
    },
    [magnetEnabled, pointerX, pointerY],
  );

  const handleMouseLeave = useCallback(() => {
    pointerX.set(OFFSCREEN);
    pointerY.set(OFFSCREEN);
    setHoveredId(null);
  }, [pointerX, pointerY]);

  return (
    <div className="relative py-6 md:py-10">
      {/* 表盘中心环境光 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[60%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
        style={{ background: 'color-mix(in oklch, var(--aurora-1) 7%, transparent)' }}
        aria-hidden="true"
      />

      <div
        ref={fieldRef}
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: layout ? layout.height : size * 3 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {layout &&
          friends.map((friend, i) => (
            <WatchBubble
              key={friend.id}
              friend={friend}
              slot={layout.slots[i]}
              size={size}
              pointerX={pointerX}
              pointerY={pointerY}
              magnetEnabled={magnetEnabled}
              reduceMotion={reduceMotion}
              showLabel={isMobile}
              hovered={hoveredId === friend.id}
              onHoverChange={setHoveredId}
              driftIndex={i}
            />
          ))}
      </div>
    </div>
  );
}
