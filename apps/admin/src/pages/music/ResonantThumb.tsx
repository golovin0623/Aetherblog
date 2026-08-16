import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  buildResonantCoverComposition,
  hashMusicCoverSeed,
  paintResonantCover,
} from './musicCoverArt';
import { COVER_PRESETS } from './coverPresets';

// 计算艺术封面缩略图 —— 与封面工作室同一渲染核心。
// seed 由业务身份(playlist:id:name / track:id:title)决定,
// 同一实体在列表、Hero、候选面板里永远呈现同一张脸,没有封面的歌单也有可辨识的视觉锚点。

const THUMB_PARTICLES = 460;

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

  useLayoutEffect(() => {
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
      particleCount: THUMB_PARTICLES,
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
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        className={cn('block h-full w-full object-cover', className)}
      />
    );
  }
  return <ResonantThumb identity={identity} className={className} />;
}
