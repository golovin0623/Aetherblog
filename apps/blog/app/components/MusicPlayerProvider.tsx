'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Disc3,
  ListMusic,
  Maximize2,
  Music2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import { getMusicPlayer, type MusicPlayer, type MusicTrack } from '../lib/services';
import { sanitizeImageUrl, sanitizeUrl } from '../lib/sanitizeUrl';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export interface LyricLine {
  time: number | null;
  text: string;
}

export function resolveMusicAudioSrc(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media.publicUrl || track.media.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  const safe = sanitizeUrl(raw, '');
  return safe === '#' ? '' : safe;
}

export function resolveMusicCoverSrc(track: MusicTrack | undefined, fallback = ''): string {
  return sanitizeImageUrl(track?.coverUrl, fallback);
}

export function formatMusicClock(seconds: number): string {
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

export function parseMusicLyric(raw: string | undefined | null): LyricLine[] {
  if (!raw || !raw.trim()) return [];
  const lines: LyricLine[] = [];
  const timePattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(timePattern, '').trim();
    timePattern.lastIndex = 0;
    const matches = Array.from(line.matchAll(timePattern));
    if (matches.length === 0) {
      if (text) lines.push({ time: null, text });
      continue;
    }
    for (const match of matches) {
      const minutes = Number(match[1] || 0);
      const seconds = Number(match[2] || 0);
      const fractionRaw = match[3] || '0';
      const fraction = Number(fractionRaw.padEnd(3, '0').slice(0, 3)) / 1000;
      lines.push({ time: minutes * 60 + seconds + fraction, text: text || '...' });
    }
  }

  return lines.sort((a, b) => {
    if (a.time == null && b.time == null) return 0;
    if (a.time == null) return 1;
    if (b.time == null) return -1;
    return a.time - b.time;
  });
}

function activeLyricIndex(lines: LyricLine[], progress: number): number {
  if (lines.length === 0) return -1;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const time = lines[i].time;
    if (time == null) continue;
    if (time <= progress + 0.15) active = i;
    if (time != null && time > progress) break;
  }
  return active >= 0 ? active : lines.findIndex((line) => line.time == null);
}

interface MusicPlayerContextValue {
  player?: MusicPlayer;
  tracks: MusicTrack[];
  currentTrack?: MusicTrack;
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  progress: number;
  duration: number;
  percent: number;
  volume: number;
  expanded: boolean;
  lyrics: LyricLine[];
  activeLyricIndex: number;
  canRender: boolean;
  canUseSurface: (surface: 'home' | 'profile') => boolean;
  playIndex: (index: number, options?: { expand?: boolean }) => void;
  playTrack: (trackId: number, options?: { expand?: boolean }) => void;
  playAll: (options?: { expand?: boolean }) => void;
  togglePlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  seekToPercent: (percent: number) => void;
  setShuffle: (value: boolean | ((prev: boolean) => boolean)) => void;
  setExpanded: (value: boolean) => void;
  setVolume: (value: number) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export function useMusicPlayer() {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  }
  return context;
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const { data: player } = useQuery({
    queryKey: ['musicPlayer'],
    queryFn: getMusicPlayer,
    staleTime: 60 * 1000,
  });
  const tracks = useMemo(
    () => (player?.tracks ?? []).filter((track) => Boolean(resolveMusicAudioSrc(track))),
    [player?.tracks]
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.86);
  const [expanded, setExpanded] = useState(false);

  const currentTrack = tracks[currentIndex];
  const audioSrc = resolveMusicAudioSrc(currentTrack);
  const canRender = Boolean(player?.enabled && tracks.length > 0);
  const lyrics = useMemo(() => parseMusicLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const lyricIndex = useMemo(() => activeLyricIndex(lyrics, progress), [lyrics, progress]);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;

  const canUseSurface = useCallback(
    (surface: 'home' | 'profile') => {
      if (!canRender || !player) return false;
      const surfaceEnabled = surface === 'home' ? player.showOnHomePage : player.showOnProfileCard;
      const playlistVisible = surface === 'home'
        ? player.playlist?.displayOnHome !== false
        : player.playlist?.displayOnProfile !== false;
      return Boolean(surfaceEnabled && playlistVisible);
    },
    [canRender, player]
  );

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
    if (tracks.length === 0) {
      setIsPlaying(false);
      setProgress(0);
      setDuration(0);
    }
  }, [currentIndex, tracks.length]);

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

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  const advanceTrack = useCallback(
    (manual: boolean) => {
      if (tracks.length === 0) return;
      const shouldWrap = manual || player?.playbackMode === 'LOOP' || player?.playbackMode === 'CAROUSEL';
      if (!manual && !shuffle && currentIndex >= tracks.length - 1 && !shouldWrap) {
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
        shuffle ? pickRandomIndex(tracks.length, index) : (index + 1) % tracks.length
      );
      setIsPlaying(true);
    },
    [currentIndex, player?.playbackMode, shuffle, tracks.length]
  );

  const playIndex = useCallback(
    (index: number, options?: { expand?: boolean }) => {
      if (tracks.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
      setCurrentIndex(safeIndex);
      setIsPlaying(true);
      if (options?.expand) setExpanded(true);
      if (safeIndex === currentIndex) {
        audioRef.current?.play().catch(() => setIsPlaying(false));
      }
    },
    [currentIndex, tracks.length]
  );

  const playTrack = useCallback(
    (trackId: number, options?: { expand?: boolean }) => {
      const index = tracks.findIndex((track) => track.id === trackId);
      if (index >= 0) playIndex(index, options);
    },
    [playIndex, tracks]
  );

  const playAll = useCallback(
    (options?: { expand?: boolean }) => {
      playIndex(0, options);
    },
    [playIndex]
  );

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    try {
      if (!audio.src) audio.src = audioSrc;
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [audioSrc, isPlaying]);

  const previousTrack = useCallback(() => {
    if (tracks.length === 0) return;
    setCurrentIndex((index) => (index - 1 + tracks.length) % tracks.length);
    setIsPlaying(true);
  }, [tracks.length]);

  const nextTrack = useCallback(() => advanceTrack(true), [advanceTrack]);

  const seekToPercent = useCallback((nextPercent: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const nextTime = Math.min(duration, Math.max(0, (nextPercent / 100) * duration));
    audio.currentTime = nextTime;
    setProgress(nextTime);
  }, [duration]);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.min(1, Math.max(0, value)));
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !currentTrack) return;
    const cover = resolveMusicCoverSrc(currentTrack);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || '未知艺术家',
      album: currentTrack.album || player?.playlist?.name || '音乐大厅',
      artwork: cover
        ? [
            { src: cover, sizes: '512x512', type: 'image/png' },
          ]
        : [],
    });
    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler('previoustrack', previousTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  }, [currentTrack, nextTrack, player?.playlist?.name, previousTrack]);

  const value = useMemo<MusicPlayerContextValue>(() => ({
    player,
    tracks,
    currentTrack,
    currentIndex,
    isPlaying,
    shuffle,
    progress,
    duration,
    percent,
    volume,
    expanded,
    lyrics,
    activeLyricIndex: lyricIndex,
    canRender,
    canUseSurface,
    playIndex,
    playTrack,
    playAll,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
    setVolume,
  }), [
    canRender,
    canUseSurface,
    currentIndex,
    currentTrack,
    duration,
    expanded,
    isPlaying,
    lyricIndex,
    lyrics,
    nextTrack,
    percent,
    playAll,
    playIndex,
    playTrack,
    player,
    previousTrack,
    progress,
    seekToPercent,
    shuffle,
    togglePlayback,
    tracks,
    volume,
    setVolume,
  ]);

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || currentTrack?.durationSeconds || 0)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime || 0)}
        onEnded={() => advanceTrack(false)}
      />
      <PersistentMusicDock value={value} />
    </MusicPlayerContext.Provider>
  );
}

function CoverDisc({
  track,
  playing,
  size = 'md',
}: {
  track: MusicTrack | undefined;
  playing: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cover = resolveMusicCoverSrc(track);
  const sizeClass = size === 'lg' ? 'h-56 w-56 sm:h-72 sm:w-72' : size === 'sm' ? 'h-12 w-12' : 'h-16 w-16';
  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full border border-white/15 bg-[radial-gradient(circle_at_50%_50%,#111_0_18%,#2a2222_19%_28%,#121212_29%_100%)] shadow-[0_20px_60px_-34px_rgba(0,0,0,0.85)]',
        sizeClass,
        playing && 'music-vinyl-spin'
      )}
    >
      <div className="absolute inset-[12%] rounded-full border border-white/10 bg-black/35" />
      <div className="absolute inset-[25%] overflow-hidden rounded-full border border-white/20 bg-[var(--bg-card)]">
        {cover ? (
          <Image
            src={cover}
            alt={track?.title || '音乐封面'}
            fill
            sizes={size === 'lg' ? '18rem' : '4rem'}
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#f8f0e8,#1f1b1b)] text-white">
            <Disc3 className={cn(size === 'lg' ? 'h-14 w-14' : 'h-6 w-6')} />
          </div>
        )}
      </div>
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-[#f6efe6]" />
    </div>
  );
}

function PersistentMusicDock({ value }: { value: MusicPlayerContextValue }) {
  const pathname = usePathname();
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
    volume,
    expanded,
    lyrics,
    activeLyricIndex,
    canRender,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
    setVolume,
  } = value;

  if (!canRender || !currentTrack || pathname.startsWith('/agent/workspace')) return null;
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : '';
  const playlistName = player?.playlist?.name || '音乐大厅';

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto mx-auto w-full max-w-5xl overflow-hidden rounded-[1.35rem] border border-white/12 bg-[#161111]/90 text-white shadow-[0_24px_90px_-36px_rgba(0,0,0,0.92)] backdrop-blur-2xl">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-2.5 sm:gap-4 sm:p-3">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
              aria-label="打开音乐大厅播放器"
            >
              <CoverDisc track={currentTrack} playing={isPlaying} size="sm" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#ff4d4f] text-white shadow-lg">
                <Maximize2 className="h-3 w-3" />
              </span>
            </button>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-5 items-center rounded-full bg-white/8 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffb4a9]">
                  {playlistName}
                </span>
                <span className="truncate text-[11px] text-white/45">
                  {currentIndex + 1}/{tracks.length}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-bold text-white sm:text-base">{currentTrack.title}</p>
              <p className="mt-0.5 truncate text-xs text-white/55">
                {currentTrack.artist || '未知艺术家'}{activeLine ? ` · ${activeLine}` : ''}
              </p>
              <button
                type="button"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  seekToPercent(((event.clientX - rect.left) / rect.width) * 100);
                }}
                className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
                aria-label="调整播放进度"
              >
                <span className="block h-full rounded-full bg-[#ff4d4f]" style={{ width: `${percent}%` }} />
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setShuffle((value) => !value)}
                className={cn(
                  'hidden h-10 w-10 items-center justify-center rounded-full border transition-colors sm:flex',
                  shuffle ? 'border-[#ff4d4f]/60 bg-[#ff4d4f]/16 text-[#ffb4a9]' : 'border-white/10 text-white/55 hover:text-white'
                )}
                aria-label="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button type="button" onClick={previousTrack} className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/65 transition-colors hover:text-white sm:flex" aria-label="上一首">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ff4d4f] text-white shadow-[0_10px_30px_-12px_rgba(255,77,79,0.9)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb4a9]"
                aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
              </button>
              <button type="button" onClick={nextTrack} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/65 transition-colors hover:text-white" aria-label="下一首">
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[65] overflow-y-auto bg-[#120f0f]/96 px-4 py-[max(4.5rem,env(safe-area-inset-top))] text-white backdrop-blur-2xl">
          <div className="mx-auto grid min-h-[calc(100dvh-8rem)] w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(340px,0.72fr)]">
            <section className="flex min-h-[560px] flex-col justify-between rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,77,79,0.20),rgba(255,255,255,0.06)_38%,rgba(0,0,0,0.28))] p-5 shadow-[0_30px_120px_-54px_rgba(0,0,0,0.95)] sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#ffb4a9]">Aether Music Hall</p>
                  <h2 className="mt-2 text-2xl font-black tracking-normal sm:text-4xl">音乐大厅</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/music"
                    onClick={() => setExpanded(false)}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 text-sm font-bold text-white/85 transition-colors hover:bg-white/12"
                  >
                    <ListMusic className="h-4 w-4" />
                    歌单页
                  </Link>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/8 text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                    aria-label="收起播放器"
                  >
                    <ChevronDown className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="grid flex-1 place-items-center py-8">
                <CoverDisc track={currentTrack} playing={isPlaying} size="lg" />
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm font-bold text-white/45">{playlistName}</p>
                  <h3 className="mt-1 text-3xl font-black tracking-normal sm:text-5xl">{currentTrack.title}</h3>
                  <p className="mt-2 text-base text-white/62">{currentTrack.artist || '未知艺术家'} · {currentTrack.album || '未分专辑'}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekToPercent(((event.clientX - rect.left) / rect.width) * 100);
                  }}
                  className="block h-2.5 w-full overflow-hidden rounded-full bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4f]"
                  aria-label="调整播放进度"
                >
                  <span className="block h-full rounded-full bg-[#ff4d4f]" style={{ width: `${percent}%` }} />
                </button>
                <div className="flex items-center justify-between text-xs tabular-nums text-white/48">
                  <span>{formatMusicClock(progress)}</span>
                  <span>{formatMusicClock(duration || currentTrack.durationSeconds || 0)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button type="button" onClick={() => setShuffle((value) => !value)} className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors', shuffle ? 'border-[#ff4d4f]/60 bg-[#ff4d4f]/18 text-[#ffb4a9]' : 'border-white/10 bg-white/6 text-white/62 hover:text-white')} aria-label="随机播放" aria-pressed={shuffle}>
                    <Shuffle className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={previousTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 hover:text-white" aria-label="上一首">
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={togglePlayback} className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff4d4f] text-white shadow-[0_20px_44px_-20px_rgba(255,77,79,0.95)] transition-transform hover:scale-105" aria-label={isPlaying ? '暂停音乐' : '播放音乐'}>
                    {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
                  </button>
                  <button type="button" onClick={nextTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/70 hover:text-white" aria-label="下一首">
                    <SkipForward className="h-5 w-5" />
                  </button>
                  <label className="flex h-12 items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 text-white/64">
                    <Volume2 className="h-4 w-4" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="w-24 accent-[#ff4d4f]"
                      aria-label="音量"
                    />
                  </label>
                </div>
              </div>
            </section>

            <aside className="grid gap-4 lg:grid-rows-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <section className="min-h-[300px] rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffb4a9]">Lyrics</p>
                    <h3 className="mt-1 text-lg font-black">歌词现场</h3>
                  </div>
                  <Music2 className="h-5 w-5 text-white/40" />
                </div>
                <div className="mt-5 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {lyrics.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-black/16 p-4 text-sm leading-6 text-white/55">
                      当前歌曲还没有歌词。可以在后台音乐大厅的歌曲信息里维护歌词，前台会自动滚动高亮。
                    </p>
                  ) : lyrics.map((line, index) => (
                    <p
                      key={`${line.time ?? 'plain'}-${index}`}
                      className={cn(
                        'rounded-2xl px-4 py-2 text-sm leading-7 transition-all',
                        index === activeLyricIndex
                          ? 'bg-[#ff4d4f]/18 text-lg font-black text-white shadow-[inset_3px_0_0_#ff4d4f]'
                          : 'text-white/45'
                      )}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </section>

              <section className="min-h-[300px] rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffb4a9]">Queue</p>
                    <h3 className="mt-1 text-lg font-black">播放队列</h3>
                  </div>
                  <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/54">{tracks.length} 首</span>
                </div>
                <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {tracks.map((track, index) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => value.playIndex(index)}
                      className={cn(
                        'grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors',
                        currentTrack.id === track.id
                          ? 'border-[#ff4d4f]/36 bg-[#ff4d4f]/14'
                          : 'border-white/8 bg-black/12 hover:bg-white/8'
                      )}
                    >
                      <span className="text-xs tabular-nums text-white/40">{String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-white/86">{track.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-white/42">{track.artist || '未知艺术家'}</span>
                      </span>
                      {currentTrack.id === track.id && isPlaying ? (
                        <span className="flex h-7 items-end gap-0.5" aria-hidden="true">
                          <span className="music-eq-bar" />
                          <span className="music-eq-bar [animation-delay:140ms]" />
                          <span className="music-eq-bar [animation-delay:260ms]" />
                        </span>
                      ) : (
                        <Play className="h-4 w-4 text-white/38" />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 backdrop-blur-xl transition-colors hover:text-white"
            aria-label="关闭音乐大厅播放器"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
