/**
 * @file StorageBadge.tsx
 * @description 存储徽章 —— 显示文件存储后端类型 (LOCAL/S3/COS/OSS/MINIO/R2)
 * @ref 对象存储 rollout - Phase 3
 *
 * 配色按 provider 区分:
 *   LOCAL  → 灰
 *   S3     → 橙 (AWS)
 *   COS    → 蓝 (腾讯云)
 *   OSS    → 橙 (阿里云)
 *   MINIO  → 紫
 *   R2     → 蓝 (Cloudflare)
 */

import type { StorageType } from '@/services/mediaService';
import { cn } from '@/lib/utils';

interface StorageBadgeProps {
  type?: StorageType;
  size?: 'sm' | 'md';
  className?: string;
}

const STYLES: Record<StorageType, { label: string; tint: string }> = {
  LOCAL: { label: 'LOCAL', tint: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  S3: { label: 'S3', tint: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  COS: { label: 'COS', tint: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  OSS: { label: 'OSS', tint: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  MINIO: { label: 'MINIO', tint: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  R2: { label: 'R2', tint: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
};

export function StorageBadge({ type, size = 'sm', className }: StorageBadgeProps) {
  if (!type) return null;
  const style = STYLES[type] || STYLES.LOCAL;
  const sizing = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-mono font-semibold tracking-wider',
        sizing,
        style.tint,
        className
      )}
      title={`存储后端: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

export default StorageBadge;
