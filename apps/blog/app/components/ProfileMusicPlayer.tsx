'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Disc3, ListMusic, Pause, Play, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import {
  formatMusicClock,
  resolveMusicCoverSrc,
  useMusicPlayer,
} from './MusicPlayerProvider';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface ProfileMusicPlayerProps {
  surface?: 'profile' | 'home';
  className?: string;
}

export function ProfileMusicPlayer({ surface = 'profile', className }: ProfileMusicPlayerProps) {
  const {
    player,
    tracks,
    currentTrack,
    currentIndex,
    isPlaying,
    shuffle,
    progress,
    duration,
    percent,
    skin,
    canUseSurface,
    playIndex,
    togglePlayback,
    nextTrack,
    previousTrack,
    setShuffle,
    setExpanded,
  } = useMusicPlayer();

  if (!canUseSurface(surface)) return null;

  const displayTrack = currentTrack ?? tracks[0];
  if (!displayTrack) return null;

  const cover = resolveMusicCoverSrc(displayTrack);
  const isCurrentTrack = currentTrack?.id === displayTrack.id;
  const isHome = surface === 'home';
  const playlistName = player?.playlist?.name || '音乐大厅';
  const activeDuration = duration || displayTrack.durationSeconds || 0;

  const handleMainAction = async () => {
    if (!isCurrentTrack) {
      playIndex(0);
      return;
    }
    await togglePlayback();
  };

  return (
    <div
      data-music-skin={skin}
      className={cn(
        'surface-leaf group/music-entry relative w-full overflow-hidden text-left',
        isHome ? 'mb-8 p-4 md:p-5' : 'mb-3 p-3',
        className
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--aurora-1),transparent)] opacity-60" />
      <div className={cn('grid items-center gap-3', isHome ? 'grid-cols-[64px_minmax(0,1fr)_auto]' : 'grid-cols-[52px_minmax(0,1fr)_auto]')}>
        <button
          type="button"
          onClick={handleMainAction}
          className={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[radial-gradient(circle,color-mix(in_oklch,black_82%,var(--aurora-1))_0_42%,color-mix(in_oklch,black_90%,var(--aurora-1))_43%_100%)] text-[var(--bg-void)] shadow-md transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
            isHome ? 'h-16 w-16' : 'h-[3.25rem] w-[3.25rem]'
          )}
          aria-label={isCurrentTrack && isPlaying ? '暂停音乐' : '播放音乐'}
        >
          {cover ? (
            <Image
              src={cover}
              alt={displayTrack.title}
              fill
              sizes={isHome ? '4rem' : '3.25rem'}
              className={cn('object-cover opacity-72', isCurrentTrack && isPlaying && 'music-vinyl-spin')}
              unoptimized
            />
          ) : (
            <Disc3 className={cn('absolute h-8 w-8 text-[var(--ink-muted)]', isCurrentTrack && isPlaying && 'animate-spin [animation-duration:3s]')} />
          )}
          <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-lg">
            {isCurrentTrack && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </span>
        </button>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" />
            <span className="truncate">{playlistName}</span>
          </div>
          <p className={cn('mt-1 truncate font-black tracking-normal text-[var(--ink-primary)]', isHome ? 'text-base md:text-lg' : 'text-sm')} title={displayTrack.title}>
            {displayTrack.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]" title={displayTrack.artist || displayTrack.album || displayTrack.media?.originalName || displayTrack.title}>
            {displayTrack.artist || '未知艺术家'} · {(currentTrack ? currentIndex : 0) + 1}/{tracks.length}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShuffle((value) => !value)}
            className={cn(
              'hidden h-10 w-10 items-center justify-center rounded-xl border transition-colors sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
              shuffle
                ? 'border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]'
                : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            )}
            aria-pressed={shuffle}
            aria-label="随机播放"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={previousTrack}
            className="hidden h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)] sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            aria-label="上一首"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextTrack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            aria-label="下一首"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={(event) => {
            if (!isCurrentTrack) playIndex(0);
            setExpanded(true);
          }}
          className="block h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
          aria-label="打开音乐大厅调整播放进度"
        >
          <span className="block h-full rounded-full bg-[var(--aurora-1)] transition-[width] duration-200" style={{ width: `${isCurrentTrack ? percent : 0}%` }} />
        </button>
        <div className="mt-1.5 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
          <span>{isCurrentTrack ? formatMusicClock(progress) : '0:00'}</span>
          <span>{formatMusicClock(activeDuration)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-3 text-xs font-bold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          <Disc3 className={cn('h-3.5 w-3.5', isCurrentTrack && isPlaying && 'animate-spin [animation-duration:3s]')} />
          打开播放页
        </button>
        <Link
          href="/music"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 text-xs font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          <ListMusic className="h-3.5 w-3.5" />
          音乐大厅
        </Link>
      </div>
    </div>
  );
}

export default ProfileMusicPlayer;
