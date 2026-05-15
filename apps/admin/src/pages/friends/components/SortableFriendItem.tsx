import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Mail,
  Rss,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FriendLink } from '@/services/friendService';

// SECURITY (VULN-082)：友链 URL 来自管理员输入；此前的代码直接把 URL
// 塞进 <a href>，恶意或粗心的管理员可注入 ``javascript:`` 等载荷，并在
// 其他管理员悬停 / 点击时触发。仅放行 http(s) URL；其它一律降级为 '#'。
function safeExternalHref(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
    return parsed.toString();
  } catch {
    return '#';
  }
}

function normalizeThemeColor(color?: string): string {
  if (!color) return '#6366f1';
  const trimmed = color.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : '#6366f1';
}

function displayHost(url?: string): string {
  if (!url) return '未设置 URL';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface SortableFriendItemProps {
  friend: FriendLink;
  index: number;
  dragDisabled?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisible: () => void;
}

export function SortableFriendItem({
  friend,
  index,
  dragDisabled = false,
  onEdit,
  onDelete,
  onToggleVisible,
}: SortableFriendItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: friend.id, disabled: dragDisabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : 1,
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    '--friend-color': normalizeThemeColor(friend.themeColor),
  } as CSSProperties;

  const safeUrl = safeExternalHref(friend.url);
  const host = displayHost(friend.url);
  const isOffline = friend.isOnline === false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 transition-all duration-200',
        'hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]',
        isDragging && 'scale-[1.01] bg-[var(--bg-popover)] shadow-xl ring-2 ring-primary/40',
        !friend.visible && 'opacity-70'
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-[var(--friend-color)]" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <button
            type="button"
            {...(!dragDisabled ? attributes : {})}
            {...(!dragDisabled ? listeners : {})}
            disabled={dragDisabled}
            className={cn(
              'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors sm:mt-0',
              dragDisabled
                ? 'cursor-not-allowed opacity-45'
                : 'cursor-grab bg-[var(--bg-popover)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] active:cursor-grabbing'
            )}
            title={dragDisabled ? '当前筛选视图不可排序' : '拖拽排序'}
            aria-label={dragDisabled ? '当前筛选视图不可排序' : `拖拽排序 ${friend.name}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-popover)] shadow-sm">
            {friend.logo ? (
              <img
                src={friend.logo}
                alt={friend.name}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                {friend.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-popover)] bg-[var(--friend-color)]" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs text-[var(--text-muted)]">#{String(index + 1).padStart(2, '0')}</span>
              <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{friend.name}</h3>
              <StatusPill visible={friend.visible} offline={isOffline} />
            </div>

            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 max-w-full items-center gap-1 transition-colors hover:text-primary sm:max-w-[240px]"
              >
                <span className="truncate">{host}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              {friend.email && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="max-w-[180px] truncate">{friend.email}</span>
                </span>
              )}
              {friend.rssUrl && (
                <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                  <Rss className="h-3 w-3" />
                  RSS
                </span>
              )}
            </div>

            {friend.description && (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-secondary)]">
                {friend.description}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0 sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisible();
            }}
            className={cn(
              'flex h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors sm:h-9',
              friend.visible
                ? 'border-[var(--border-subtle)] bg-[var(--bg-popover)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                : 'border-status-warning-border bg-status-warning-light text-status-warning hover:bg-status-warning/15'
            )}
          >
            {friend.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {friend.visible ? '隐藏' : '显示'}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-status-info-border bg-status-info-light px-3 text-xs font-medium text-status-info transition-colors hover:bg-status-info/15 sm:h-9"
          >
            <Edit2 className="h-4 w-4" />
            编辑
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-status-danger-border bg-status-danger-light px-3 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/15 sm:h-9"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ visible, offline }: { visible: boolean; offline: boolean }) {
  if (offline) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-danger-border bg-status-danger-light px-2 py-0.5 text-[10px] font-medium text-status-danger">
        <WifiOff className="h-3 w-3" />
        离线
      </span>
    );
  }

  if (!visible) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-warning-border bg-status-warning-light px-2 py-0.5 text-[10px] font-medium text-status-warning">
        <EyeOff className="h-3 w-3" />
        已隐藏
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-success-border bg-status-success-light px-2 py-0.5 text-[10px] font-medium text-status-success">
      <Wifi className="h-3 w-3" />
      公开
    </span>
  );
}
