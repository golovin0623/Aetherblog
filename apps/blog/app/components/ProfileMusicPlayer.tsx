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
      className={cn(
        'group/music-entry relative w-full overflow-hidden rounded-2xl border text-left',
        'border-[var(--border-subtle)] bg-[linear-gradient(135deg,var(--bg-card),color-mix(in_oklch,var(--bg-secondary)_78%,#ff4d4f_8%))]',
        'shadow-[0_18px_46px_-38px_rgba(15,23,42,0.45)]',
        isHome ? 'mb-8 p-4 md:p-5' : 'mb-3 p-3',
        className
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#ff4d4f,transparent)] opacity-60" />
      <div className={cn('grid items-center gap-3', isHome ? 'grid-cols-[64px_minmax(0,1fr)_auto]' : 'grid-cols-[52px_minmax(0,1fr)_auto]')}>
        <button
          type="button"
          onClick={handleMainAction}
          className={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#191313] text-white shadow-md transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]',
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
            <Disc3 className={cn('absolute h-8 w-8 text-white/36', isCurrentTrack && isPlaying && 'animate-spin [animation-duration:3s]')} />
          )}
          <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#ff4d4f] shadow-lg">
            {isCurrentTrack && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </span>
        </button>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#ff4d4f]" />
            <span className="truncate">{playlistName}</span>
          </div>
          <p className={cn('mt-1 truncate font-black tracking-normal text-[var(--text-primary)]', isHome ? 'text-base md:text-lg' : 'text-sm')} title={displayTrack.title}>
            {displayTrack.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={displayTrack.artist || displayTrack.album || displayTrack.media.originalName}>
            {displayTrack.artist || '未知艺术家'} · {(currentTrack ? currentIndex : 0) + 1}/{tracks.length}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShuffle((value) => !value)}
            className={cn(
              'hidden h-10 w-10 items-center justify-center rounded-xl border transition-colors sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]',
              shuffle
                ? 'border-[#ff4d4f]/35 bg-[#ff4d4f]/10 text-[#ff4d4f]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
            aria-pressed={shuffle}
            aria-label="随机播放"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={previousTrack}
            className="hidden h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
            aria-label="上一首"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextTrack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
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
          className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
          aria-label="打开音乐大厅调整播放进度"
        >
          <span className="block h-full rounded-full bg-[#ff4d4f] transition-[width] duration-200" style={{ width: `${isCurrentTrack ? percent : 0}%` }} />
        </button>
        <div className="mt-1.5 flex items-center justify-between text-[10px] tnum text-[var(--text-muted)]">
          <span>{isCurrentTrack ? formatMusicClock(progress) : '0:00'}</span>
          <span>{formatMusicClock(activeDuration)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[#ff4d4f]/20 bg-[#ff4d4f]/8 px-3 text-xs font-bold text-[#d93d3f] transition-colors hover:bg-[#ff4d4f]/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
        >
          <Disc3 className={cn('h-3.5 w-3.5', isCurrentTrack && isPlaying && 'animate-spin [animation-duration:3s]')} />
          打开播放页
        </button>
        <Link
          href="/music"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
        >
          <ListMusic className="h-3.5 w-3.5" />
          音乐大厅
        </Link>
      </div>
    </div>
  );
}

export default ProfileMusicPlayer;
