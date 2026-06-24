'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Disc3, ListMusic, Pause, Play, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import {
  formatMusicClock,
  LiquidMusicOrb,
  resolveMusicCoverSrc,
  SeekBar,
  useMusicPlayer,
} from './MusicPlayerProvider';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface ProfileMusicPlayerProps {
  surface?: 'profile' | 'home';
  className?: string;
  variant?: 'card' | 'stack';
  emptyState?: ReactNode;
}

export function ProfileMusicPlayer({ surface = 'profile', className, variant = 'card', emptyState }: ProfileMusicPlayerProps) {
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
    seekToPercent,
    setShuffle,
    setExpanded,
  } = useMusicPlayer();

  const isStack = variant === 'stack';
  const shellClass = isStack
    ? 'relative flex h-full min-h-[168px] w-full flex-col overflow-hidden rounded-[1.35rem] border border-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_72%,transparent)] p-3 text-left shadow-[0_18px_48px_-38px_color-mix(in_oklch,var(--aurora-1)_75%,transparent)]'
    : cn(
        'surface-leaf group/music-entry relative w-full overflow-hidden text-left',
        surface === 'home' ? 'mb-8 p-4 md:p-5' : 'mb-3 p-3'
      );

  if (!canUseSurface(surface)) {
    if (!emptyState) return null;
    return (
      <div data-music-skin={skin} className={cn(shellClass, className)}>
        {emptyState}
      </div>
    );
  }

  const displayTrack = currentTrack ?? tracks[0];
  if (!displayTrack) return null;

  const cover = resolveMusicCoverSrc(displayTrack);
  const isCurrentTrack = currentTrack?.id === displayTrack.id;
  const isHome = surface === 'home';
  const playlistName = player?.playlist?.name || '音乐大厅';
  const activeDuration = duration || displayTrack.durationSeconds || 0;
  const shownPercent = isCurrentTrack ? percent : 0;
  const shownProgress = isCurrentTrack ? progress : 0;

  const handleMainAction = async () => {
    if (!isCurrentTrack) {
      playIndex(0);
      return;
    }
    await togglePlayback();
  };

  const handleSeek = (nextPercent: number) => {
    if (!isCurrentTrack) {
      playIndex(0);
      return;
    }
    seekToPercent(nextPercent);
  };

  if (isStack) {
    const stackPlaying = isCurrentTrack && isPlaying;
    return (
      <div data-music-skin={skin} className={cn(shellClass, className)}>
        <div className="absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--aurora-1),transparent)] opacity-70" />
        <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3">
          <div
            className="profile-music-cover-orb relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[radial-gradient(circle,color-mix(in_oklch,black_82%,var(--aurora-1))_0_42%,color-mix(in_oklch,black_90%,var(--aurora-1))_43%_100%)] text-[var(--bg-void)] shadow-md"
            aria-hidden="true"
            data-playing={stackPlaying ? 'true' : 'false'}
          >
            {cover ? (
              <Image
                src={cover}
                alt={displayTrack.title}
                fill
                sizes="3.25rem"
                className={cn('object-cover opacity-76', stackPlaying && 'music-vinyl-spin')}
                unoptimized
              />
            ) : (
              <Disc3 className={cn('absolute h-8 w-8 text-[var(--ink-muted)]', stackPlaying && 'animate-spin [animation-duration:3s]')} />
            )}
            <span className="profile-music-cover-core" />
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--aurora-1)]">
              <Volume2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{playlistName}</span>
            </div>
            <p className="mt-1 truncate text-base font-black tracking-normal text-[var(--ink-primary)]" title={displayTrack.title}>
              {displayTrack.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]" title={displayTrack.artist || displayTrack.album || displayTrack.media?.originalName || displayTrack.title}>
              {displayTrack.artist || '未知艺术家'} · {(currentTrack ? currentIndex : 0) + 1}/{tracks.length}
            </p>
          </div>
        </div>

        <div
          className="profile-music-flow-panel relative mt-4 h-16 overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]"
          data-playing={stackPlaying ? 'true' : 'false'}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,color-mix(in_oklch,var(--aurora-1)_28%,transparent),transparent_42%),linear-gradient(90deg,color-mix(in_oklch,var(--aurora-1)_9%,transparent),transparent_62%)]" />
          <div className="absolute left-4 right-20 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--aurora-1)_0%,transparent),color-mix(in_oklch,var(--aurora-1)_70%,transparent),color-mix(in_oklch,var(--aurora-3)_0%,transparent))]" />
          <div className="absolute left-5 right-24 top-1/2 flex -translate-y-1/2 items-center justify-between opacity-75" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--aurora-1)] shadow-[0_0_14px_color-mix(in_oklch,var(--aurora-1)_80%,transparent)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[color-mix(in_oklch,var(--aurora-2)_72%,transparent)] shadow-[0_0_16px_color-mix(in_oklch,var(--aurora-2)_70%,transparent)]" />
            <span className="h-1 w-1 rounded-full bg-[color-mix(in_oklch,var(--aurora-3)_76%,transparent)]" />
            <span className="h-2 w-2 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_72%,transparent)]" />
          </div>
          <LiquidMusicOrb playing={stackPlaying} size="md" className="absolute right-4 top-1/2 -translate-y-1/2" />
        </div>

        <div className="mt-3">
          <SeekBar
            percent={shownPercent}
            progress={shownProgress}
            duration={activeDuration}
            onSeek={handleSeek}
            size="sm"
            label="调整个人卡片音乐进度"
          />
          <div className="flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
            <span>{formatMusicClock(shownProgress)}</span>
            <span>{formatMusicClock(activeDuration)}</span>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShuffle((value) => !value)}
              className={cn(
                'music-control-button flex h-9 w-9 items-center justify-center rounded-full border',
                shuffle
                  ? 'border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]'
                  : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)]'
              )}
              aria-pressed={shuffle}
              aria-label="随机播放"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button type="button" onClick={previousTrack} className="music-control-button flex h-9 w-9 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)]" aria-label="上一首">
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleMainAction}
              className="music-control-button music-primary-play-button flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              aria-label={stackPlaying ? '暂停音乐' : '播放音乐'}
              data-playing={stackPlaying ? 'true' : 'false'}
            >
              {stackPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
            </button>
            <button type="button" onClick={nextTrack} className="music-control-button flex h-9 w-9 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)]" aria-label="下一首">
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="music-control-button inline-flex h-9 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-3 text-xs font-bold text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
          >
            <Disc3 className="h-3.5 w-3.5" />
            播放器
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-music-skin={skin}
      className={cn(shellClass, className)}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--aurora-1),transparent)] opacity-60" />
      <div className={cn('grid items-center gap-3', isHome ? 'grid-cols-[64px_minmax(0,1fr)_auto]' : 'grid-cols-[52px_minmax(0,1fr)_auto]')}>
        <button
          type="button"
          onClick={handleMainAction}
          className={cn(
            'music-control-button relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[radial-gradient(circle,color-mix(in_oklch,black_82%,var(--aurora-1))_0_42%,color-mix(in_oklch,black_90%,var(--aurora-1))_43%_100%)] text-[var(--bg-void)] shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
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
              'music-control-button hidden h-10 w-10 items-center justify-center rounded-xl border sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
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
            className="music-control-button hidden h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            aria-label="上一首"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextTrack}
            className="music-control-button flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            aria-label="下一首"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <SeekBar
          percent={shownPercent}
          progress={shownProgress}
          duration={activeDuration}
          onSeek={handleSeek}
          size="sm"
          label="调整个人卡片音乐进度"
        />
        <div className="mt-1.5 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
          <span>{formatMusicClock(shownProgress)}</span>
          <span>{formatMusicClock(activeDuration)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="music-control-button inline-flex h-9 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-3 text-xs font-bold text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          <Disc3 className={cn('h-3.5 w-3.5', isCurrentTrack && isPlaying && 'animate-spin [animation-duration:3s]')} />
          打开播放页
        </button>
        <Link
          href="/music"
          className="music-control-button inline-flex h-9 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 text-xs font-bold text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          <ListMusic className="h-3.5 w-3.5" />
          音乐大厅
        </Link>
      </div>
    </div>
  );
}

export default ProfileMusicPlayer;
