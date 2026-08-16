import { cn } from '@/lib/utils';

// 音乐模块共享的面板 / 按钮 / 输入框样式工厂。
// 曾内联在 MusicPage.tsx,抽出后歌单子组件(PlaylistRail / PlaylistTrackTable / AddTracksPanel)
// 与主页面共用同一套视觉词汇。

export const panelClass = cn(
  'surface-leaf surface-admin-panel rounded-[var(--radius-lg)]',
  'p-3 sm:p-4'
);

export const shellClass = cn(
  'surface-leaf overflow-hidden rounded-[var(--radius-lg)]'
);

export function iconButtonClass(active = false, tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-transparent transition-[background-color,color,box-shadow,opacity] duration-[var(--dur-instant)] ease-[var(--ease-out)] active:opacity-60 min-[769px]:h-10 min-[769px]:w-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
    active && 'bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)]',
    tone === 'primary' &&
      'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)]',
    tone === 'danger' &&
      'text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)] focus-visible:text-[var(--signal-danger)]',
    tone === 'default' &&
      'bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

export function textButtonClass(tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-transparent px-3 text-sm font-semibold transition-[background-color,color,box-shadow,opacity] duration-[var(--dur-instant)] ease-[var(--ease-out)] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 min-[769px]:h-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
    tone === 'primary' &&
      'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    tone === 'danger' &&
      'bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_13%,transparent)]',
    tone === 'default' &&
      'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

// 实底主按钮 —— 每个视图最多一个,给「播放全部」这类唯一主行动。
// 白字精度:aurora-1 (#6366F1) 上白字对比度 4.6:1,亦有 SimulatedReadingModal 先例。
export function solidButtonClass() {
  return cn(
    'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-transparent px-4 text-sm font-semibold text-white transition-[background-color,box-shadow,opacity] duration-[var(--dur-instant)] ease-[var(--ease-out)] active:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 min-[769px]:h-10',
    'bg-[var(--aurora-1)] hover:shadow-[0_6px_20px_-6px_color-mix(in_oklch,var(--aurora-1)_60%,transparent)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]'
  );
}

// m:ss / h:mm:ss 时长格式(tabular-nums 场景下的曲目时长、歌单总时长)。
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function inputClass(extra?: string) {
  return cn(
    'h-10 w-full rounded-[var(--radius-sm)] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
    'placeholder:text-[var(--ink-muted)] transition-[border-color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out)] focus:border-[color-mix(in_oklch,var(--aurora-1)_48%,transparent)] focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    extra
  );
}
