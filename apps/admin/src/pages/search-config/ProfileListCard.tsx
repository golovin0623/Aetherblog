import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Archive,
  MoreVertical,
  Play,
  Trash2,
  EyeOff,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { SearchProfile } from '@/services/searchProfileService';
import { CHUNKER_KINDS } from './ChunkerKindSelector';

interface ProfileListCardProps {
  profile: SearchProfile;
  onActivate: (p: SearchProfile) => void;
  onDeprecate: (p: SearchProfile) => void;
  onDelete: (p: SearchProfile) => void;
  onSelect: (p: SearchProfile) => void;
}

const STATUS_CONFIG: Record<
  SearchProfile['status'],
  { label: string; icon: typeof CheckCircle2; toneClass: string }
> = {
  active: {
    label: 'ACTIVE',
    icon: CheckCircle2,
    toneClass:
      'text-[var(--signal-success)] bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] border-[color-mix(in_oklch,var(--signal-success)_25%,transparent)]',
  },
  shadow: {
    label: 'SHADOW',
    icon: Clock,
    toneClass:
      'text-[var(--signal-warn)] bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] border-[color-mix(in_oklch,var(--signal-warn)_25%,transparent)]',
  },
  deprecated: {
    label: 'DEPRECATED',
    icon: Archive,
    toneClass:
      'text-[var(--ink-muted)] bg-[color-mix(in_oklch,var(--ink-muted)_10%,transparent)] border-[color-mix(in_oklch,var(--ink-muted)_25%,transparent)]',
  },
};

export function ProfileListCard({
  profile,
  onActivate,
  onDeprecate,
  onDelete,
  onSelect,
}: ProfileListCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const status = STATUS_CONFIG[profile.status];
  const StatusIcon = status.icon;
  const chunker = CHUNKER_KINDS.find((k) => k.value === profile.chunkerKind);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // 操作约束：active profile 不能 deprecate / delete；deprecated 不能 activate
  const canActivate = profile.status === 'shadow';
  const canDeprecate = profile.status !== 'active' && profile.status !== 'deprecated';
  const canDelete = profile.status === 'deprecated';

  const isActive = profile.status === 'active';

  return (
    <motion.div
      layout
      data-interactive
      onClick={() => onSelect(profile)}
      className={cn(
        'surface-leaf surface-admin-item cursor-pointer relative overflow-hidden',
        'p-4 sm:p-5',
        'hover:translate-y-[-1px] transition-transform',
        // active 状态:左侧 aurora 高亮条 + 卡片底色微调,与列表中其他 profile 形成视觉对比
        isActive && 'ring-1 ring-[color-mix(in_oklch,var(--signal-success)_30%,transparent)]',
      )}
    >
      {/* active 专属左侧 aurora 条(与 sidebar 当前路由的视觉语言一致) */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[var(--signal-success)] via-[var(--aurora-1)] to-[var(--aurora-3)]"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md',
                'font-mono text-[0.65rem] tracking-[0.18em] border',
                status.toneClass
              )}
            >
              <StatusIcon className="w-3 h-3" />
              {status.label}
            </span>
            <h3
              className={cn(
                'text-base font-semibold truncate',
                isActive ? 'text-[var(--text-primary)] font-display' : 'text-[var(--text-primary)]',
              )}
            >
              {profile.name}
            </h3>
          </div>
          <p className="text-xs font-mono text-[var(--text-muted)] truncate">
            {profile.code}
          </p>
          {profile.description && (
            <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
              {profile.description}
            </p>
          )}
        </div>
        <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
            aria-label="操作菜单"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 z-30 min-w-[180px] surface-overlay !rounded-xl py-1 shadow-2xl">
              <MenuItem
                disabled={!canActivate}
                disabledHint={
                  profile.status === 'active' ? '已是 active' : '已 deprecate, 不可激活'
                }
                onClick={() => {
                  setMenuOpen(false);
                  onActivate(profile);
                }}
                icon={<Play className="w-3.5 h-3.5" />}
              >
                激活并切换流量
              </MenuItem>
              <MenuItem
                disabled={!canDeprecate}
                disabledHint={profile.status === 'active' ? '请先激活其他 profile' : '已 deprecated'}
                onClick={() => {
                  setMenuOpen(false);
                  onDeprecate(profile);
                }}
                icon={<EyeOff className="w-3.5 h-3.5" />}
              >
                标记为 deprecated
              </MenuItem>
              <MenuItem
                disabled={!canDelete}
                disabledHint={profile.status !== 'deprecated' ? '仅 deprecated 可删除' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(profile);
                }}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                danger
              >
                删除 profile
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Meta label="model" value={profile.modelId} mono />
        <Meta label="chunker" value={chunker?.label ?? profile.chunkerKind} />
        <Meta label="chunk_size" value={`${profile.chunkSizeTokens}t`} mono />
        <Meta label="overlap" value={`${profile.chunkOverlapTokens}t`} mono />
      </div>
    </motion.div>
  );
}

interface MetaProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Meta({ label, value, mono }: MetaProps) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={cn(
          'truncate text-[var(--text-secondary)]',
          mono && 'font-mono text-[0.7rem]'
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

interface MenuItemProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  icon: React.ReactNode;
  danger?: boolean;
}

function MenuItem({ children, onClick, disabled, disabledHint, icon, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
        disabled
          ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
          : danger
            ? 'text-red-300 hover:bg-red-500/10'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
      )}
    >
      <span className={cn('shrink-0', danger && !disabled ? 'text-red-400' : 'text-[var(--text-muted)]')}>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}
