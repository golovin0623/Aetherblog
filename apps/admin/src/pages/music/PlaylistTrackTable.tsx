import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Reorder, motion, useDragControls, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListPlus,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { Skeleton, spring, transition, variants } from '@aetherblog/ui';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import { MusicCoverThumb } from './ResonantThumb';
import { formatClock, iconButtonClass } from './musicUi';

// Apple Music 式歌单曲目表:序号 hover 变播放、封面缩略、时长右对齐、拖拽调序。
// 排序契约不变 —— 提交时把完整顺序交给 reorderPlaylistMutation;
// 上移/下移(onMove)保留在移动端溢出菜单里,同时是键盘用户的降级路径。

const ROW_GRID = 'grid grid-cols-[2.25rem_2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-3 min-[769px]:grid-cols-[2.25rem_2.75rem_minmax(0,1fr)_4rem_auto]';

interface PlaylistTrackTableProps {
  tracks: MusicTrack[];
  loading: boolean;
  busy: boolean;
  nowPlayingTrackId?: number;
  isPlaying: boolean;
  onPlayAt: (index: number) => void;
  onTogglePlayback: () => void;
  /** 返回 false 表示本次提交被拒(忙碌/详情缺失),表格需把本地顺序回滚到服务端顺序 */
  onCommitOrder: (tracks: MusicTrack[]) => boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (trackId: number) => void;
}

export function PlaylistTrackTable({
  tracks,
  loading,
  busy,
  nowPlayingTrackId,
  isPlaying,
  onPlayAt,
  onTogglePlayback,
  onCommitOrder,
  onMove,
  onRemove,
}: PlaylistTrackTableProps) {
  const prefersReducedMotion = useReducedMotion();
  // 调序对屏幕阅读器此前完全静默(只有失败 toast),这里补一条礼貌播报
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [orderedTracks, setOrderedTracks] = useState(tracks);
  const [syncedTracks, setSyncedTracks] = useState(tracks);
  const orderedRef = useRef(tracks);
  const draggingRef = useRef(false);

  // 渲染期同步(React 官方的 props 变化调整 state 范式):放到 effect 里会先画出一帧
  // 旧数据 —— 首次载入时那一帧正好是「这个歌单还是空的」空态。
  if (tracks !== syncedTracks) {
    setSyncedTracks(tracks);
    // 拖拽进行中以本地顺序为准;结束后由乐观更新的 query 数据接管。
    if (!draggingRef.current) {
      setOrderedTracks(tracks);
      orderedRef.current = tracks;
    }
  }

  const handleReorder = useCallback((next: MusicTrack[]) => {
    // ref 与 state 一起写:渲染期写 ref 在并发渲染下可能留下从未提交的中间顺序
    orderedRef.current = next;
    setOrderedTracks(next);
  }, []);

  const handleDragStart = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const announceMove = useCallback((title: string, position: number, total: number) => {
    setReorderAnnouncement(`「${title}」已移动到第 ${position} 位,共 ${total} 首`);
  }, []);

  // 注意事件顺序:快速拖拽时 onReorder 可能先于 onDragStart 触发,
  // 所以不用「脏标记」判断是否提交 —— 结束时一律上交,父级用「顺序未变则不提交」守卫。
  // 提交被拒(忙碌/详情缺失)时必须回滚,否则本地顺序与父级 index 语义永久错位。
  const handleDragEnd = useCallback(() => {
    draggingRef.current = false;
    const accepted = onCommitOrder(orderedRef.current);
    if (!accepted) {
      orderedRef.current = tracks;
      setOrderedTracks(tracks);
    }
  }, [onCommitOrder, tracks]);

  if (loading) {
    return (
      <div role="status" aria-label="正在载入歌单曲目">
        <PlaylistTrackTableSkeleton />
      </div>
    );
  }

  if (orderedTracks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
        <span className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]">
          <ListPlus className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-[var(--ink-primary)]">这个歌单还是空的</p>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">用上方的「添加歌曲」从曲库挑几首,给它一个开场。</p>
      </div>
    );
  }

  return (
    <motion.div
      variants={variants.fadeUp}
      initial={prefersReducedMotion ? false : 'initial'}
      animate="animate"
      transition={transition.quick}
    >
      <div className={cn(ROW_GRID, 'border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]')} aria-hidden="true">
        <span className="text-center">#</span>
        <span />
        <span>歌曲</span>
        <span className="hidden text-right min-[769px]:block">时长</span>
        <span className="w-16 min-[769px]:w-24" />
      </div>
      <span className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>
      <Reorder.Group
        as="ol"
        axis="y"
        values={orderedTracks}
        onReorder={handleReorder}
        className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
      >
        {orderedTracks.map((track, index) => (
          <PlaylistTrackRow
            key={track.id}
            track={track}
            index={index}
            total={orderedTracks.length}
            busy={busy}
            nowPlaying={track.id === nowPlayingTrackId}
            isPlaying={isPlaying}
            onPlayAt={onPlayAt}
            onTogglePlayback={onTogglePlayback}
            onMove={(from, direction) => {
              onMove(from, direction);
              announceMove(track.title, from + direction + 1, orderedTracks.length);
            }}
            onRemove={onRemove}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        ))}
      </Reorder.Group>
    </motion.div>
  );
}

function PlaylistTrackRow({
  track,
  index,
  total,
  busy,
  nowPlaying,
  isPlaying,
  onPlayAt,
  onTogglePlayback,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  track: MusicTrack;
  index: number;
  total: number;
  busy: boolean;
  nowPlaying: boolean;
  isPlaying: boolean;
  onPlayAt: (index: number) => void;
  onTogglePlayback: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (trackId: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);

  return (
    <Reorder.Item
      as="li"
      value={track}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => {
        setDragging(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
      transition={spring.precise}
      className={cn(
        'group relative list-none transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
        dragging
          ? 'z-20 rounded-[var(--radius-md)] bg-[var(--bg-raised)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)]'
          : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]',
        nowPlaying && !dragging && 'bg-[color-mix(in_oklch,var(--aurora-1)_6%,transparent)]'
      )}
      data-testid="playlist-track-row"
    >
      <div
        className={cn(ROW_GRID, 'py-2')}
        onDoubleClick={() => (nowPlaying ? onTogglePlayback() : onPlayAt(index))}
      >
        {/* 序号 / 播放 —— hover 序号让位给播放按钮;正在播放的行常驻均衡器 */}
        <div className="relative flex h-10 items-center justify-center">
          {nowPlaying ? (
            <>
              <span
                className={cn(
                  'music-eq hidden transition-opacity duration-[var(--dur-instant)] ease-[var(--ease-out)] group-hover:opacity-0 group-focus-within:opacity-0 min-[769px]:inline-flex',
                  isPlaying && 'is-playing'
                )}
                aria-hidden="true"
              >
                <span /><span /><span />
              </span>
              <button
                type="button"
                onClick={onTogglePlayback}
                className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--aurora-1)] transition-opacity duration-[var(--dur-instant)] ease-[var(--ease-out)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] group-hover:opacity-100 group-focus-within:opacity-100 min-[769px]:opacity-0"
                aria-label={isPlaying ? `暂停「${track.title}」` : `继续播放「${track.title}」`}
              >
                {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
              </button>
            </>
          ) : (
            <>
              <span className="tnum hidden text-xs font-semibold text-[var(--ink-muted)] transition-opacity duration-[var(--dur-instant)] ease-[var(--ease-out)] group-hover:opacity-0 group-focus-within:opacity-0 min-[769px]:block">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => onPlayAt(index)}
                className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--aurora-1)] transition-opacity duration-[var(--dur-instant)] ease-[var(--ease-out)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] group-hover:opacity-100 group-focus-within:opacity-100 min-[769px]:opacity-0"
                aria-label={`从「${track.title}」开始播放`}
              >
                <Play className="h-4 w-4 fill-current" />
              </button>
            </>
          )}
        </div>

        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
          <MusicCoverThumb
            src={track.coverUrl || track.media?.thumbnailUrl}
            identity={`track:${track.id}:${track.title}`}
            alt=""
          />
        </span>

        <div className="min-w-0">
          <p className={cn('truncate text-sm font-semibold', nowPlaying ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>
            {track.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
            {track.artist || '未知艺术家'}
            {track.album ? ` · ${track.album}` : ''}
          </p>
        </div>

        <span className="tnum hidden text-right text-xs text-[var(--ink-muted)] min-[769px]:block">
          {track.durationSeconds ? formatClock(track.durationSeconds) : '—'}
        </span>

        <div className="flex items-center justify-end gap-0.5">
          <div className="hidden items-center gap-0.5 opacity-0 transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)] focus-within:opacity-100 group-hover:opacity-100 min-[769px]:flex">
            <button
              type="button"
              onClick={() => onRemove(track.id)}
              className={iconButtonClass(false, 'danger', 'sm')}
              disabled={busy}
              aria-label={`从歌单移除「${track.title}」`}
              title="从歌单移除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={(event) => {
                if (busy) return;
                event.preventDefault();
                dragControls.start(event);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                // 到边界也要吃掉按键,否则方向键会滚动页面
                event.preventDefault();
                if (busy) return;
                if (event.key === 'ArrowUp' && index > 0) onMove(index, -1);
                if (event.key === 'ArrowDown' && index < total - 1) onMove(index, 1);
              }}
              // 用 aria-disabled 而非 disabled:调序会让 mutation 立刻 pending,
              // 真 disabled 会在同一帧夺走焦点,键盘用户按一次就被踢回文档开头。
              aria-disabled={busy}
              className={cn(
                iconButtonClass(false, 'default', 'sm'),
                busy ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'
              )}
              aria-label={`调整「${track.title}」的位置:拖拽,或聚焦后按上下方向键`}
              title="拖拽排序(聚焦后可用 ↑↓ 键)"
              style={{ touchAction: 'none' }}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
          <PlaylistTrackActionMenu
            trackTitle={track.title}
            onPlay={() => onPlayAt(index)}
            moveUpDisabled={index === 0 || busy}
            moveDownDisabled={index === total - 1 || busy}
            removeDisabled={busy}
            onMoveUp={() => onMove(index, -1)}
            onMoveDown={() => onMove(index, 1)}
            onRemove={() => onRemove(track.id)}
          />
        </div>
      </div>
    </Reorder.Item>
  );
}

export function PlaylistTrackTableSkeleton() {
  return (
    <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className={cn(ROW_GRID, 'py-2')}>
          <Skeleton width={14} height={12} className="mx-auto" />
          <Skeleton variant="rectangular" width={44} height={44} />
          <div className="space-y-1.5">
            <Skeleton width="42%" height={13} />
            <Skeleton width="26%" height={11} />
          </div>
          <Skeleton width={30} height={11} className="hidden justify-self-end min-[769px]:block" />
          <span className="w-16 min-[769px]:w-24" />
        </div>
      ))}
    </div>
  );
}

// 移动端溢出菜单(<769px):播放 / 上移 / 下移 / 移除。
// 同时是键盘用户调序的降级路径 —— 拖拽手柄旁的 aria-label 会指过来。
function PlaylistTrackActionMenu({
  trackTitle,
  onPlay,
  moveUpDisabled,
  moveDownDisabled,
  removeDisabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  trackTitle: string;
  onPlay: () => void;
  moveUpDisabled: boolean;
  moveDownDisabled: boolean;
  removeDisabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      right: Math.max(12, window.innerWidth - rect.right),
      top: Math.max(12, Math.min(window.innerHeight - 228, rect.bottom + 6)),
      zIndex: 90,
    });
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        closeMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
      );
      if (items.length === 0) return;
      event.preventDefault();
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'Home') {
        items[0]?.focus();
      } else if (event.key === 'End') {
        items.at(-1)?.focus();
      } else if (event.key === 'ArrowDown') {
        items[(activeIndex + 1 + items.length) % items.length]?.focus();
      } else {
        items[(activeIndex - 1 + items.length) % items.length]?.focus();
      }
    };
    const onViewportChange = () => closeMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [closeMenu, open]);

  const runAction = (action: () => void) => {
    action();
    closeMenu(true);
  };

  const itemClass = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] disabled:opacity-40';

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={iconButtonClass()}
        aria-label={`更多「${trackTitle}」操作`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && createPortal(
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label={`「${trackTitle}」播放、排序与移除`}
          style={menuStyle}
          className="surface-overlay w-44 overflow-hidden rounded-xl p-1 shadow-xl"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={spring.precise}
        >
          <button type="button" role="menuitem" onClick={() => runAction(onPlay)} className={itemClass}>
            <Play className="h-4 w-4" />
            播放
          </button>
          <button type="button" role="menuitem" onClick={() => runAction(onMoveUp)} disabled={moveUpDisabled} className={itemClass}>
            <ArrowUp className="h-4 w-4" />
            上移
          </button>
          <button type="button" role="menuitem" onClick={() => runAction(onMoveDown)} disabled={moveDownDisabled} className={itemClass}>
            <ArrowDown className="h-4 w-4" />
            下移
          </button>
          <button type="button" role="menuitem" onClick={() => runAction(onRemove)} disabled={removeDisabled} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--signal-danger)] disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
            从歌单移除
          </button>
        </motion.div>,
        document.body
      )}
    </div>
  );
}
