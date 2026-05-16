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

type FriendStatusVisual = {
  key: 'visible' | 'hidden' | 'offline';
  label: string;
  tone: string;
  icon: typeof Eye;
};

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

function getFriendStatusVisual(friend: FriendLink): FriendStatusVisual {
  if (!friend.visible) {
    return {
      key: 'hidden',
      label: '已隐藏',
      tone: 'var(--signal-warn, #f59e0b)',
      icon: EyeOff,
    };
  }

  if (friend.isOnline === false) {
    return {
      key: 'offline',
      label: '离线',
      tone: 'var(--signal-danger, #ef4444)',
      icon: WifiOff,
    };
  }

  return {
    key: 'visible',
    label: '公开',
    tone: 'var(--signal-success, #22c55e)',
    icon: Wifi,
  };
}

function friendToneStyle(tone: string, themeColor?: string): CSSProperties {
  return {
    '--friend-tone': tone,
    '--friend-color': normalizeThemeColor(themeColor),
  } as CSSProperties;
}

function friendPillStyle(tone: string): CSSProperties {
  return {
    color: tone,
    background: `color-mix(in oklch, ${tone} 12%, transparent)`,
    borderColor: `color-mix(in oklch, ${tone} 26%, transparent)`,
  };
}

function itemActionClass(tone: 'neutral' | 'info' | 'warning' | 'danger'): string {
  const toneClass = {
    neutral: 'hover:border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)]',
    info: 'hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]',
    warning: 'hover:border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] hover:text-[var(--signal-warn)]',
    danger: 'hover:border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)]',
  }[tone];

  return cn(
    'inline-flex h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent',
    'bg-transparent px-1.5 text-[11px] font-semibold text-[var(--ink-secondary)] transition-colors touch-manipulation',
    'hover:bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] sm:h-8 sm:gap-1.5 sm:border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] sm:bg-[var(--bg-leaf)] sm:px-3 sm:text-xs',
    toneClass
  );
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
    zIndex: isDragging ? 50 : 1,
    opacity: 1,
    position: 'relative',
    background: isDragging ? 'var(--bg-leaf)' : undefined,
    boxShadow: isDragging
      ? '0 24px 60px -34px rgba(0, 0, 0, 0.55), 0 0 0 1px color-mix(in oklch, var(--aurora-1) 32%, transparent)'
      : undefined,
    ...friendToneStyle(getFriendStatusVisual(friend).tone, friend.themeColor),
  } as CSSProperties;

  const safeUrl = safeExternalHref(friend.url);
  const host = displayHost(friend.url);
  const status = getFriendStatusVisual(friend);
  const StatusIcon = status.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-friend-row
      data-friend-status={status.key}
      className={cn(
        'group relative bg-transparent p-3 transition-colors hover:bg-[var(--bg-card-hover)] sm:p-5',
        isDragging && 'z-50 overflow-hidden rounded-xl !bg-[var(--bg-leaf)] ring-2 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)]'
      )}
    >
      <div className="grid grid-cols-[2.75rem_2.5rem_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 sm:grid-cols-[2.75rem_2.75rem_minmax(0,1fr)_auto] sm:gap-x-4">
        <button
          type="button"
          {...(!dragDisabled ? attributes : {})}
          {...(!dragDisabled ? listeners : {})}
          disabled={dragDisabled}
          className={cn(
            'col-start-1 row-start-1 mt-1.5 flex h-7 w-11 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-muted)] transition-colors touch-manipulation sm:mt-0.5 sm:h-11 sm:w-11 sm:rounded-xl',
            dragDisabled
              ? 'cursor-not-allowed opacity-45'
              : 'cursor-grab bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] hover:border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] hover:text-[var(--ink-primary)] active:cursor-grabbing sm:bg-[var(--bg-leaf)]'
          )}
          title={dragDisabled ? '当前筛选视图不可排序' : '拖拽排序'}
          aria-label={dragDisabled ? '当前筛选视图不可排序' : `拖拽排序 ${friend.name}`}
        >
          <GripVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </button>

        <div
          className={cn(
            'relative col-start-2 row-start-1 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border sm:h-11 sm:w-11 sm:rounded-2xl',
            'border-[color-mix(in_oklch,var(--friend-tone)_30%,transparent)] bg-[color-mix(in_oklch,var(--friend-tone)_12%,transparent)]',
            'text-[var(--friend-tone)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--friend-tone)_18%,transparent)]',
            'transition-transform duration-200 group-hover:scale-[1.03]'
          )}
          data-friend-icon
        >
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
            <span className="text-sm font-bold text-current">
              {friend.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="col-start-3 row-start-1 min-w-0 self-center sm:self-start">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="tnum font-mono text-xs text-[var(--ink-muted)]">
              #{String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="truncate text-base font-semibold text-[var(--ink-primary)]">{friend.name}</h3>
            <span
              className="h-5 w-5 shrink-0 rounded-md border border-[var(--border-subtle)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
              style={{ backgroundColor: 'var(--friend-color)' }}
              title={`主题色 ${normalizeThemeColor(friend.themeColor)}`}
              aria-label={`主题色 ${normalizeThemeColor(friend.themeColor)}`}
            />
            <span
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium"
              style={friendPillStyle(status.tone)}
            >
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-1 transition-colors hover:text-[var(--aurora-1)] sm:max-w-[320px]"
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
              <span className="inline-flex items-center gap-1 text-[var(--ink-secondary)]">
                <Rss className="h-3 w-3" />
                RSS
              </span>
            )}
          </div>
        </div>

        {friend.description && (
          <p className="col-span-3 row-start-2 line-clamp-3 text-sm leading-6 text-[var(--ink-secondary)] sm:col-span-2 sm:col-start-3 sm:line-clamp-2 sm:pr-4">
            {friend.description}
          </p>
        )}

        <div
          className={cn(
            'col-span-3 grid w-full shrink-0 grid-cols-3 gap-1.5 sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2',
            friend.description ? 'row-start-3' : 'row-start-2'
          )}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisible();
            }}
            className={itemActionClass(friend.visible ? 'warning' : 'info')}
          >
            {friend.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {friend.visible ? '隐藏' : '显示'}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className={itemActionClass('info')}
          >
            <Edit2 className="h-3.5 w-3.5" />
            编辑
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className={itemActionClass('danger')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
