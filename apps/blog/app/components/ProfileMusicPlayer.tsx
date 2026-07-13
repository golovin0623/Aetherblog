'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { AlertCircle, Disc3, ListMusic, Maximize2, Pause, Play, RefreshCw, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import {
  formatMusicClock,
  resolveMusicCoverSrc,
  SeekBar,
  useMusicPlayer,
  useMusicPlayerTimeline,
} from './MusicPlayerProvider';
import { resolveMusicTrackPresentation } from './musicPlayerState';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface ProfileMusicPlayerProps {
  surface?: 'profile' | 'home';
  className?: string;
  variant?: 'card' | 'stack';
  emptyState?: ReactNode;
  stackSwitchAction?: ReactNode;
  timelineActive?: boolean;
}

function ProfileMusicArtwork({
  cover,
  title,
  size,
}: {
  cover: string;
  title: string;
  size: 'compact' | 'featured';
}) {
  const sizeClass = size === 'featured' ? 'h-16 w-16' : 'h-[52px] w-[52px]';
  const imageSize = size === 'featured' ? '64px' : '52px';

  return (
    <div
      className={cn(
        'music-artwork relative shrink-0 overflow-hidden rounded-[var(--music-radius-artwork-sm)] bg-[var(--music-control-fill)] text-[var(--ink-muted)]',
        sizeClass,
      )}
    >
      {cover ? (
        <Image
          src={cover}
          alt={`${title} 封面`}
          fill
          sizes={imageSize}
          className="object-cover"
          unoptimized
        />
      ) : (
        <span className="grid h-full w-full place-items-center" role="img" aria-label="暂无歌曲封面">
          <Disc3 className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

interface ProfileMusicTimelineProps {
  fallbackDuration: number;
  isCurrentTrack: boolean;
  layout: 'card' | 'stack';
  onSeek: (percent: number) => void;
}

interface ProfileMusicTimelineViewProps extends ProfileMusicTimelineProps {
  duration: number;
  percent: number;
  progress: number;
}

function ProfileMusicTimelineView({
  duration,
  fallbackDuration,
  isCurrentTrack,
  layout,
  onSeek,
  percent,
  progress,
}: ProfileMusicTimelineViewProps) {
  const activeDuration = duration || fallbackDuration;
  const shownPercent = isCurrentTrack ? percent : 0;
  const shownProgress = isCurrentTrack ? progress : 0;
  const timeClassName = cn(
    'flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]',
    layout === 'card' && 'mt-1.5',
  );

  return (
    <div className={layout === 'stack' ? 'profile-music-stack-progress' : 'mt-3'}>
      <SeekBar
        percent={shownPercent}
        progress={shownProgress}
        duration={activeDuration}
        onSeek={onSeek}
        size="sm"
        label="调整个人卡片音乐进度"
      />
      <div className={timeClassName}>
        <span>{formatMusicClock(shownProgress)}</span>
        <span>{formatMusicClock(activeDuration)}</span>
      </div>
    </div>
  );
}

function LiveProfileMusicTimeline(props: ProfileMusicTimelineProps) {
  const { progress, duration, percent } = useMusicPlayerTimeline();

  return (
    <ProfileMusicTimelineView
      {...props}
      progress={progress}
      duration={duration}
      percent={percent}
    />
  );
}

function ProfileMusicTimelineSlot({
  live,
  ...props
}: ProfileMusicTimelineProps & { live: boolean }) {
  if (live) return <LiveProfileMusicTimeline {...props} />;

  return (
    <ProfileMusicTimelineView
      {...props}
      progress={0}
      duration={0}
      percent={0}
    />
  );
}

export function ProfileMusicPlayer({
  surface = 'profile',
  className,
  variant = 'card',
  emptyState,
  stackSwitchAction,
  timelineActive = true,
}: ProfileMusicPlayerProps) {
  const {
    player,
    isPlayerLoading,
    playerLoadError,
    retryPlayer,
    tracks,
    currentTrack,
    currentIndex,
    isPlaying,
    isBuffering,
    playbackError,
    shuffle,
    skin,
    canUseSurface,
    playIndex,
    togglePlayback,
    retryPlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
  } = useMusicPlayer();

  const isStack = variant === 'stack';
  const shellClass = isStack
    ? 'profile-music-stack-shell relative flex h-full min-h-[168px] w-full flex-col justify-center gap-3 overflow-hidden rounded-[var(--profile-card-stack-panel-radius)] border border-[var(--music-stroke)] bg-[color-mix(in_oklch,var(--bg-raised)_72%,transparent)] p-4 text-left shadow-[var(--music-shadow-float)]'
    : cn(
        'surface-leaf group/music-entry relative w-full overflow-hidden rounded-[var(--music-radius-panel)] text-left',
        surface === 'home' ? 'mb-8 p-4 md:p-5' : 'mb-3 p-3'
      );

  if (isPlayerLoading) {
    return (
      <div
        data-music-skin={skin}
        role="status"
        aria-live="polite"
        className={cn(shellClass, 'flex flex-col items-center justify-center text-center', className)}
      >
        {isStack && stackSwitchAction && (
          <div className="absolute right-2 top-2 z-[2]">{stackSwitchAction}</div>
        )}
        <RefreshCw className="h-6 w-6 animate-spin text-[var(--aurora-1)]" />
        <p className="mt-3 text-sm font-bold text-[var(--ink-primary)]">正在载入音乐</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">歌单准备好后会在这里出现。</p>
      </div>
    );
  }

  if (playerLoadError) {
    return (
      <div
        data-music-skin={skin}
        role="alert"
        className={cn(shellClass, 'flex flex-col items-center justify-center text-center', className)}
      >
        {isStack && stackSwitchAction && (
          <div className="absolute right-2 top-2 z-[2]">{stackSwitchAction}</div>
        )}
        <AlertCircle className="h-6 w-6 text-[var(--signal-danger)]" />
        <p className="mt-3 text-sm font-bold text-[var(--ink-primary)]">音乐暂时没有载入</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">检查网络后再试一次。</p>
        <button
          type="button"
          onClick={retryPlayer}
          className="music-control-button music-pill-button mt-3 inline-flex min-h-11 items-center justify-center gap-2 bg-[var(--music-control-fill)] px-4 text-xs text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
          重新载入
        </button>
      </div>
    );
  }

  if (!canUseSurface(surface)) {
    if (!emptyState) return null;
    return (
      <div data-music-skin={skin} className={cn(shellClass, className)}>
        {isStack && stackSwitchAction && (
          <div className="absolute right-2 top-2 z-[2]">{stackSwitchAction}</div>
        )}
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
  const presentation = resolveMusicTrackPresentation(displayTrack);
  const artistName = presentation.artist;
  const trackPosition = `${(currentTrack ? currentIndex : 0) + 1}/${tracks.length}`;
  const trackMeta = artistName ? `${artistName} · ${trackPosition}` : trackPosition;

  const handleMainAction = async () => {
    if (!isCurrentTrack) {
      playIndex(0);
      return;
    }
    if (playbackError) {
      await retryPlayback();
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

  const openPlayer = () => {
    // Surface navigation must never be a disguised playback command. The
    // dedicated play control remains the only action that starts audio.
    setExpanded(true);
  };

  if (isStack) {
    const stackPlaying = isCurrentTrack && isPlaying;
    const stackBuffering = isCurrentTrack && isBuffering;
    const stackFailed = isCurrentTrack && Boolean(playbackError);
    return (
      <div data-music-skin={skin} className={cn(shellClass, className)}>
        <div className="absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--aurora-1),transparent)] opacity-70" />
        <div className="profile-music-stack-header grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5">
          <ProfileMusicArtwork cover={cover} title={presentation.title} size="compact" />

          <div className="min-w-0">
            <Link
              href="/music"
              className="relative flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--aurora-1)] after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] focus-visible:rounded-[var(--music-radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              aria-label="浏览歌单"
            >
              <ListMusic className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{playlistName}</span>
            </Link>
            <p className="profile-music-stack-title mt-1 text-base font-black leading-tight tracking-normal text-[var(--ink-primary)]" title={presentation.title}>
              {presentation.title}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--ink-muted)]" title={artistName || displayTrack.album || displayTrack.media?.originalName || presentation.title}>
              {trackMeta}
            </p>
          </div>

          <div className="profile-music-stack-actions flex items-center gap-1">
            {stackSwitchAction}
            <button
              type="button"
              onClick={openPlayer}
              className="music-control-button music-icon-button music-icon-button--tinted profile-music-expand-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label="打开音乐播放器"
              title="打开音乐播放器"
            >
              <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {!playbackError && (
          <ProfileMusicTimelineSlot
            live={timelineActive}
            fallbackDuration={displayTrack.durationSeconds || 0}
            isCurrentTrack={isCurrentTrack}
            layout="stack"
            onSeek={handleSeek}
          />
        )}

        <PlaybackFailure message={playbackError} onRetry={retryPlayback} compact />

        <div className="profile-music-stack-footer flex items-center justify-center pt-1">
          <div className="profile-music-stack-transport grid min-w-0 grid-cols-[44px_52px_44px] items-center gap-2.5">
            <button type="button" onClick={previousTrack} className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
              <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleMainAction}
              className="music-control-button music-primary-play-button flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label={stackFailed ? '重新尝试播放' : stackBuffering ? '取消载入' : stackPlaying ? '暂停音乐' : '播放音乐'}
              data-playing={stackPlaying ? 'true' : 'false'}
            >
              {stackBuffering ? <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.9} /> : stackPlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
            </button>
            <button type="button" onClick={nextTrack} className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
              <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
            </button>
          </div>
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
        <ProfileMusicArtwork cover={cover} title={presentation.title} size={isHome ? 'featured' : 'compact'} />

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" />
            <span className="truncate">{playlistName}</span>
          </div>
          <p className={cn('mt-1 truncate font-black tracking-normal text-[var(--ink-primary)]', isHome ? 'text-base md:text-lg' : 'text-sm')} title={presentation.title}>
            {presentation.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]" title={artistName || displayTrack.album || displayTrack.media?.originalName || presentation.title}>
            {trackMeta}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShuffle((value) => !value)}
            className={cn(
              'music-control-button music-icon-button hidden h-11 w-11 items-center justify-center rounded-full sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
              shuffle
                ? 'bg-[var(--music-control-fill-hover)] text-[var(--aurora-1)]'
                : 'text-[var(--ink-muted)]'
            )}
            data-selected={shuffle ? 'true' : 'false'}
            aria-pressed={shuffle}
            aria-label="随机播放"
          >
            <Shuffle className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={previousTrack}
            className="music-control-button music-icon-button hidden h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
            aria-label="上一首"
          >
            <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleMainAction}
            className="music-control-button music-primary-play-button flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
            aria-label={isCurrentTrack && playbackError ? '重新尝试播放' : isCurrentTrack && isBuffering ? '取消载入' : isCurrentTrack && isPlaying ? '暂停音乐' : '播放音乐'}
            data-playing={isCurrentTrack && isPlaying ? 'true' : 'false'}
          >
            {isCurrentTrack && isBuffering ? <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.9} /> : isCurrentTrack && isPlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={nextTrack}
            className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
            aria-label="下一首"
          >
            <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <ProfileMusicTimelineSlot
        live={timelineActive}
        fallbackDuration={displayTrack.durationSeconds || 0}
        isCurrentTrack={isCurrentTrack}
        layout="card"
        onSeek={handleSeek}
      />

      <PlaybackFailure message={playbackError} onRetry={retryPlayback} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={openPlayer}
          className="music-control-button music-pill-button inline-flex min-h-11 items-center justify-center gap-1.5 bg-[var(--music-control-fill-hover)] px-3 text-xs text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.9} />
          展开播放器
        </button>
        <Link
          href="/music"
          className="music-control-button music-pill-button inline-flex min-h-11 items-center justify-center gap-1.5 bg-[var(--music-control-fill)] px-3 text-xs text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
        >
          <ListMusic className="h-4 w-4" strokeWidth={1.9} />
          浏览歌单
        </Link>
      </div>
    </div>
  );
}

function PlaybackFailure({
  message,
  onRetry,
  compact = false,
}: {
  message: string | null;
  onRetry: () => Promise<void>;
  compact?: boolean;
}) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-[var(--music-radius-detail)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-left text-xs text-[var(--ink-secondary)]',
        compact ? 'px-2.5 py-1.5' : 'mt-3 px-3 py-2'
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-[var(--signal-danger)]" />
      <span className="min-w-0 flex-1 line-clamp-2">{message}</span>
      <button
        type="button"
        onClick={() => void onRetry()}
        className="music-control-button music-pill-button inline-flex min-h-11 shrink-0 items-center justify-center bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-3 text-[var(--signal-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
        aria-label="重新尝试播放"
      >
        重试
      </button>
    </div>
  );
}

export default ProfileMusicPlayer;
