'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Disc3, Pause, Play, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { getMusicPlayer, type MusicTrack } from '../lib/services';
import { sanitizeUrl } from '../lib/sanitizeUrl';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function resolveAudioSrc(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media.publicUrl || track.media.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  const safe = sanitizeUrl(raw, '');
  return safe === '#' ? '' : safe;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function pickRandomIndex(length: number, currentIndex: number): number {
  if (length <= 1) return 0;
  let next = currentIndex;
  while (next === currentIndex) {
    next = Math.floor(Math.random() * length);
  }
  return next;
}

interface ProfileMusicPlayerProps {
  surface?: 'profile' | 'home';
  className?: string;
}

export function ProfileMusicPlayer({ surface = 'profile', className }: ProfileMusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const { data: player } = useQuery({
    queryKey: ['musicPlayer'],
    queryFn: getMusicPlayer,
    staleTime: 60 * 1000,
  });
  const tracks = useMemo(
    () => (player?.tracks ?? []).filter((track) => Boolean(resolveAudioSrc(track))),
    [player?.tracks]
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const currentTrack = tracks[currentIndex];
  const audioSrc = resolveAudioSrc(currentTrack);
  const surfaceEnabled = surface === 'home' ? player?.showOnHomePage : player?.showOnProfileCard;
  const playlistVisible = surface === 'home'
    ? player?.playlist?.displayOnHome !== false
    : player?.playlist?.displayOnProfile !== false;
  const carouselActive = Boolean(
    player?.carouselEnabled || player?.playlist?.carouselEnabled || player?.playbackMode === 'CAROUSEL'
  );
  const carouselIntervalSeconds = Math.min(60, Math.max(3, player?.carouselIntervalSeconds ?? 8));
  const canRender = Boolean(
    player?.enabled &&
      tracks.length > 0 &&
      surfaceEnabled &&
      playlistVisible
  );
  const shuffleActive = shuffle;

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    setShuffle(Boolean(
      player?.randomEnabled ||
        player?.playlist?.randomEnabled ||
        player?.playbackMode === 'SHUFFLE'
    ));
  }, [player?.randomEnabled, player?.playlist?.randomEnabled, player?.playbackMode]);

  useEffect(() => {
    if (currentIndex >= tracks.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, tracks.length]);

  useEffect(() => {
    if (!canRender || !carouselActive || tracks.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setCurrentIndex((index) =>
        shuffleActive ? pickRandomIndex(tracks.length, index) : (index + 1) % tracks.length
      );
    }, carouselIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [canRender, carouselActive, carouselIntervalSeconds, shuffleActive, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    audio.src = audioSrc;
    audio.load();
    setProgress(0);
    setDuration(currentTrack?.durationSeconds ?? 0);
    if (playingRef.current) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [audioSrc, currentTrack?.durationSeconds]);

  const advanceTrack = useCallback(
    (manual: boolean) => {
      if (tracks.length === 0) return;
      const shouldWrap = manual || player?.playbackMode === 'LOOP' || player?.playbackMode === 'CAROUSEL';

      if (!manual && !shuffleActive && currentIndex >= tracks.length - 1 && !shouldWrap) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        setProgress(0);
        setIsPlaying(false);
        return;
      }

      setCurrentIndex((index) =>
        shuffleActive ? pickRandomIndex(tracks.length, index) : (index + 1) % tracks.length
      );
      setIsPlaying(true);
    },
    [currentIndex, player?.playbackMode, shuffleActive, tracks.length]
  );

  const previousTrack = () => {
    if (tracks.length === 0) return;
    setCurrentIndex((index) => (index - 1 + tracks.length) % tracks.length);
    setIsPlaying(true);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    try {
      if (!audio.src) {
        audio.src = audioSrc;
      }
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  if (!canRender || !currentTrack) return null;

  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const playlistName = player?.playlist?.name || '音乐';
  const isHome = surface === 'home';

  return (
    <div
      className={cn(
        'w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 text-left',
        isHome ? 'mb-8 p-4 shadow-[0_18px_46px_-38px_rgba(15,23,42,0.45)] backdrop-blur-sm' : 'mb-3 p-3',
        className
      )}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || currentTrack.durationSeconds || 0)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime || 0)}
        onEnded={() => advanceTrack(false)}
      />

      <div className={cn('flex items-center gap-3', isHome && 'md:gap-4')}>
        <button
          type="button"
          onClick={togglePlayback}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--color-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
          aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <Volume2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{playlistName}</span>
          </div>
          <p className={cn('mt-1 truncate font-bold text-[var(--text-primary)]', isHome ? 'text-base md:text-lg' : 'text-sm')} title={currentTrack.title}>
            {currentTrack.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]" title={currentTrack.artist || currentTrack.album || currentTrack.media.originalName}>
            {currentTrack.artist || '未知艺术家'} · {currentIndex + 1}/{tracks.length}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-card)]">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] tnum text-[var(--text-muted)]">
          <span>{formatClock(progress)}</span>
          <span>{formatClock(duration || currentTrack.durationSeconds || 0)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShuffle((value) => !value)}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]',
            shuffleActive
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
          aria-pressed={shuffleActive}
          aria-label="随机播放"
        >
          <Shuffle className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={previousTrack}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
            aria-label="上一首"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => advanceTrack(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
            aria-label="下一首"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)]">
          <Disc3 className={cn('h-4 w-4', isPlaying && 'animate-spin [animation-duration:3s]')} />
        </span>
      </div>
    </div>
  );
}

export default ProfileMusicPlayer;
