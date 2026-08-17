import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  buildResonantCoverComposition,
  hashMusicCoverSeed,
  paintResonantCover,
  resolveCoverParticleCount,
} from './musicCoverArt';
import { COVER_PRESETS } from './coverPresets';

// 计算艺术封面缩略图 —— 与封面工作室同一渲染核心。
// seed 由业务身份(playlist:id:name / track:id:title)决定,
// 同一实体在列表、Hero、候选面板里永远呈现同一张脸,没有封面的歌单也有可辨识的视觉锚点。

export function ResonantThumb({
  identity,
  className,
  fallbackSize = 64,
}: {
  identity: string;
  className?: string;
  /** 元素尚未完成布局时(clientWidth 为 0)使用的画布尺寸 */
  fallbackSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 用 useEffect 而非 useLayoutEffect:画布盒子有固定 CSS 尺寸,不存在布局抖动,
  // 但同步绘制会把上百张缩略图的绘制成本压在首帧之前。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssSize = canvas.clientWidth || fallbackSize;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(24, Math.round(cssSize * dpr));
    canvas.width = px;
    canvas.height = px;
    const context = canvas.getContext('2d');
    if (!context) return;
    const seed = hashMusicCoverSeed(identity);
    const preset = COVER_PRESETS[seed % COVER_PRESETS.length];
    const composition = buildResonantCoverComposition({
      seed,
      width: px,
      height: px,
      // 粒子数随实际位图尺寸缩放 —— 44px 缩略图上 460 条流丝几乎完全重叠,纯属浪费
      particleCount: resolveCoverParticleCount(px),
      orbitCount: Math.min(preset.orbits, 8),
      turbulence: preset.turbulence,
    });
    paintResonantCover(context, composition, preset.palette, px, px);
  }, [fallbackSize, identity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('block h-full w-full', className)}
    />
  );
}

// 封面缩略:有真实封面用图片,没有则退到确定性的计算艺术封面。
export function MusicCoverThumb({
  src,
  identity,
  alt = '',
  className,
}: {
  src?: string;
  identity: string;
  alt?: string;
  className?: string;
}) {
  // 封面文件可能已被删除或对象存储 404 —— 破图会破坏「同一实体永远同一张脸」的契约,
  // 加载失败一律退回确定性计算封面。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={cn('block h-full w-full object-cover', className)}
      />
    );
  }
  return <ResonantThumb identity={identity} className={className} />;
}
