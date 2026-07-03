/**
 * @文件StorageStatusIcon.tsx
 * @description 类 iCloud 风格的存储/备份状态图标 —— 把 storageType + syncStatus 合成单一视觉指示
 * @ref 对象存储 rollout - Phase 4 (UI 重构) + Phase 5 (备份校验 MISSING 态)
 *
 * 状态映射:
 *   cloud-native (S3/COS/...) + 任意 sync → 文件已在云端
 *     · NONE/默认  → 云 + 绿勾 (该文件本就在 default cloud,即"已备份")
 *     · SYNCING/PENDING/FAILED → 同步中/等待/失败 (镜像到第二个 provider 的状态)
 *   当地的：
 *     · NONE  → 仅本地 (云上传图标,提示"可备份")
 *     · PENDING → 等待备份 (云上传 + 琥珀色)
 *     · SYNCING → 同步中 (云 + 旋转 loader)
 *     · SYNCED → 已备份 (云 + 绿勾,iCloud 风格)
 *     · FAILED → 失败 (云 + 红色感叹号)
 *     · MISSING → 云端缺失 (云 + 断链/红色 X,需重新备份)
 */

import type { ReactNode } from 'react';
import { Cloud, CloudUpload, CloudOff, Loader2, Check, AlertCircle } from 'lucide-react';
import type { StorageType, SyncStatus } from '@/services/mediaService';
import { cn } from '@/lib/utils';

interface StorageStatusIconProps {
  storageType?: StorageType;
  syncStatus?: SyncStatus | null;
  size?: 'sm' | 'md' | 'lg';
  /** 图标右侧加显示文字标签（详情页用） */
  showLabel?: boolean;
  /** 'default' 跟随主题；'onMedia' 用于贴在缩略图上的玻璃徽章（强制白色描边） */
  tone?: 'default' | 'onMedia';
  className?: string;
}

type StateKind = 'cloud-synced' | 'syncing' | 'pending' | 'failed' | 'missing' | 'local-only';

interface ResolvedState {
  kind: StateKind;
  label: string;
  tooltip: string;
}

function resolve(storageType?: StorageType, syncStatus?: SyncStatus | null): ResolvedState {
  const inCloud = !!storageType && storageType !== 'LOCAL';

  if (inCloud) {
    switch (syncStatus) {
      case 'SYNCING':
        return { kind: 'syncing', label: '同步中', tooltip: `同步中（主文件在 ${storageType}）` };
      case 'PENDING':
        return { kind: 'pending', label: '待同步', tooltip: `镜像备份待执行（主文件在 ${storageType}）` };
      case 'FAILED':
        return { kind: 'failed', label: '失败', tooltip: `镜像备份失败（主文件在 ${storageType}）` };
      case 'MISSING':
        return { kind: 'missing', label: '云端缺失', tooltip: `云端备份已不存在,需重新备份（主文件在 ${storageType}）` };
      default:
        return { kind: 'cloud-synced', label: '已上云', tooltip: `已存于 ${storageType}` };
    }
  }

  switch (syncStatus) {
    case 'SYNCED':
      return { kind: 'cloud-synced', label: '已备份', tooltip: '已备份到云端' };
    case 'SYNCING':
      return { kind: 'syncing', label: '同步中', tooltip: '正在备份到云端' };
    case 'PENDING':
      return { kind: 'pending', label: '待备份', tooltip: '等待备份到云端' };
    case 'FAILED':
      return { kind: 'failed', label: '失败', tooltip: '备份失败,可在详情页重试' };
    case 'MISSING':
      return { kind: 'missing', label: '云端缺失', tooltip: '云端备份对象已丢失,需重新备份' };
    case 'NONE':
    default:
      return { kind: 'local-only', label: '仅本地', tooltip: '仅存于本地,尚未备份' };
  }
}

const SIZE_MAP = {
  sm: { icon: 'w-4 h-4', overlay: 'w-2.5 h-2.5', overlayPos: '-bottom-0.5 -right-0.5', label: 'text-[11px]' },
  md: { icon: 'w-5 h-5', overlay: 'w-3 h-3', overlayPos: '-bottom-0.5 -right-0.5', label: 'text-xs' },
  lg: { icon: 'w-6 h-6', overlay: 'w-3.5 h-3.5', overlayPos: '-bottom-1 -right-1', label: 'text-sm' },
} as const;

export function StorageStatusIcon({
  storageType,
  syncStatus,
  size = 'sm',
  showLabel = false,
  tone = 'default',
  className,
}: StorageStatusIconProps) {
  const state = resolve(storageType, syncStatus);
  const s = SIZE_MAP[size];
  const onMedia = tone === 'onMedia';

  const cloudColor = onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-[var(--text-secondary)]';
  const ringColor = onMedia ? 'ring-black/20' : 'ring-[var(--bg-card,white)]';
  const failedFill = onMedia ? 'fill-white' : 'fill-[var(--bg-card,white)]';
  const mutedColor = onMedia ? 'text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-[var(--text-muted)]';

  let glyph: ReactNode;
  switch (state.kind) {
    case 'cloud-synced':
      glyph = (
        <span className="relative inline-flex">
          <Cloud className={cn(s.icon, cloudColor)} />
          <span
            className={cn(
              'absolute flex items-center justify-center rounded-full bg-status-success ring-2 shadow-sm',
              ringColor,
              s.overlay,
              s.overlayPos
            )}
          >
            <Check className="w-full h-full p-0.5 text-white" strokeWidth={3.5} />
          </span>
        </span>
      );
      break;
    case 'syncing':
      glyph = (
        <span className="relative inline-flex">
          <Cloud className={cn(s.icon, onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-primary')} />
          <Loader2
            className={cn(
              'absolute animate-spin',
              onMedia ? 'text-white' : 'text-primary',
              s.overlay,
              s.overlayPos
            )}
            strokeWidth={3}
          />
        </span>
      );
      break;
    case 'pending':
      glyph = (
        <span className="relative inline-flex">
          <CloudUpload className={cn(s.icon, onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-status-warning')} />
          <span
            className={cn(
              'absolute rounded-full bg-status-warning ring-2',
              ringColor,
              s.overlay,
              s.overlayPos
            )}
          />
        </span>
      );
      break;
    case 'failed':
      glyph = (
        <span className="relative inline-flex">
          <Cloud className={cn(s.icon, onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-status-danger')} />
          <AlertCircle
            className={cn(
              'absolute text-status-danger',
              failedFill,
              s.overlay,
              s.overlayPos
            )}
            strokeWidth={2.5}
          />
        </span>
      );
      break;
    case 'missing':
      glyph = (
        <span className="relative inline-flex">
          <CloudOff className={cn(s.icon, onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' : 'text-status-danger')} />
          <span
            className={cn(
              'absolute flex items-center justify-center rounded-full bg-status-danger ring-2 shadow-sm',
              ringColor,
              s.overlay,
              s.overlayPos
            )}
          >
            <span className="text-white text-[8px] font-bold leading-none">!</span>
          </span>
        </span>
      );
      break;
    case 'local-only':
    default:
      glyph = (
        <CloudUpload className={cn(s.icon, mutedColor)} strokeWidth={1.75} />
      );
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={state.tooltip}
      aria-label={state.tooltip}
    >
      {glyph}
      {showLabel && (
        <span className={cn(s.label, 'text-[var(--text-secondary)]')}>{state.label}</span>
      )}
    </span>
  );
}

export default StorageStatusIcon;
