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
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useIsMobile } from '@aetherblog/hooks';
import { useReducedMotion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  AlertCircle,
  Disc3,
  ListMusic,
  Music2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Shuffle,
  Volume2,
  X,
} from 'lucide-react';
import { getMusicPlayer, type MusicPlayer, type MusicTrack } from '../lib/services';
import { sanitizeImageUrl, sanitizeUrl } from '../lib/sanitizeUrl';
import {
  DEFAULT_MUSIC_SKIN_PRESET,
  isMusicSkinPresetId,
  type MusicHallSkinMode,
} from '@aetherblog/utils';
import {
  createShuffleHistory,
  parseStoredMusicPlayback,
  recordShuffleSelection,
  resolveAdjacentTrack,
  resolveMusicTrackPresentation,
  resolveMusicStartIndex,
  resolveRestoredMusicPosition,
  resolveShuffleNavigation,
  shouldRotateMusicPresentation,
} from './musicPlayerState';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function meaningfulMusicText(value: string | null | undefined): string {
  const next = value?.trim() || '';
  return next && next !== '未知艺术家' ? next : '';
}

// ============================================================
// 音乐皮肤解析 —— 后台默认 + 前台访客本地覆盖(localStorage)
// 预设走纯 CSS([data-music-skin="<id>"]);自定义注入作用域 <style>。
// ============================================================
const MUSIC_SKIN_STORAGE_KEY = 'aetherblog-music-skin';
const MUSIC_PLAYBACK_STORAGE_KEY = 'aetherblog-music-playback-v1';

type StoredMusicSkin =
  | { mode: 'preset'; preset: string }
  | { mode: 'custom'; light: string; dark: string };

interface ResolvedMusicSkin {
  /** data-music-skin 属性值('custom' 或合法预设 id) */
  value: string;
  mode: MusicHallSkinMode;
  preset: string;
  /** 自定义亮主题种子(mode=custom 时有效) */
  light: string;
  /** 自定义暗主题种子(mode=custom 时有效) */
  dark: string;
}

/**
 * 只放行 hex 或「纯字面量」oklch() —— 杜绝 CSS 注入。
 * 负字符类额外禁掉内层括号,从而拦下 `oklch(var(--x))` / 任何嵌套函数,
 * 避免作用域种子被用来引用域外变量或夹带表达式。
 */
export function sanitizeMusicSeed(raw: string | undefined | null): string {
  const v = (raw || '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return v;
  if (/^oklch\([^;{}<>()]*\)$/i.test(v)) return v;
  return '';
}

function normalizeMusicSkin(
  mode: string | undefined | null,
  preset: string | undefined | null,
  light: string | undefined | null,
  dark: string | undefined | null,
): ResolvedMusicSkin {
  if (mode === 'custom') {
    const l = sanitizeMusicSeed(light);
    const d = sanitizeMusicSeed(dark) || l;
    if (l) return { value: 'custom', mode: 'custom', preset: DEFAULT_MUSIC_SKIN_PRESET, light: l, dark: d };
  }
  const p = isMusicSkinPresetId(preset) ? preset : DEFAULT_MUSIC_SKIN_PRESET;
  return { value: p, mode: 'preset', preset: p, light: '', dark: '' };
}

function readStoredMusicSkin(): StoredMusicSkin | null {
  try {
    const raw = localStorage.getItem(MUSIC_SKIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.mode === 'preset' && typeof parsed.preset === 'string') {
      return { mode: 'preset', preset: parsed.preset };
    }
    if (parsed?.mode === 'custom' && typeof parsed.light === 'string') {
      return { mode: 'custom', light: parsed.light, dark: typeof parsed.dark === 'string' ? parsed.dark : parsed.light };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredMusicSkin(value: StoredMusicSkin) {
  try {
    localStorage.setItem(MUSIC_SKIN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function clearStoredMusicSkin() {
  try {
    localStorage.removeItem(MUSIC_SKIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface LyricLine {
  time: number | null;
  text: string;
}

export function resolveMusicAudioSrc(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media?.publicUrl || track.media?.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  const safe = sanitizeUrl(raw, '');
  return safe === '#' ? '' : safe;
}

export function resolveMusicCoverSrc(track: MusicTrack | undefined, fallback = ''): string {
  return sanitizeImageUrl(track?.coverUrl || track?.media?.thumbnailUrl, fallback);
}

export function formatMusicClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * 共享进度条 —— 指针点击 + 键盘(←/→ ±5%、Home/End)均可拖动,
 * 带 role="slider" 与 aria-value*。三处播放面(大厅 / dock / 沉浸层)统一复用,
 * 杜绝各自手写一遍 onClick 取 clientX 又漏键盘可达性。
 */
export function SeekBar({
  percent,
  progress,
  duration,
  onSeek,
  size = 'md',
  className,
  label = '调整播放进度',
}: {
  percent: number;
  progress: number;
  duration: number;
  onSeek: (percent: number) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const heightClass = size === 'lg' ? 'h-1.5' : size === 'sm' ? 'h-[3px]' : 'h-1';
  const knobClass = size === 'lg' ? 'h-4 w-4' : size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek(((clientX - rect.left) / rect.width) * 100);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    seekFromClientX(event.clientX);
  };
  const finishPointerScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    seekFromClientX(event.clientX);
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedPercent)}
      aria-valuetext={`${formatMusicClock(progress)} / ${formatMusicClock(duration)}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerScrub}
      onPointerCancel={finishPointerScrub}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onSeek(Math.min(100, percent + 5));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          onSeek(Math.max(0, percent - 5));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onSeek(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onSeek(100);
        }
      }}
      className={cn(
        'group/music-seek flex min-h-11 w-full touch-none cursor-pointer items-center py-3 focus-visible:outline-none',
        className
      )}
      style={{ ['--music-progress' as string]: `${clampedPercent}%` }}
    >
      <span
        className={cn(
          'relative block w-full overflow-visible rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)]',
          heightClass
        )}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--aurora-1)]"
          style={{ width: `${clampedPercent}%` }}
        />
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink-primary)] opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/music-seek:opacity-100 group-focus-visible/music-seek:opacity-100 group-focus-visible/music-seek:ring-2 group-focus-visible/music-seek:ring-[var(--aurora-1)] group-active/music-seek:opacity-100',
            knobClass
          )}
          style={{ left: 'var(--music-progress)' }}
        />
      </span>
    </div>
  );
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
  isPlayerLoading: boolean;
  playerLoadError: boolean;
  retryPlayer: () => void;
  tracks: MusicTrack[];
  currentTrack?: MusicTrack;
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  playbackError: string | null;
  shuffle: boolean;
  progress: number;
  duration: number;
  percent: number;
  volume: number;
  expanded: boolean;
  hasPlaybackSession: boolean;
  lyrics: LyricLine[];
  activeLyricIndex: number;
  canRender: boolean;
  canUseSurface: (surface: 'home' | 'profile') => boolean;
  playIndex: (index: number, options?: { expand?: boolean }) => void;
  playTrack: (trackId: number, options?: { expand?: boolean }) => void;
  playAll: (options?: { expand?: boolean }) => void;
  playShuffled: (options?: { expand?: boolean }) => void;
  togglePlayback: () => Promise<void>;
  retryPlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  seekToPercent: (percent: number) => void;
  dismissPlayer: () => void;
  setShuffle: (value: boolean | ((prev: boolean) => boolean)) => void;
  setExpanded: (value: boolean) => void;
  setVolume: (value: number) => void;
  /** 当前生效的皮肤值,用于 data-music-skin */
  skin: string;
  skinMode: MusicHallSkinMode;
  skinCustomLight: string;
  skinCustomDark: string;
  /** 访客是否在本地覆盖了后台默认皮肤 */
  hasSkinOverride: boolean;
  selectPresetSkin: (id: string) => void;
  selectCustomSkin: (light: string, dark: string) => void;
  resetSkin: () => void;
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
  const playIntentRef = useRef(false);
  const sourceTransitionRef = useRef(false);
  const sourceRequestRef = useRef(0);
  const activeAudioSrcRef = useRef('');
  const playbackIndexRef = useRef(0);
  const presentationIndexRef = useRef(0);
  const progressRef = useRef(0);
  const volumeRef = useRef(0.86);
  const shuffleHistoryRef = useRef(createShuffleHistory(0));
  const storedPlaybackRef = useRef<ReturnType<typeof parseStoredMusicPlayback>>(null);
  const pendingRestoreRef = useRef<{ trackId: number; position: number } | null>(null);
  const didRestorePlaybackRef = useRef(false);
  const lastPersistAtRef = useRef(0);
  const {
    data: player,
    isPending: isPlayerLoading,
    isError: playerLoadError,
    refetch: refetchPlayer,
  } = useQuery({
    queryKey: ['musicPlayer'],
    queryFn: getMusicPlayer,
    staleTime: 60 * 1000,
  });
  const tracks = useMemo(
    () => (player?.tracks ?? []).filter((track) => Boolean(resolveMusicAudioSrc(track))),
    [player?.tracks]
  );
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [shuffle, setShuffleState] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.86);
  const [expanded, setExpanded] = useState(false);
  const [hasPlaybackSession, setHasPlaybackSession] = useState(false);
  const [playbackPreferencesHydrated, setPlaybackPreferencesHydrated] = useState(false);

  const currentIndex = hasPlaybackSession ? playbackIndex : presentationIndex;
  const currentTrack = tracks[currentIndex];
  const playbackTrack = tracks[playbackIndex];
  const displayTrackDuration = currentTrack?.durationSeconds ?? 0;
  const playbackTrackDuration = playbackTrack?.durationSeconds ?? 0;
  const audioSrc = resolveMusicAudioSrc(playbackTrack);
  const canRender = Boolean(player?.enabled && tracks.length > 0);
  const carouselEnabled = Boolean(
    player?.carouselEnabled ||
      player?.playlist?.carouselEnabled ||
      player?.playbackMode === 'CAROUSEL'
  );
  const shouldRotateCarousel = shouldRotateMusicPresentation({
    carouselEnabled,
    hasPlaybackSession,
    isPlaying,
    trackCount: tracks.length,
  });
  const carouselIntervalMs = Math.max(3, player?.carouselIntervalSeconds || 8) * 1000;
  const effectiveDuration = hasPlaybackSession
    ? (duration > 0 ? duration : playbackTrackDuration)
    : displayTrackDuration;
  const displayedProgress = hasPlaybackSession ? progress : 0;
  const effectiveProgress = effectiveDuration > 0
    ? Math.min(effectiveDuration, Math.max(0, displayedProgress))
    : Math.max(0, displayedProgress);
  const effectivePercent = effectiveDuration > 0
    ? Math.min(100, Math.max(0, (effectiveProgress / effectiveDuration) * 100))
    : 0;
  const lyrics = useMemo(() => parseMusicLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const lyricIndex = useMemo(() => activeLyricIndex(lyrics, effectiveProgress), [lyrics, effectiveProgress]);

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

  const persistPlaybackSnapshot = useCallback((position = progressRef.current) => {
    if (!playbackPreferencesHydrated) return;
    const track = tracks[playbackIndexRef.current];
    if (!track) return;
    try {
      localStorage.setItem(MUSIC_PLAYBACK_STORAGE_KEY, JSON.stringify({
        trackId: track.id,
        position: Math.max(0, Number.isFinite(position) ? position : 0),
        volume: volumeRef.current,
      }));
    } catch {
      /* Persistence is best effort in private browsing and restricted storage contexts. */
    }
  }, [playbackPreferencesHydrated, tracks]);

  const clearPlaybackSnapshot = useCallback(() => {
    storedPlaybackRef.current = null;
    pendingRestoreRef.current = null;
    try {
      localStorage.removeItem(MUSIC_PLAYBACK_STORAGE_KEY);
    } catch {
      /* Closing the player still succeeds when storage is unavailable. */
    }
  }, []);

  const isActiveAudioEvent = useCallback((audio: HTMLAudioElement) => {
    const activeSource = activeAudioSrcRef.current;
    if (!activeSource) return !sourceTransitionRef.current;
    return !audio.currentSrc || audio.currentSrc === activeSource;
  }, []);

  const setShuffle = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShuffleState((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (next && !previous) {
        shuffleHistoryRef.current = createShuffleHistory(playbackIndexRef.current);
      }
      return next;
    });
  }, []);

  const selectPlaybackIndex = useCallback((index: number) => {
    if (tracks.length === 0) return 0;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    const sourceChanged = safeIndex !== playbackIndexRef.current;
    if (sourceChanged) {
      sourceTransitionRef.current = true;
      sourceRequestRef.current += 1;
      activeAudioSrcRef.current = '';
      audioRef.current?.pause();
      setIsPlaying(false);
    }
    pendingRestoreRef.current = null;
    if (!sourceChanged && audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {
        /* Metadata may not be ready yet; the visible progress still restarts at zero. */
      }
    }
    playbackIndexRef.current = safeIndex;
    presentationIndexRef.current = safeIndex;
    setPlaybackIndex(safeIndex);
    setPresentationIndex(safeIndex);
    progressRef.current = 0;
    setProgress(0);
    if (shuffle) {
      shuffleHistoryRef.current = recordShuffleSelection(shuffleHistoryRef.current, safeIndex);
    }
    persistPlaybackSnapshot(0);
    return safeIndex;
  }, [persistPlaybackSnapshot, shuffle, tracks]);

  const attemptPlayback = useCallback(async ({
    source = audioSrc,
    failureMessage = '这首歌暂时无法播放。',
  }: {
    source?: string;
    failureMessage?: string;
  } = {}) => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    const requestId = sourceRequestRef.current;
    playIntentRef.current = true;
    setHasPlaybackSession(true);
    setPlaybackError(null);
    setIsBuffering(true);
    try {
      let desiredSource = source;
      try {
        desiredSource = new URL(source, document.baseURI).href;
      } catch {
        /* audio.src will perform the final URL normalization */
      }
      if (activeAudioSrcRef.current !== desiredSource) {
        sourceTransitionRef.current = true;
        audio.src = source;
        activeAudioSrcRef.current = audio.src;
        audio.load();
      }
      await audio.play();
      if (requestId !== sourceRequestRef.current || !playIntentRef.current) return;
      sourceTransitionRef.current = false;
      setIsBuffering(false);
    } catch (error) {
      if (requestId !== sourceRequestRef.current) return;
      sourceTransitionRef.current = false;
      playIntentRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      setPlaybackError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '浏览器需要你确认播放，请再点一次。'
          : error instanceof DOMException && error.name === 'NotSupportedError'
            ? '当前浏览器无法播放这个音频格式。'
            : failureMessage
      );
    }
  }, [audioSrc]);

  const pausePlayback = useCallback(() => {
    playIntentRef.current = false;
    sourceTransitionRef.current = false;
    sourceRequestRef.current += 1;
    audioRef.current?.pause();
    setIsPlaying(false);
    setIsBuffering(false);
    persistPlaybackSnapshot();
  }, [persistPlaybackSnapshot]);

  const restartCurrentPlayback = useCallback(() => {
    const audio = audioRef.current;
    pendingRestoreRef.current = null;
    progressRef.current = 0;
    setProgress(0);
    setPlaybackError(null);
    setHasPlaybackSession(true);
    playIntentRef.current = true;
    if (audio) {
      try {
        audio.currentTime = 0;
      } catch {
        /* Metadata may not be ready yet; loadedmetadata applies pending seeks. */
      }
    }
    void attemptPlayback();
  }, [attemptPlayback]);

  useEffect(() => {
    let stored: ReturnType<typeof parseStoredMusicPlayback> = null;
    try {
      stored = parseStoredMusicPlayback(localStorage.getItem(MUSIC_PLAYBACK_STORAGE_KEY));
    } catch {
      /* Storage access may be blocked even when localStorage exists. */
    }
    storedPlaybackRef.current = stored;
    if (stored) {
      volumeRef.current = stored.volume;
      setVolumeState(stored.volume);
    }
    setPlaybackPreferencesHydrated(true);
  }, []);

  useEffect(() => {
    const enabled = Boolean(
      player?.randomEnabled ||
        player?.playlist?.randomEnabled ||
        player?.playbackMode === 'SHUFFLE'
    );
    setShuffleState((previous) => {
      if (enabled && !previous) {
        shuffleHistoryRef.current = createShuffleHistory(playbackIndexRef.current);
      }
      return enabled;
    });
  }, [player?.randomEnabled, player?.playlist?.randomEnabled, player?.playbackMode]);

  useEffect(() => {
    if (!playbackPreferencesHydrated || didRestorePlaybackRef.current || tracks.length === 0) return;
    didRestorePlaybackRef.current = true;
    const stored = storedPlaybackRef.current;
    if (!stored) return;
    const restoredIndex = tracks.findIndex((track) => track.id === stored.trackId);
    if (restoredIndex < 0) return;
    const restoredTrack = tracks[restoredIndex];
    const position = resolveRestoredMusicPosition({
      position: stored.position,
      duration: restoredTrack.durationSeconds ?? 0,
    });
    playbackIndexRef.current = restoredIndex;
    presentationIndexRef.current = restoredIndex;
    setPlaybackIndex(restoredIndex);
    setPresentationIndex(restoredIndex);
    shuffleHistoryRef.current = createShuffleHistory(restoredIndex);
    progressRef.current = position;
    setProgress(position);
    if (position > 0) {
      pendingRestoreRef.current = { trackId: restoredTrack.id, position };
      setHasPlaybackSession(true);
    }
  }, [playbackPreferencesHydrated, tracks]);

  useEffect(() => {
    if (tracks.length > 0 && playbackIndexRef.current >= tracks.length) {
      playbackIndexRef.current = 0;
      presentationIndexRef.current = 0;
      setPlaybackIndex(0);
      setPresentationIndex(0);
    }
    if (!canRender) {
      const audio = audioRef.current;
      playIntentRef.current = false;
      sourceTransitionRef.current = false;
      sourceRequestRef.current += 1;
      activeAudioSrcRef.current = '';
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      setIsPlaying(false);
      setIsBuffering(false);
      setPlaybackError(null);
      setProgress(0);
      setDuration(0);
      setHasPlaybackSession(false);
    }
  }, [canRender, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc || !canRender || !hasPlaybackSession) return;
    let desiredSource = audioSrc;
    try {
      desiredSource = new URL(audioSrc, document.baseURI).href;
    } catch {
      /* audio.src will perform the final URL normalization */
    }
    // A direct user gesture may already have started this exact source. Reloading it
    // here would interrupt playback and move a second play() call outside that gesture.
    if (activeAudioSrcRef.current === desiredSource) {
      setDuration(playbackTrackDuration);
      return;
    }
    sourceRequestRef.current += 1;
    sourceTransitionRef.current = true;
    const shouldContinuePlayback = playIntentRef.current;
    setPlaybackError(null);
    setIsPlaying(false);
    setIsBuffering(shouldContinuePlayback);
    audio.src = audioSrc;
    activeAudioSrcRef.current = audio.src;
    audio.load();
    const pendingRestore = pendingRestoreRef.current;
    const initialProgress = pendingRestore?.trackId === playbackTrack?.id
      ? pendingRestore.position
      : 0;
    progressRef.current = initialProgress;
    setProgress(initialProgress);
    setDuration(playbackTrackDuration);
    if (shouldContinuePlayback) {
      void attemptPlayback();
    } else {
      sourceTransitionRef.current = false;
    }
  }, [attemptPlayback, audioSrc, canRender, hasPlaybackSession, playbackTrack?.id, playbackTrackDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
    volumeRef.current = volume;
    persistPlaybackSnapshot();
  }, [persistPlaybackSnapshot, volume]);

  const advanceTrack = useCallback(
    (manual: boolean) => {
      if (tracks.length === 0) return;
      const index = playbackIndexRef.current;
      const shouldWrap = manual || player?.playbackMode === 'LOOP';
      if (tracks.length === 1) {
        if (!shouldWrap && !shuffle) {
          const audio = audioRef.current;
          playIntentRef.current = false;
          sourceTransitionRef.current = false;
          if (audio) {
            audio.pause();
            audio.currentTime = 0;
          }
          progressRef.current = 0;
          setProgress(0);
          setIsPlaying(false);
          setIsBuffering(false);
          persistPlaybackSnapshot(0);
          return;
        }
        restartCurrentPlayback();
        return;
      }
      if (!manual && !shuffle && index >= tracks.length - 1 && !shouldWrap) {
        const audio = audioRef.current;
        playIntentRef.current = false;
        sourceTransitionRef.current = false;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        progressRef.current = 0;
        setProgress(0);
        setIsPlaying(false);
        setIsBuffering(false);
        persistPlaybackSnapshot(0);
        return;
      }
      let nextIndex = (index + 1) % tracks.length;
      if (shuffle) {
        const result = resolveShuffleNavigation({
          state: shuffleHistoryRef.current,
          currentIndex: index,
          direction: 1,
          trackCount: tracks.length,
          randomValue: Math.random(),
        });
        shuffleHistoryRef.current = result.state;
        nextIndex = result.nextIndex;
      }
      playIntentRef.current = true;
      setHasPlaybackSession(true);
      setPlaybackError(null);
      setIsBuffering(true);
      selectPlaybackIndex(nextIndex);
    },
    [persistPlaybackSnapshot, player?.playbackMode, restartCurrentPlayback, selectPlaybackIndex, shuffle, tracks.length]
  );

  const playIndex = useCallback(
    (index: number, options?: { expand?: boolean }) => {
      if (tracks.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
      const targetSource = resolveMusicAudioSrc(tracks[safeIndex]);
      if (!targetSource) return;
      playIntentRef.current = true;
      setHasPlaybackSession(true);
      setPlaybackError(null);
      setIsBuffering(true);
      selectPlaybackIndex(safeIndex);
      if (options?.expand) setExpanded(true);
      // Keep the first play() inside the click/key event task so Safari and other
      // autoplay-policy browsers preserve the user's activation.
      void attemptPlayback({ source: targetSource });
    },
    [attemptPlayback, selectPlaybackIndex, tracks]
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
      setShuffleState(false);
      shuffleHistoryRef.current = createShuffleHistory(0);
      playIndex(0, options);
    },
    [playIndex]
  );

  const playShuffled = useCallback(
    (options?: { expand?: boolean }) => {
      if (tracks.length === 0) return;
      const activeIndex = hasPlaybackSession
        ? playbackIndexRef.current
        : presentationIndexRef.current;
      const startIndex = resolveMusicStartIndex({
        trackCount: tracks.length,
        currentIndex: activeIndex,
        shuffle: true,
        randomValue: Math.random(),
      });
      setShuffleState(true);
      shuffleHistoryRef.current = createShuffleHistory(startIndex);
      playIndex(startIndex, options);
    },
    [hasPlaybackSession, playIndex, tracks.length]
  );

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playIntentRef.current || isPlaying) {
      pausePlayback();
      return;
    }
    const targetIndex = hasPlaybackSession
      ? playbackIndexRef.current
      : presentationIndexRef.current;
    const targetSource = resolveMusicAudioSrc(tracks[targetIndex]);
    if (!targetSource) return;
    const isCurrentSource = targetIndex === playbackIndexRef.current;
    playIntentRef.current = true;
    setHasPlaybackSession(true);
    setPlaybackError(null);
    setIsBuffering(true);
    if (!hasPlaybackSession || !isCurrentSource) {
      selectPlaybackIndex(targetIndex);
      await attemptPlayback({ source: targetSource });
      return;
    }
    await attemptPlayback();
  }, [attemptPlayback, hasPlaybackSession, isPlaying, pausePlayback, selectPlaybackIndex, tracks]);

  const retryPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    sourceRequestRef.current += 1;
    sourceTransitionRef.current = true;
    playIntentRef.current = true;
    setHasPlaybackSession(true);
    audio.load();
    await attemptPlayback({ failureMessage: '仍然无法播放，请检查媒体文件或稍后再试。' });
  }, [attemptPlayback, audioSrc]);

  const previousTrack = useCallback(() => {
    if (tracks.length === 0) return;
    const index = playbackIndexRef.current;
    if (progressRef.current > 3) {
      restartCurrentPlayback();
      return;
    }
    const result = shuffle
      ? resolveShuffleNavigation({
          state: shuffleHistoryRef.current,
          currentIndex: index,
          direction: -1,
          trackCount: tracks.length,
          randomValue: Math.random(),
        })
      : {
          ...resolveAdjacentTrack({
            currentIndex: index,
            direction: -1,
            trackCount: tracks.length,
          }),
          state: shuffleHistoryRef.current,
        };
    shuffleHistoryRef.current = result.state;
    if (result.restartCurrent) {
      restartCurrentPlayback();
      return;
    }
    playIntentRef.current = true;
    setHasPlaybackSession(true);
    setPlaybackError(null);
    setIsBuffering(true);
    selectPlaybackIndex(result.nextIndex);
  }, [restartCurrentPlayback, selectPlaybackIndex, shuffle, tracks.length]);

  const nextTrack = useCallback(() => advanceTrack(true), [advanceTrack]);

  useEffect(() => {
    if (!canRender || !shouldRotateCarousel || tracks.length <= 1) return;

    const timer = window.setInterval(() => {
      setPresentationIndex((index) => {
        const nextIndex = shuffle
          ? pickRandomIndex(tracks.length, index)
          : (index + 1) % tracks.length;
        presentationIndexRef.current = nextIndex;
        return nextIndex;
      });
    }, carouselIntervalMs);

    return () => window.clearInterval(timer);
  }, [canRender, carouselIntervalMs, shouldRotateCarousel, shuffle, tracks.length]);

  const seekToTime = useCallback((requestedTime: number) => {
    if (!Number.isFinite(requestedTime)) return;
    const audio = audioRef.current;
    const targetIndex = hasPlaybackSession
      ? playbackIndexRef.current
      : presentationIndexRef.current;
    const targetTrack = tracks[targetIndex];
    const targetDuration = hasPlaybackSession
      ? effectiveDuration
      : (targetTrack?.durationSeconds ?? 0);
    const nextTime = targetDuration > 0
      ? Math.min(targetDuration, Math.max(0, requestedTime))
      : Math.max(0, requestedTime);
    if (!hasPlaybackSession) {
      selectPlaybackIndex(targetIndex);
      setHasPlaybackSession(true);
      if (targetTrack) {
        pendingRestoreRef.current = { trackId: targetTrack.id, position: nextTime };
      }
    } else if (targetTrack && (!audio || audio.readyState === 0)) {
      pendingRestoreRef.current = { trackId: targetTrack.id, position: nextTime };
    }
    if (audio) {
      try {
        audio.currentTime = nextTime;
      } catch {
        /* Safari may reject currentTime before metadata is ready; keep UI progress responsive. */
      }
    }
    progressRef.current = nextTime;
    setProgress(nextTime);
    persistPlaybackSnapshot(nextTime);
  }, [effectiveDuration, hasPlaybackSession, persistPlaybackSnapshot, selectPlaybackIndex, tracks]);

  const seekToPercent = useCallback((nextPercent: number) => {
    if (!Number.isFinite(nextPercent)) return;
    const targetDuration = effectiveDuration;
    if (targetDuration <= 0) return;
    seekToTime((nextPercent / 100) * targetDuration);
  }, [effectiveDuration, seekToTime]);

  const setVolume = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const nextVolume = Math.min(1, Math.max(0, value));
    volumeRef.current = nextVolume;
    setVolumeState(nextVolume);
  }, []);

  const dismissPlayer = useCallback(() => {
    const audio = audioRef.current;
    playIntentRef.current = false;
    // Make queued pause/load events stale before clearing storage, so they cannot recreate the snapshot.
    sourceTransitionRef.current = true;
    sourceRequestRef.current += 1;
    activeAudioSrcRef.current = '';
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    progressRef.current = 0;
    lastPersistAtRef.current = 0;
    setProgress(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    setPlaybackError(null);
    setHasPlaybackSession(false);
    setExpanded(false);
    clearPlaybackSnapshot();
  }, [clearPlaybackSnapshot]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    if (!playbackTrack || !hasPlaybackSession) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const cover = resolveMusicCoverSrc(playbackTrack);
    const presentation = resolveMusicTrackPresentation(playbackTrack);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: presentation.title,
      artist: presentation.artist || player?.playlist?.name || '音乐大厅',
      album: playbackTrack.album || player?.playlist?.name || '音乐大厅',
      artwork: cover ? [{ src: cover }] : [],
    });
    const registeredActions: MediaSessionAction[] = [];
    const registerAction = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        registeredActions.push(action);
      } catch {
        /* Browsers may expose Media Session while omitting individual actions. */
      }
    };
    registerAction('play', () => void attemptPlayback());
    registerAction('pause', pausePlayback);
    registerAction('previoustrack', previousTrack);
    registerAction('nexttrack', nextTrack);
    registerAction('seekbackward', (details) => {
      seekToTime(progressRef.current - (details.seekOffset ?? 10));
    });
    registerAction('seekforward', (details) => {
      seekToTime(progressRef.current + (details.seekOffset ?? 10));
    });
    registerAction('seekto', (details) => {
      if (details.seekTime == null) return;
      const audio = audioRef.current;
      if (details.fastSeek && audio?.fastSeek) {
        const nextTime = effectiveDuration > 0
          ? Math.min(effectiveDuration, Math.max(0, details.seekTime))
          : Math.max(0, details.seekTime);
        audio.fastSeek(nextTime);
        progressRef.current = nextTime;
        setProgress(nextTime);
        persistPlaybackSnapshot(nextTime);
        return;
      }
      seekToTime(details.seekTime);
    });
    registerAction('stop', dismissPlayer);

    return () => {
      for (const action of registeredActions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [
    attemptPlayback,
    effectiveDuration,
    hasPlaybackSession,
    nextTrack,
    pausePlayback,
    playbackTrack,
    persistPlaybackSnapshot,
    player?.playlist?.name,
    previousTrack,
    seekToTime,
    dismissPlayer,
  ]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = hasPlaybackSession
      ? (isPlaying ? 'playing' : 'paused')
      : 'none';
    if (!hasPlaybackSession) {
      try {
        navigator.mediaSession.setPositionState();
      } catch {
        /* ignore */
      }
      return;
    }
    if (effectiveDuration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: effectiveDuration,
        playbackRate: audioRef.current?.playbackRate || 1,
        position: Math.min(effectiveDuration, Math.max(0, effectiveProgress)),
      });
    } catch {
      /* Invalid or transient metadata must not break playback. */
    }
  }, [effectiveDuration, effectiveProgress, hasPlaybackSession, isPlaying]);

  // ---- 音乐皮肤:后台默认 ←被→ 前台访客本地覆盖 ----
  const [skinOverride, setSkinOverride] = useState<StoredMusicSkin | null>(null);

  // 客户端水合本地覆盖(SSR 首帧用后台默认,避免 hydration mismatch)
  useEffect(() => {
    setSkinOverride(readStoredMusicSkin());
  }, []);

  const backendSkin = useMemo(
    () => normalizeMusicSkin(player?.skinMode, player?.skinPreset, player?.skinColorLight, player?.skinColorDark),
    [player?.skinMode, player?.skinPreset, player?.skinColorLight, player?.skinColorDark]
  );

  const resolvedSkin = useMemo(
    () => (skinOverride
      ? normalizeMusicSkin(
          skinOverride.mode,
          skinOverride.mode === 'preset' ? skinOverride.preset : undefined,
          skinOverride.mode === 'custom' ? skinOverride.light : undefined,
          skinOverride.mode === 'custom' ? skinOverride.dark : undefined,
        )
      : backendSkin),
    [skinOverride, backendSkin]
  );

  // 自定义模式注入作用域 <style>(预设模式纯 CSS,不注入);镜像 SiteSettingsProvider 范式
  useEffect(() => {
    const STYLE_ID = 'aetherblog-music-skin';
    const remove = () => document.getElementById(STYLE_ID)?.remove();
    if (resolvedSkin.mode !== 'custom' || !resolvedSkin.light) {
      remove();
      return;
    }
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    const light = resolvedSkin.light;
    const dark = resolvedSkin.dark || light;
    el.textContent =
      `[data-music-skin="custom"]{--music-seed:${light};}\n` +
      `:root.dark [data-music-skin="custom"]{--music-seed:${dark};}`;
    return remove;
  }, [resolvedSkin.mode, resolvedSkin.light, resolvedSkin.dark]);

  const selectPresetSkin = useCallback((id: string) => {
    const next: StoredMusicSkin = { mode: 'preset', preset: isMusicSkinPresetId(id) ? id : DEFAULT_MUSIC_SKIN_PRESET };
    setSkinOverride(next);
    writeStoredMusicSkin(next);
  }, []);

  const selectCustomSkin = useCallback((light: string, dark: string) => {
    const l = sanitizeMusicSeed(light);
    if (!l) return;
    const next: StoredMusicSkin = { mode: 'custom', light: l, dark: sanitizeMusicSeed(dark) || l };
    setSkinOverride(next);
    writeStoredMusicSkin(next);
  }, []);

  const resetSkin = useCallback(() => {
    setSkinOverride(null);
    clearStoredMusicSkin();
  }, []);

  const retryPlayer = useCallback(() => {
    void refetchPlayer();
  }, [refetchPlayer]);

  const value = useMemo<MusicPlayerContextValue>(() => ({
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
    progress: effectiveProgress,
    duration: effectiveDuration,
    percent: effectivePercent,
    volume,
    expanded,
    hasPlaybackSession,
    lyrics,
    activeLyricIndex: lyricIndex,
    canRender,
    canUseSurface,
    playIndex,
    playTrack,
    playAll,
    playShuffled,
    togglePlayback,
    retryPlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    dismissPlayer,
    setShuffle,
    setExpanded,
    setVolume,
    skin: resolvedSkin.value,
    skinMode: resolvedSkin.mode,
    skinCustomLight: resolvedSkin.light,
    skinCustomDark: resolvedSkin.dark,
    hasSkinOverride: skinOverride != null,
    selectPresetSkin,
    selectCustomSkin,
    resetSkin,
  }), [
    canRender,
    canUseSurface,
    currentIndex,
    currentTrack,
    effectiveDuration,
    effectivePercent,
    effectiveProgress,
    expanded,
    hasPlaybackSession,
    isPlaying,
    isBuffering,
    isPlayerLoading,
    lyricIndex,
    lyrics,
    nextTrack,
    playAll,
    playShuffled,
    playIndex,
    playTrack,
    player,
    playerLoadError,
    previousTrack,
    seekToPercent,
    dismissPlayer,
    shuffle,
    setShuffle,
    togglePlayback,
    tracks,
    volume,
    setVolume,
    resolvedSkin,
    skinOverride,
    selectPresetSkin,
    selectCustomSkin,
    resetSkin,
    retryPlayback,
    retryPlayer,
    playbackError,
  ]);

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          const metadataDuration = event.currentTarget.duration;
          const resolvedDuration = Number.isFinite(metadataDuration) && metadataDuration > 0
            ? metadataDuration
            : playbackTrackDuration;
          setDuration(resolvedDuration);
          const pendingRestore = pendingRestoreRef.current;
          if (pendingRestore?.trackId === playbackTrack?.id) {
            const restoredPosition = resolveRestoredMusicPosition({
              position: pendingRestore.position,
              duration: resolvedDuration,
            });
            try {
              event.currentTarget.currentTime = restoredPosition;
            } catch {
              /* The visible position remains restored even if this browser defers seeking. */
            }
            pendingRestoreRef.current = null;
            progressRef.current = restoredPosition;
            setProgress(restoredPosition);
          }
        }}
        onCanPlay={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          if (!playIntentRef.current) setIsBuffering(false);
        }}
        onPlaying={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          sourceTransitionRef.current = false;
          playIntentRef.current = true;
          setHasPlaybackSession(true);
          setIsPlaying(true);
          setIsBuffering(false);
          setPlaybackError(null);
        }}
        onPlay={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          if (!playIntentRef.current) {
            event.currentTarget.pause();
            return;
          }
          setIsPlaying(true);
        }}
        onPause={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          setIsPlaying(false);
          if (sourceTransitionRef.current && playIntentRef.current) {
            setIsBuffering(true);
            return;
          }
          playIntentRef.current = false;
          setIsBuffering(false);
          persistPlaybackSnapshot();
        }}
        onWaiting={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          if (playIntentRef.current) setIsBuffering(true);
        }}
        onStalled={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          if (playIntentRef.current) setIsBuffering(true);
        }}
        onDurationChange={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          const metadataDuration = event.currentTarget.duration;
          if (Number.isFinite(metadataDuration) && metadataDuration > 0) setDuration(metadataDuration);
        }}
        onTimeUpdate={(event) => {
          if (!isActiveAudioEvent(event.currentTarget) || sourceTransitionRef.current) return;
          const nextProgress = event.currentTarget.currentTime;
          if (!Number.isFinite(nextProgress)) return;
          progressRef.current = nextProgress;
          setProgress(nextProgress);
          const now = Date.now();
          if (now - lastPersistAtRef.current >= 1000) {
            lastPersistAtRef.current = now;
            persistPlaybackSnapshot(nextProgress);
          }
        }}
        onError={(event) => {
          if (!isActiveAudioEvent(event.currentTarget)) return;
          sourceTransitionRef.current = false;
          playIntentRef.current = false;
          setIsPlaying(false);
          setIsBuffering(false);
          setPlaybackError('这首歌暂时无法播放。');
        }}
        onEnded={(event) => {
          if (!isActiveAudioEvent(event.currentTarget) || sourceTransitionRef.current) return;
          advanceTrack(false);
        }}
      />
      <PersistentMusicDock value={value} />
    </MusicPlayerContext.Provider>
  );
}

function MusicArtwork({
  track,
  className,
  sizes = '4rem',
  size = 'thumbnail',
  showFallbackLabel = false,
}: {
  track: MusicTrack | undefined;
  className?: string;
  sizes?: string;
  size?: 'thumbnail' | 'hero';
  showFallbackLabel?: boolean;
}) {
  const cover = resolveMusicCoverSrc(track);
  const presentation = resolveMusicTrackPresentation(track ?? {});

  return (
    <div
      data-music-artwork
      data-has-cover={cover ? 'true' : 'false'}
      data-size={size}
      className={cn(
        'music-artwork relative aspect-square shrink-0 overflow-hidden bg-[var(--bg-leaf)]',
        className,
      )}
    >
      {cover ? (
        <Image
          src={cover}
          alt={track?.title ? `${presentation.title} 封面` : '音乐封面'}
          fill
          sizes={sizes}
          className="object-cover"
          unoptimized
          priority={sizes.includes('100vw')}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[color-mix(in_oklch,var(--ink-primary)_4%,var(--bg-raised))] px-3 text-[var(--ink-muted)]">
          <Disc3 className={cn(showFallbackLabel ? 'h-9 w-9' : 'h-5 w-5')} aria-hidden="true" />
          {showFallbackLabel && <span className="text-[11px] font-semibold">暂无封面</span>}
        </div>
      )}
    </div>
  );
}

export function NowPlayingGlyph({ className }: { className?: string }) {
  return (
    <span className={cn('music-wave-mark', className)} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function PersistentMusicDock({ value }: { value: MusicPlayerContextValue }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const {
    player,
    tracks,
    currentTrack,
    currentIndex,
    isPlaying,
    isBuffering,
    playbackError,
    shuffle,
    progress,
    duration,
    percent,
    volume,
    expanded,
    hasPlaybackSession,
    lyrics,
    activeLyricIndex,
    canRender,
    skin,
    togglePlayback,
    retryPlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    dismissPlayer,
    setShuffle,
    setExpanded,
    setVolume,
  } = value;

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLParagraphElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const desktopDialogRef = useRef<HTMLDivElement>(null);
  const mobilePlayerTriggerRef = useRef<HTMLButtonElement>(null);
  const desktopPlayerTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileLyricsBoxRef = useRef<HTMLDivElement>(null);
  const mobileActiveLyricRef = useRef<HTMLParagraphElement>(null);
  const mobilePaneHeadingRef = useRef<HTMLHeadingElement>(null);
  const desktopLyricsTabRef = useRef<HTMLButtonElement>(null);
  const desktopQueueTabRef = useRef<HTMLButtonElement>(null);
  const [mobilePane, setMobilePane] = useState<'player' | 'lyrics' | 'queue'>('player');
  const [desktopPane, setDesktopPane] = useState<'lyrics' | 'queue'>('lyrics');
  const prefersReducedMotion = useReducedMotion();
  const closeExpandedPlayer = useCallback(() => setExpanded(false), [setExpanded]);
  const focusDesktopPaneTab = useCallback((pane: 'lyrics' | 'queue') => {
    setDesktopPane(pane);
    window.requestAnimationFrame(() => {
      (pane === 'lyrics' ? desktopLyricsTabRef.current : desktopQueueTabRef.current)?.focus();
    });
  }, []);
  const handleDesktopPaneKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextPane: 'lyrics' | 'queue' | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home') nextPane = 'lyrics';
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End') nextPane = 'queue';
    if (!nextPane) return;
    event.preventDefault();
    if (nextPane === desktopPane) return;
    focusDesktopPaneTab(nextPane);
  }, [desktopPane, focusDesktopPaneTab]);

  useDialogLifecycle({
    open: expanded,
    onClose: closeExpandedPlayer,
    containerRef: isMobile ? mobileDialogRef : desktopDialogRef,
    initialFocusRef: isMobile ? mobileDialogRef : desktopDialogRef,
    returnFocusRef: isMobile ? mobilePlayerTriggerRef : desktopPlayerTriggerRef,
    modal: true,
    trapFocus: true,
  });

  useEffect(() => {
    if (!expanded) setMobilePane('player');
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !isMobile || mobilePane === 'player') return;
    mobilePaneHeadingRef.current?.focus({ preventScroll: true });
  }, [expanded, isMobile, mobilePane]);

  // 歌词自动滚动:当前行始终居中可见，并尊重系统“减少动态效果”设置。
  useEffect(() => {
    if (!expanded || isMobile || desktopPane !== 'lyrics') return;
    const line = activeLyricRef.current;
    const box = lyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyricIndex, desktopPane, expanded, isMobile, prefersReducedMotion]);

  useEffect(() => {
    if (!expanded || !isMobile || mobilePane !== 'lyrics') return;
    const line = mobileActiveLyricRef.current;
    const box = mobileLyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyricIndex, expanded, isMobile, mobilePane, prefersReducedMotion]);

  const routeBlocksPlayerSurface =
    pathname.startsWith('/agent/workspace') ||
    pathname.startsWith('/team-chat') ||
    pathname.startsWith('/reader/');

  useEffect(() => {
    if (routeBlocksPlayerSurface && expanded) setExpanded(false);
  }, [expanded, routeBlocksPlayerSurface, setExpanded]);

  if (
    !canRender ||
    !currentTrack ||
    routeBlocksPlayerSurface ||
    (!hasPlaybackSession && !isPlaying && !expanded)
  ) return null;
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : '';
  const playlistName = player?.playlist?.name || '音乐大厅';
  const currentPresentation = resolveMusicTrackPresentation(currentTrack);
  const artistLabel = currentPresentation.artist || meaningfulMusicText(currentTrack.album);
  const compactArtistLabel = artistLabel || playlistName;
  const currentCover = resolveMusicCoverSrc(currentTrack);
  const mobilePaneTransport = (
    <div className="grid grid-cols-3 items-center justify-items-center border-t border-[var(--music-stroke)] py-3">
      <button type="button" onClick={previousTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
        <SkipBack className="h-7 w-7 fill-current" strokeWidth={1.5} />
      </button>
      <button type="button" onClick={playbackError ? () => void retryPlayback() : togglePlayback} className="music-control-button music-transport-button music-transport-button--primary grid h-16 w-16 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}>
        {isBuffering ? <RefreshCw className="h-8 w-8 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-9 w-9 fill-current" strokeWidth={1.5} /> : <Play className="h-9 w-9 translate-x-px fill-current" strokeWidth={1.5} />}
      </button>
      <button type="button" onClick={nextTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
        <SkipForward className="h-7 w-7 fill-current" strokeWidth={1.5} />
      </button>
    </div>
  );

  return (
    <>
      {/* 沉浸层打开时隐藏 dock —— dock(z-70)原本盖在沉浸层(z-65)之上,移动端尤其会压住沉浸层控件 */}
      {!expanded && (
      <>
        {!pathname.startsWith('/music') && (
          <div
            data-music-mini-player-spacer
            className="h-[calc(5.5rem+env(safe-area-inset-bottom))] w-full shrink-0"
            aria-hidden="true"
          />
        )}
        <div
          data-music-skin={skin}
          data-music-mini-player
          className="pointer-events-none fixed inset-x-5 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[70] min-[769px]:hidden"
        >
          <div className="music-mini-player pointer-events-auto grid h-14 grid-cols-[40px_minmax(0,1fr)_44px_44px] items-center gap-1 overflow-hidden p-1.5 text-[var(--ink-primary)]">
            <button
              ref={mobilePlayerTriggerRef}
              type="button"
              onClick={() => setExpanded(true)}
              className="col-span-2 grid h-11 min-w-0 grid-cols-[40px_minmax(0,1fr)] items-center gap-1.5 rounded-[var(--music-radius-artwork-sm)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label="打开音乐播放器"
            >
              <MusicArtwork track={currentTrack} className="h-10 w-10" sizes="40px" />
              <span className="min-w-0 px-1">
                <span className="block truncate text-[13px] font-bold leading-5 text-[var(--ink-primary)]">{currentPresentation.title}</span>
                <span className={cn('block truncate text-[11px] leading-4', playbackError ? 'font-semibold text-[var(--signal-danger)]' : 'text-[var(--ink-muted)]')}>
                  {playbackError ? playbackError : isBuffering ? '正在载入…' : compactArtistLabel}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={playbackError ? () => void retryPlayback() : togglePlayback}
              className="music-control-button music-icon-button grid h-11 w-11 place-items-center rounded-full text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}
            >
              {isBuffering ? <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
            </button>

            <button
              type="button"
              onClick={nextTrack}
              className="music-control-button music-icon-button grid h-11 w-11 place-items-center rounded-full text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label="下一首"
            >
              <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
            </button>
            {playbackError && <span role="alert" className="sr-only">音乐播放失败，请打开播放器重试。</span>}
          </div>
        </div>

      <div data-music-skin={skin} data-music-desktop-dock className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] hidden px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] min-[769px]:block">
        <div className="music-dock pointer-events-auto mx-auto w-full max-w-5xl overflow-hidden text-[var(--ink-primary)]">
          <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 p-2.5">
            <button
              ref={desktopPlayerTriggerRef}
              type="button"
              onClick={() => setExpanded(true)}
              className="music-control-button relative h-12 w-12 self-center rounded-[var(--music-radius-artwork-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
              aria-label="打开音乐大厅播放器"
            >
              <MusicArtwork track={currentTrack} className="h-12 w-12" sizes="48px" />
            </button>

            <div className="relative flex h-12 min-w-0 flex-col justify-center">
              <p className="truncate text-sm font-bold leading-5 text-[var(--ink-primary)] sm:text-[15px]">{currentPresentation.title}</p>
              {playbackError ? (
                <p role="alert" className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold leading-4 text-[var(--signal-danger)]" title={playbackError}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{playbackError} · 点击右侧重试</span>
                </p>
              ) : (
                <p className="truncate text-[11px] leading-4 text-[var(--ink-secondary)]">
                  {isBuffering ? '正在载入…' : `${compactArtistLabel} · ${playlistName} · ${currentIndex + 1}/${tracks.length}${activeLine ? ` · ${activeLine}` : ''}`}
                </p>
              )}
              <div data-music-desktop-dock-progress className="absolute inset-x-0 -bottom-2.5 z-10">
                <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="sm" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShuffle((value) => !value)}
                className={cn(
                  'music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
                  shuffle
                    ? 'text-[var(--aurora-1)]'
                    : 'text-[var(--ink-muted)]'
                )}
                data-selected={shuffle ? 'true' : 'false'}
                aria-label="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <button type="button" onClick={previousTrack} className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
                <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={playbackError ? () => void retryPlayback() : togglePlayback}
                className="music-control-button music-icon-button music-icon-button--tinted flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}
              >
                {isBuffering ? <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
              </button>
              <button type="button" onClick={nextTrack} className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {expanded && (
        <>
        <div
          ref={mobileDialogRef}
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐播放器"
          tabIndex={-1}
          className="fixed inset-0 z-[70] h-[100dvh] overflow-hidden bg-[color-mix(in_oklch,var(--bg-void)_92%,transparent)] text-[var(--ink-primary)] [backdrop-filter:blur(30px)_saturate(150%)] min-[769px]:hidden"
        >
          <section className="music-mobile-player-sheet relative flex h-[100dvh] min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,color-mix(in_oklch,var(--aurora-1)_10%,var(--bg-raised)),var(--bg-void)_72%)] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]">
            {currentCover && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <Image src={currentCover} alt="" fill sizes="100vw" className="scale-110 object-cover opacity-20 blur-[56px] saturate-150" unoptimized />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--bg-void)_34%,transparent),var(--bg-void)_84%)]" />
              </div>
            )}

            <header className="relative z-10 grid min-h-12 grid-cols-[44px_minmax(0,1fr)_44px] items-center px-3">
              <button
                type="button"
                onClick={mobilePane === 'player' ? closeExpandedPlayer : () => setMobilePane('player')}
                className="music-control-button music-icon-button grid h-11 w-11 place-items-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label={mobilePane === 'player' ? '收起音乐播放器' : '返回正在播放'}
              >
                {mobilePane === 'player' ? <ChevronDown className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
              </button>
              <div className="min-w-0 text-center" aria-live="polite" aria-atomic="true">
                <p className="truncate text-[11px] font-semibold text-[var(--ink-secondary)]">
                  {mobilePane === 'player' ? playlistName : mobilePane === 'lyrics' ? '歌词' : '播放队列'}
                </p>
                <p className="mt-0.5 truncate text-[10px] tnum text-[var(--ink-muted)]">
                  {mobilePane === 'player' ? `${currentIndex + 1} / ${tracks.length}` : mobilePane === 'lyrics' ? currentPresentation.title : `${tracks.length} 首`}
                </p>
              </div>
              <button
                type="button"
                data-dismiss-music-player
                onClick={dismissPlayer}
                className="music-control-button music-icon-button grid h-11 w-11 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label="停止播放并关闭播放器"
              >
                <X className="h-5 w-5" strokeWidth={1.7} />
              </button>
            </header>

            {mobilePane === 'player' ? (
            <div className="relative z-10 mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-6">
              <div
                data-now-playing-artwork
                className={cn(
                  'flex justify-center',
                  currentCover ? 'min-h-0 flex-1 items-center py-4' : 'items-start pb-6 pt-5',
                )}
              >
                <MusicArtwork
                  track={currentTrack}
                  size="hero"
                  className={cn(
                    currentCover
                      ? 'w-[min(calc(100vw-3rem),40dvh,23rem)]'
                      : 'w-[min(42vw,10rem)]',
                  )}
                  sizes="(max-width: 768px) calc(100vw - 3rem), 23rem"
                  showFallbackLabel={!currentCover}
                />
              </div>

              <div data-now-playing-track-info className="min-w-0 text-left">
                <h2 className="truncate text-[1.35rem] font-bold leading-tight tracking-[-0.025em] text-[var(--ink-primary)]" title={currentPresentation.title}>{currentPresentation.title}</h2>
                {artistLabel && <p className="mt-1 truncate text-[15px] font-medium text-[var(--ink-secondary)]" title={artistLabel}>{artistLabel}</p>}
                {activeLine && <p className="mt-2 line-clamp-1 text-xs text-[var(--ink-muted)]">{activeLine}</p>}
              </div>

              {playbackError && (
                <div role="alert" className="mt-4 flex items-center gap-2.5 rounded-[var(--music-radius-detail)] bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 py-1.5 text-xs text-[var(--ink-primary)]">
                  <AlertCircle className="h-4 w-4 shrink-0 text-[var(--signal-danger)]" />
                  <span className="min-w-0 flex-1">{playbackError}</span>
                  <button type="button" onClick={() => void retryPlayback()} className="music-control-button music-pill-button min-h-11 shrink-0 bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-3 font-semibold text-[var(--signal-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">重试</button>
                </div>
              )}

              <div className="music-mobile-player-seek mt-5">
                <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="md" />
                <div className="mt-1 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
                  <span>{formatMusicClock(progress)}</span>
                  <span>{formatMusicClock(duration)}</span>
                </div>
              </div>

              <div data-now-playing-transport className="music-mobile-player-transport mt-3 grid grid-cols-3 items-center justify-items-center px-7">
                <button type="button" onClick={previousTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
                  <SkipBack className="h-8 w-8 fill-current" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={playbackError ? () => void retryPlayback() : togglePlayback}
                  className="music-control-button music-transport-button music-transport-button--primary grid h-16 w-16 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                  aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}
                >
                  {isBuffering ? <RefreshCw className="h-9 w-9 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-10 w-10 fill-current" strokeWidth={1.45} /> : <Play className="h-10 w-10 translate-x-0.5 fill-current" strokeWidth={1.45} />}
                </button>
                <button type="button" onClick={nextTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                  <SkipForward className="h-8 w-8 fill-current" strokeWidth={1.5} />
                </button>
              </div>

              <label data-now-playing-volume className="music-mobile-player-volume mt-3 flex h-11 items-center gap-3 text-[var(--ink-muted)]">
                <Volume2 className="h-4 w-4 shrink-0" />
                <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="music-volume-range h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-[var(--ink-primary)]" aria-label="音量" />
              </label>

              <div data-now-playing-tools className="music-mobile-player-tools mt-auto grid grid-cols-3 border-t border-[var(--music-stroke)] pt-2">
                <button
                  type="button"
                  onClick={() => setShuffle((value) => !value)}
                  className={cn('music-control-button music-icon-button mx-auto grid h-12 w-12 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', shuffle ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]')}
                  data-selected={shuffle ? 'true' : 'false'}
                  aria-label="随机播放"
                  aria-pressed={shuffle}
                >
                  <Shuffle className="h-[22px] w-[22px]" strokeWidth={1.75} />
                  <span className="sr-only">随机播放</span>
                </button>
                <button type="button" onClick={() => setMobilePane('lyrics')} className="music-control-button music-icon-button mx-auto grid h-12 w-12 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="歌词">
                  <Music2 className="h-[22px] w-[22px]" strokeWidth={1.75} />
                  <span className="sr-only">歌词</span>
                </button>
                <button type="button" onClick={() => setMobilePane('queue')} className="music-control-button music-icon-button mx-auto grid h-12 w-12 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="播放队列">
                  <ListMusic className="h-[22px] w-[22px]" strokeWidth={1.75} />
                  <span className="sr-only">播放队列</span>
                </button>
              </div>
            </div>
            ) : mobilePane === 'lyrics' ? (
              <div data-mobile-lyrics-pane className="relative z-10 mx-auto flex min-h-0 w-full max-w-[26rem] flex-1 flex-col px-6 pt-4">
                <h2 ref={mobilePaneHeadingRef} tabIndex={-1} className="sr-only">歌词</h2>
                <div className="flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-4">
                  <MusicArtwork track={currentTrack} className="h-14 w-14" sizes="56px" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-[var(--ink-primary)]">{currentPresentation.title}</h2>
                    <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{compactArtistLabel}</p>
                  </div>
                </div>
                <div ref={mobileLyricsBoxRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto py-6 pr-1">
                  {lyrics.length === 0 ? (
                    <div className="flex min-h-[16rem] flex-col items-center justify-center text-center text-[var(--ink-muted)]">
                      <Music2 className="h-7 w-7" aria-hidden="true" />
                      <p className="mt-4 text-sm font-semibold text-[var(--ink-secondary)]">这首歌暂时没有歌词</p>
                      <p className="mt-1 text-xs">旋律仍会继续播放。</p>
                    </div>
                  ) : lyrics.map((line, index) => (
                    <p
                      key={`${line.time ?? 'plain'}-mobile-${index}`}
                      ref={index === activeLyricIndex ? mobileActiveLyricRef : undefined}
                      className={cn(
                        'text-[1.15rem] font-semibold leading-8 transition-[color,opacity,transform] duration-200 motion-reduce:translate-x-0 motion-reduce:transition-none',
                        index === activeLyricIndex
                          ? 'translate-x-1 text-[var(--ink-primary)]'
                          : 'text-[var(--ink-muted)] opacity-55',
                      )}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
                {mobilePaneTransport}
              </div>
            ) : (
              <div data-mobile-queue-pane className="relative z-10 mx-auto flex min-h-0 w-full max-w-[30rem] flex-1 flex-col px-5 pt-4">
                <h2 ref={mobilePaneHeadingRef} tabIndex={-1} className="sr-only">播放队列</h2>
                <div className="flex items-end justify-between gap-3 pb-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--ink-muted)]">接下来播放</p>
                    <h2 className="mt-1 text-xl font-black text-[var(--ink-primary)]">{playlistName}</h2>
                  </div>
                  <span className="text-xs tnum text-[var(--ink-muted)]">{tracks.length} 首</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-[color-mix(in_oklch,var(--ink-primary)_9%,transparent)]">
                  {tracks.map((track, index) => {
                    const active = hasPlaybackSession && currentIndex === index;
                    const presentation = resolveMusicTrackPresentation(track);
                    const queueArtist = presentation.artist || meaningfulMusicText(track.album) || playlistName;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => {
                          if (!active) {
                            value.playIndex(index);
                          } else if (playbackError) {
                            void retryPlayback();
                          } else {
                            void togglePlayback();
                          }
                        }}
                        aria-label={active
                          ? playbackError
                            ? `重新尝试 ${presentation.title}`
                            : isBuffering
                              ? `取消载入 ${presentation.title}`
                              : isPlaying
                                ? `暂停 ${presentation.title}`
                                : `继续播放 ${presentation.title}`
                          : `播放 ${presentation.title}`}
                        aria-current={active ? 'true' : undefined}
                        className="grid min-h-[72px] w-full grid-cols-[1.25rem_48px_minmax(0,1fr)_44px] items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                      >
                        <span className="text-center text-xs tnum text-[var(--ink-muted)]">{active && isPlaying ? <NowPlayingGlyph /> : index + 1}</span>
                        <MusicArtwork track={track} className="h-12 w-12" sizes="48px" />
                        <span className="min-w-0">
                          <span className={cn('block truncate text-sm font-bold', active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>{presentation.title}</span>
                          <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{queueArtist}</span>
                        </span>
                        <span className="grid h-11 w-11 place-items-center text-[var(--ink-muted)]" aria-hidden="true">
                          {active && isBuffering ? <RefreshCw className="h-4 w-4 animate-spin" /> : active && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {mobilePaneTransport}
              </div>
            )}
          </section>
        </div>

        <div
          ref={desktopDialogRef}
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐大厅播放器"
          tabIndex={-1}
          className="music-desktop-player-dialog fixed inset-0 z-[65] hidden overflow-y-auto bg-[color-mix(in_oklch,var(--bg-void)_92%,transparent)] p-4 text-[var(--ink-primary)] [backdrop-filter:blur(28px)_saturate(140%)] min-[769px]:grid min-[769px]:place-items-center min-[769px]:overflow-hidden"
        >
          <div className="music-desktop-player-layout mx-auto grid min-h-[calc(100dvh-2rem)] w-full max-w-6xl grid-cols-1 gap-4 min-[769px]:h-[calc(100dvh-2rem)] min-[769px]:max-h-[48rem] min-[769px]:min-h-0 min-[769px]:grid-cols-[minmax(0,1fr)_minmax(280px,0.78fr)]">
            <section className="music-desktop-player-main surface-luminous grid min-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-visible rounded-[var(--music-radius-panel)] p-5 min-[769px]:min-h-0 min-[769px]:overflow-hidden min-[769px]:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p data-eyebrow className="text-xs font-bold tracking-[0.08em] text-[var(--aurora-1)]">正在播放</p>
                  <h2 className="mt-1 text-xl font-black tracking-normal sm:text-2xl">{playlistName}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/music"
                    onClick={closeExpandedPlayer}
                    className="music-control-button music-pill-button inline-flex h-11 w-11 items-center justify-center gap-2 bg-[var(--music-control-fill)] text-sm font-semibold text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] sm:w-auto sm:px-4"
                    aria-label="前往歌单页"
                  >
                    <ListMusic className="h-4 w-4" />
                    <span className="hidden sm:inline">歌单页</span>
                  </Link>
                  <button
                    type="button"
                    onClick={closeExpandedPlayer}
                    className="music-control-button music-icon-button music-icon-button--tinted flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                    aria-label="收起播放器"
                  >
                    <ChevronDown className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    data-dismiss-music-player
                    onClick={dismissPlayer}
                    className="music-control-button music-icon-button flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                    aria-label="停止播放并关闭播放器"
                  >
                    <X className="h-5 w-5" strokeWidth={1.7} />
                  </button>
                </div>
              </div>

              <div className="music-desktop-player-artwork-frame grid min-h-0 place-items-center overflow-hidden py-4">
                <MusicArtwork
                  track={currentTrack}
                  size="hero"
                  className="music-desktop-player-artwork"
                  sizes="(min-width: 1024px) 24rem, 45vw"
                  showFallbackLabel={!currentCover}
                />
              </div>

              <div className={cn('space-y-2.5', !currentCover && 'mt-1')}>
                <div>
                  <p className="text-sm font-bold text-[var(--ink-muted)]">{playlistName}</p>
                  <h3 className="mt-1 text-3xl font-black tracking-normal sm:text-h1">{currentPresentation.title}</h3>
                  {artistLabel && <p className="mt-2 text-base text-[var(--ink-secondary)]">{artistLabel}</p>}
                </div>
                <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="lg" />
                <div className="flex items-center justify-between text-xs tnum text-[var(--ink-muted)]">
                  <span>{formatMusicClock(progress)}</span>
                  <span>{formatMusicClock(duration || currentTrack.durationSeconds || 0)}</span>
                </div>
                <div data-desktop-player-transport className="flex items-center justify-center gap-8 py-1">
                  <button type="button" onClick={previousTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
                    <SkipBack className="h-8 w-8 fill-current" strokeWidth={1.5} />
                  </button>
                  <button type="button" onClick={playbackError ? () => void retryPlayback() : togglePlayback} className="music-control-button music-transport-button music-transport-button--primary grid h-16 w-16 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}>
                    {isBuffering ? <RefreshCw className="h-9 w-9 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-10 w-10 fill-current" strokeWidth={1.45} /> : <Play className="h-10 w-10 translate-x-0.5 fill-current" strokeWidth={1.45} />}
                  </button>
                  <button type="button" onClick={nextTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                    <SkipForward className="h-8 w-8 fill-current" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--music-stroke)] pt-2">
                  <button type="button" onClick={() => setShuffle((value) => !value)} className={cn('music-control-button music-icon-button grid h-11 w-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', shuffle ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]')} data-selected={shuffle ? 'true' : 'false'} aria-label="随机播放" aria-pressed={shuffle}>
                    <Shuffle className="h-5 w-5" strokeWidth={1.8} />
                    <span className="sr-only">随机播放</span>
                  </button>
                  <label className="flex h-11 items-center gap-2 px-2 text-[var(--ink-muted)]">
                    <Volume2 className="h-4 w-4" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="w-28 accent-[var(--ink-primary)]"
                      aria-label="音量"
                    />
                  </label>
                </div>
                {playbackError && (
                  <div role="alert" className="flex items-center gap-3 rounded-[var(--music-radius-detail)] bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 py-1.5 text-sm text-[var(--ink-primary)]">
                    <AlertCircle className="h-5 w-5 shrink-0 text-[var(--signal-danger)]" />
                    <span className="min-w-0 flex-1">{playbackError}</span>
                    <button type="button" onClick={() => void retryPlayback()} className="music-control-button music-pill-button inline-flex min-h-11 shrink-0 items-center gap-1.5 bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-3 font-semibold text-[var(--signal-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">
                      <RefreshCw className="h-4 w-4" />
                      重新尝试
                    </button>
                  </div>
                )}
              </div>
            </section>

            <aside className="surface-leaf flex min-h-0 flex-col overflow-hidden rounded-[var(--music-radius-panel)] p-5">
              <div className="flex items-center justify-between gap-4 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-4">
                <div>
                  <p data-eyebrow className="text-xs font-bold tracking-[0.08em] text-[var(--aurora-1)]">播放详情</p>
                  <h3 className="mt-1 text-lg font-black">{desktopPane === 'lyrics' ? '歌词' : '队列'}</h3>
                </div>
                <div role="tablist" aria-label="播放详情" className="grid grid-cols-2 gap-1 rounded-[var(--music-radius-control)] bg-[var(--music-control-fill)] p-1">
                  <button
                    ref={desktopLyricsTabRef}
                    id="desktop-lyrics-tab"
                    type="button"
                    role="tab"
                    aria-selected={desktopPane === 'lyrics'}
                    aria-controls="desktop-lyrics-panel"
                    tabIndex={desktopPane === 'lyrics' ? 0 : -1}
                    onClick={() => setDesktopPane('lyrics')}
                    onKeyDown={handleDesktopPaneKeyDown}
                    className={cn('music-control-button inline-flex min-h-11 items-center gap-2 rounded-[calc(var(--music-radius-control)-0.2rem)] px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', desktopPane === 'lyrics' ? 'bg-[var(--music-control-fill-hover)] text-[var(--ink-primary)]' : 'text-[var(--ink-muted)]')}
                  >
                    <Music2 className="h-4 w-4" />
                    歌词
                  </button>
                  <button
                    ref={desktopQueueTabRef}
                    id="desktop-queue-tab"
                    type="button"
                    role="tab"
                    aria-selected={desktopPane === 'queue'}
                    aria-controls="desktop-queue-panel"
                    tabIndex={desktopPane === 'queue' ? 0 : -1}
                    onClick={() => setDesktopPane('queue')}
                    onKeyDown={handleDesktopPaneKeyDown}
                    className={cn('music-control-button inline-flex min-h-11 items-center gap-2 rounded-[calc(var(--music-radius-control)-0.2rem)] px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', desktopPane === 'queue' ? 'bg-[var(--music-control-fill-hover)] text-[var(--ink-primary)]' : 'text-[var(--ink-muted)]')}
                  >
                    <ListMusic className="h-4 w-4" />
                    队列
                  </button>
                </div>
              </div>

              {desktopPane === 'lyrics' ? (
                <section id="desktop-lyrics-panel" role="tabpanel" aria-labelledby="desktop-lyrics-tab" className="min-h-0 flex-1">
                  <div ref={lyricsBoxRef} className="h-full space-y-4 overflow-y-auto py-5 pr-1">
                    {lyrics.length === 0 ? (
                      <div className="flex min-h-[18rem] flex-col items-center justify-center text-center text-[var(--ink-muted)]">
                        <Music2 className="h-7 w-7" aria-hidden="true" />
                        <p className="mt-4 text-sm font-semibold text-[var(--ink-secondary)]">这首歌暂时没有歌词，先让旋律继续。</p>
                      </div>
                    ) : lyrics.map((line, index) => (
                      <p
                        key={`${line.time ?? 'plain'}-${index}`}
                        ref={index === activeLyricIndex ? activeLyricRef : undefined}
                        className={cn(
                          'px-1 text-base font-semibold leading-8 transition-[color,opacity,transform] duration-200 motion-reduce:translate-x-0 motion-reduce:transition-none',
                          index === activeLyricIndex
                            ? 'translate-x-1 text-[var(--ink-primary)]'
                            : 'text-[var(--ink-muted)] opacity-55',
                        )}
                      >
                        {line.text}
                      </p>
                    ))}
                  </div>
                </section>
              ) : (
                <section id="desktop-queue-panel" role="tabpanel" aria-labelledby="desktop-queue-tab" className="min-h-0 flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between py-4 text-xs text-[var(--ink-muted)]">
                    <span>{playlistName}</span>
                    <span className="tnum">{tracks.length} 首</span>
                  </div>
                  <div className="border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                    {tracks.map((track, index) => {
                      const active = hasPlaybackSession && currentIndex === index;
                      const presentation = resolveMusicTrackPresentation(track);
                      return (
                        <button
                          key={track.id}
                          type="button"
                          onClick={() => {
                            if (!active) {
                              value.playIndex(index);
                            } else if (playbackError) {
                              void retryPlayback();
                            } else {
                              void togglePlayback();
                            }
                          }}
                          aria-label={active
                            ? playbackError
                              ? `重新尝试 ${presentation.title}`
                              : isBuffering
                                ? `取消载入 ${presentation.title}`
                                : isPlaying
                                  ? `暂停 ${presentation.title}`
                                  : `继续播放 ${presentation.title}`
                            : `播放 ${presentation.title}`}
                          aria-current={active ? 'true' : undefined}
                          className="grid min-h-[72px] w-full grid-cols-[2rem_48px_minmax(0,1fr)_44px] items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] py-3 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                        >
                          <span className="text-xs tnum text-[var(--ink-muted)]">{String(index + 1).padStart(2, '0')}</span>
                          <MusicArtwork track={track} className="h-12 w-12" sizes="48px" />
                          <span className="min-w-0">
                            <span className={cn('block truncate text-sm font-bold', active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>{presentation.title}</span>
                            <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{presentation.artist || meaningfulMusicText(track.album) || playlistName}</span>
                          </span>
                          <span className="grid h-11 w-11 place-items-center text-[var(--ink-muted)]" aria-hidden="true">
                            {active && isBuffering ? <RefreshCw className="h-4 w-4 animate-spin" /> : active && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </aside>
          </div>

        </div>
        </>
      )}
    </>
  );
}
