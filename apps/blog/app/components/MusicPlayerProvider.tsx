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
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useIsMobile } from '@aetherblog/hooks';
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
  Trash2,
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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const FLOATING_ORB_LONG_PRESS_MS = 330;
const FLOATING_ORB_SIZE = 60;
const FLOATING_ORB_EDGE_GUTTER = 18;
const FLOATING_REMOVE_HIT_HEIGHT = 132;
const FLOATING_REMOVE_HIT_HALF_WIDTH = 72;

interface FloatingOrbDragState {
  x: number;
  y: number;
  overRemove: boolean;
}

interface FloatingOrbPointerSession {
  pointerId: number;
  dragging: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

// ============================================================
// 音乐皮肤解析 —— 后台默认 + 前台访客本地覆盖(localStorage)
// 预设走纯 CSS([data-music-skin="<id>"]);自定义注入作用域 <style>。
// ============================================================
const MUSIC_SKIN_STORAGE_KEY = 'aetherblog-music-skin';

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
    /* 忽略 */
  }
  return null;
}

function writeStoredMusicSkin(value: StoredMusicSkin) {
  try {
    localStorage.setItem(MUSIC_SKIN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* 忽略 */
  }
}

function clearStoredMusicSkin() {
  try {
    localStorage.removeItem(MUSIC_SKIN_STORAGE_KEY);
  } catch {
    /* 忽略 */
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
  return sanitizeImageUrl(track?.coverUrl, fallback);
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
  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`${formatMusicClock(progress)} / ${formatMusicClock(duration)}`}
      onClick={(event) => seekFromClientX(event.clientX)}
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
        'group/music-seek flex min-h-6 w-full cursor-pointer items-center py-2 focus-visible:outline-none',
        className
      )}
      style={{ ['--music-progress' as string]: `${clampedPercent}%` }}
    >
      <span
        className={cn(
          'relative block w-full rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--ink-primary)_5%,transparent)]',
          heightClass
        )}
      >
        <span className="absolute inset-0 rounded-full bg-[linear-gradient(90deg,color-mix(in_oklch,var(--ink-primary)_6%,transparent),color-mix(in_oklch,var(--ink-primary)_13%,transparent))]" />
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--aurora-1),var(--aurora-3))] shadow-[0_0_18px_-5px_color-mix(in_oklch,var(--aurora-1)_90%,transparent)] transition-[width] duration-200 ease-out"
          style={{ width: `${clampedPercent}%` }}
        />
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color-mix(in_oklch,white_52%,transparent)] bg-[color-mix(in_oklch,white_72%,var(--aurora-1))] opacity-0 shadow-[0_6px_18px_-8px_color-mix(in_oklch,var(--aurora-1)_95%,transparent)] transition-[opacity,transform] duration-200 group-hover/music-seek:opacity-100 group-focus-visible/music-seek:opacity-100 group-focus-visible/music-seek:ring-2 group-focus-visible/music-seek:ring-[var(--aurora-1)]',
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
  hasPlaybackSession: boolean;
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
  dismissFloatingPlayer: () => void;
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
  const playingRef = useRef(false);
  const currentIndexRef = useRef(0);
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
  const [hasPlaybackSession, setHasPlaybackSession] = useState(false);

  const currentTrack = tracks[currentIndex];
  const audioSrc = resolveMusicAudioSrc(currentTrack);
  const canRender = Boolean(player?.enabled && tracks.length > 0);
  const carouselEnabled = Boolean(
    player?.carouselEnabled ||
      player?.playlist?.carouselEnabled ||
      player?.playbackMode === 'CAROUSEL'
  );
  const shouldRotateCarousel = carouselEnabled && (!isPlaying || player?.playbackMode === 'CAROUSEL');
  const carouselIntervalMs = Math.max(3, player?.carouselIntervalSeconds || 8) * 1000;
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
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    setShuffle(Boolean(
      player?.randomEnabled ||
        player?.playlist?.randomEnabled ||
        player?.playbackMode === 'SHUFFLE'
    ));
  }, [player?.randomEnabled, player?.playlist?.randomEnabled, player?.playbackMode]);

  useEffect(() => {
    if (tracks.length > 0 && currentIndex >= tracks.length) {
      setCurrentIndex(0);
    }
    if (!canRender) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      setIsPlaying(false);
      setProgress(0);
      setDuration(0);
      setHasPlaybackSession(false);
    }
  }, [canRender, currentIndex, tracks.length]);

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
      // 从 ref 读实时下标,避免 onEnded 闭包里拿到旧的 currentIndex(连播会卡在同一首)
      const index = currentIndexRef.current;
      const shouldWrap = manual || player?.playbackMode === 'LOOP' || player?.playbackMode === 'CAROUSEL';
      if (!manual && !shuffle && index >= tracks.length - 1 && !shouldWrap) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        playingRef.current = false;
        setProgress(0);
        setIsPlaying(false);
        return;
      }
      // 先把意图写进 ref,src 切换 effect 立即据此自动续播,不依赖 effect 执行顺序
      playingRef.current = true;
      setHasPlaybackSession(true);
      setCurrentIndex(shuffle ? pickRandomIndex(tracks.length, index) : (index + 1) % tracks.length);
      setIsPlaying(true);
    },
    [player?.playbackMode, shuffle, tracks.length]
  );

  const playIndex = useCallback(
    (index: number, options?: { expand?: boolean }) => {
      if (tracks.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
      playingRef.current = true;
      setHasPlaybackSession(true);
      setCurrentIndex(safeIndex);
      setIsPlaying(true);
      if (options?.expand) setExpanded(true);
      if (safeIndex === currentIndex) {
        audioRef.current?.play().catch(() => {
          playingRef.current = false;
          setIsPlaying(false);
        });
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
      setHasPlaybackSession(true);
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [audioSrc, isPlaying]);

  const previousTrack = useCallback(() => {
    if (tracks.length === 0) return;
    playingRef.current = true;
    setHasPlaybackSession(true);
    setCurrentIndex((index) => (index - 1 + tracks.length) % tracks.length);
    setIsPlaying(true);
  }, [tracks.length]);

  const nextTrack = useCallback(() => advanceTrack(true), [advanceTrack]);

  const dismissFloatingPlayer = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    playingRef.current = false;
    setIsPlaying(false);
    setExpanded(false);
    setHasPlaybackSession(false);
  }, []);

  useEffect(() => {
    if (!canRender || !shouldRotateCarousel || tracks.length <= 1) return;

    const timer = window.setInterval(() => {
      setCurrentIndex((index) =>
        shuffle ? pickRandomIndex(tracks.length, index) : (index + 1) % tracks.length
      );
    }, carouselIntervalMs);

    return () => window.clearInterval(timer);
  }, [canRender, carouselIntervalMs, shouldRotateCarousel, shuffle, tracks.length]);

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
      // 不写死 type:封面可能是 jpg/webp,留空让浏览器按响应头判断
      artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.play().then(() => {
        setHasPlaybackSession(true);
        setIsPlaying(true);
      }).catch(() => setIsPlaying(false));
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler('previoustrack', previousTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [currentTrack, nextTrack, player?.playlist?.name, previousTrack]);

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
    hasPlaybackSession,
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
    dismissFloatingPlayer,
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
    dismissFloatingPlayer,
    duration,
    expanded,
    hasPlaybackSession,
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
    resolvedSkin,
    skinOverride,
    selectPresetSkin,
    selectCustomSkin,
    resetSkin,
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
        'relative shrink-0 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[radial-gradient(circle_at_50%_50%,color-mix(in_oklch,black_82%,var(--aurora-1))_0_18%,color-mix(in_oklch,black_90%,var(--aurora-1))_19%_28%,color-mix(in_oklch,black_88%,var(--aurora-1))_29%_100%)] shadow-[0_20px_60px_-34px_color-mix(in_oklch,black_55%,transparent)]',
        sizeClass,
        playing && 'music-vinyl-spin'
      )}
    >
      <div className="absolute inset-[12%] rounded-full border border-[color-mix(in_oklch,white_10%,transparent)] bg-[color-mix(in_oklch,black_45%,transparent)]" />
      <div className="absolute inset-[25%] overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[var(--bg-leaf)]">
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
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))] text-[var(--ink-secondary)]">
            <Disc3 className={cn(size === 'lg' ? 'h-14 w-14' : 'h-6 w-6')} />
          </div>
        )}
      </div>
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,white_82%,var(--aurora-1))]" />
    </div>
  );
}

export function LiquidMusicOrb({
  playing,
  size = 'md',
  className,
}: {
  playing: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass = size === 'lg' ? 'h-[3.75rem] w-[3.75rem]' : size === 'sm' ? 'h-11 w-11' : 'h-14 w-14';

  return (
    <span className={cn('music-liquid-orb', sizeClass, className)} data-playing={playing ? 'true' : 'false'} aria-hidden="true">
      <span className="music-liquid-ring" />
      <span className="music-liquid-core">
        <span className="music-liquid-flow" />
        {playing ? (
          <>
            <span className="music-liquid-lobe" />
            <span className="music-liquid-lobe" />
            <span className="music-liquid-lobe" />
            <span className="music-liquid-lobe" />
          </>
        ) : (
          <Play className="music-liquid-play-icon relative z-10 h-5 w-5 translate-x-px" />
        )}
      </span>
    </span>
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
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
    setVolume,
    dismissFloatingPlayer,
  } = value;

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLParagraphElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [orbDrag, setOrbDrag] = useState<FloatingOrbDragState | null>(null);
  const orbLongPressTimerRef = useRef<number | null>(null);
  const orbSuppressClickTimerRef = useRef<number | null>(null);
  const orbPointerSessionRef = useRef<FloatingOrbPointerSession | null>(null);
  const suppressOrbClickRef = useRef(false);

  const clearOrbLongPress = useCallback(() => {
    if (orbLongPressTimerRef.current != null) {
      window.clearTimeout(orbLongPressTimerRef.current);
      orbLongPressTimerRef.current = null;
    }
  }, []);

  const suppressNextOrbClick = useCallback(() => {
    if (orbSuppressClickTimerRef.current != null) {
      window.clearTimeout(orbSuppressClickTimerRef.current);
    }
    suppressOrbClickRef.current = true;
    orbSuppressClickTimerRef.current = window.setTimeout(() => {
      suppressOrbClickRef.current = false;
      orbSuppressClickTimerRef.current = null;
    }, 420);
  }, []);

  const resolveOrbDragState = useCallback((clientX: number, clientY: number): FloatingOrbDragState => {
    const viewportWidth = Math.max(window.innerWidth || 0, FLOATING_ORB_SIZE * 2);
    const viewportHeight = Math.max(window.innerHeight || 0, FLOATING_ORB_SIZE * 2);
    const radius = FLOATING_ORB_SIZE / 2;
    const minX = radius + FLOATING_ORB_EDGE_GUTTER;
    const maxX = viewportWidth - radius - FLOATING_ORB_EDGE_GUTTER;
    const minY = radius + FLOATING_ORB_EDGE_GUTTER;
    const maxY = viewportHeight - radius - FLOATING_ORB_EDGE_GUTTER;
    const x = Math.min(maxX, Math.max(minX, clientX));
    const y = Math.min(maxY, Math.max(minY, clientY));
    const overRemove =
      clientY >= viewportHeight - FLOATING_REMOVE_HIT_HEIGHT &&
      Math.abs(clientX - viewportWidth / 2) <= FLOATING_REMOVE_HIT_HALF_WIDTH;
    return { x, y, overRemove };
  }, []);

  const resetOrbDrag = useCallback(() => {
    clearOrbLongPress();
    orbPointerSessionRef.current = null;
    setOrbDrag(null);
  }, [clearOrbLongPress]);

  useEffect(() => {
    return () => {
      clearOrbLongPress();
      if (orbSuppressClickTimerRef.current != null) {
        window.clearTimeout(orbSuppressClickTimerRef.current);
      }
    };
  }, [clearOrbLongPress]);

  useEffect(() => {
    if (!expanded && isMobile) return;
    resetOrbDrag();
  }, [expanded, isMobile, resetOrbDrag]);

  const handleFloatingOrbPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobile || expanded || !event.isPrimary || event.button !== 0) return;
    const pointerId = event.pointerId;
    const button = event.currentTarget;
    clearOrbLongPress();
    orbPointerSessionRef.current = {
      pointerId,
      dragging: false,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    try {
      button.setPointerCapture(pointerId);
    } catch {
      /* 指针捕获在较旧的移动浏览器上是最好的努力*/
    }
    orbLongPressTimerRef.current = window.setTimeout(() => {
      const session = orbPointerSessionRef.current;
      if (!session || session.pointerId !== pointerId) return;
      session.dragging = true;
      suppressNextOrbClick();
      setExpanded(false);
      setOrbDrag(resolveOrbDragState(session.lastX, session.lastY));
      navigator.vibrate?.([8]);
    }, FLOATING_ORB_LONG_PRESS_MS);
  }, [clearOrbLongPress, expanded, isMobile, resolveOrbDragState, setExpanded, suppressNextOrbClick]);

  const handleFloatingOrbPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = orbPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    if (!session.dragging) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance > 10) {
        clearOrbLongPress();
      }
      return;
    }
    event.preventDefault();
    setOrbDrag(resolveOrbDragState(event.clientX, event.clientY));
  }, [clearOrbLongPress, resolveOrbDragState]);

  const handleFloatingOrbPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = orbPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const wasDragging = session.dragging;
    const releaseState = resolveOrbDragState(event.clientX, event.clientY);
    clearOrbLongPress();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* 忽略 */
    }
    orbPointerSessionRef.current = null;
    setOrbDrag(null);
    if (!wasDragging) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextOrbClick();
    if (releaseState.overRemove) dismissFloatingPlayer();
  }, [clearOrbLongPress, dismissFloatingPlayer, resolveOrbDragState, suppressNextOrbClick]);

  const handleFloatingOrbPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = orbPointerSessionRef.current;
    if (session?.pointerId === event.pointerId && session.dragging) {
      suppressNextOrbClick();
    }
    resetOrbDrag();
  }, [resetOrbDrag, suppressNextOrbClick]);

  const handleFloatingOrbClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressOrbClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressOrbClickRef.current = false;
      return;
    }
    setExpanded(true);
  }, [setExpanded]);

  const floatingOrbStyle = useMemo<CSSProperties | undefined>(() => (
    orbDrag
      ? {
          left: `${orbDrag.x}px`,
          top: `${orbDrag.y}px`,
          bottom: 'auto',
          transform: 'translate3d(-50%, -50%, 0)',
        }
      : undefined
  ), [orbDrag]);

  // 沉浸层:Esc 关闭 + 打开时锁滚动 + 焦点落到关闭键(对话框语义)
  useEffect(() => {
    if (!expanded || isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [expanded, isMobile, setExpanded]);

  // 歌词自动滚动:当前行始终居中可见(reduced-motion 由浏览器接管)
  useEffect(() => {
    if (!expanded) return;
    const line = activeLyricRef.current;
    const box = lyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [expanded, activeLyricIndex]);

  const routeBlocksFloatingPlayer =
    pathname.startsWith('/agent/workspace') ||
    pathname.startsWith('/team-chat');

  if (
    !canRender ||
    !currentTrack ||
    (!expanded && routeBlocksFloatingPlayer) ||
    (!hasPlaybackSession && !isPlaying && !expanded)
  ) return null;
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : '';
  const playlistName = player?.playlist?.name || '音乐大厅';

  return (
    <>
      {/* 沉浸层打开时隐藏 dock —— dock(z-70)原本盖在沉浸层(z-65)之上,移动端尤其会压住沉浸层控件 */}
      {!expanded && (
      <>
	      <div
	        data-music-skin={skin}
	        className={cn(
	          'fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-[70] md:hidden',
	          orbDrag && 'music-floating-orb-shell-dragging'
	        )}
	        data-dragging={orbDrag ? 'true' : 'false'}
	        style={floatingOrbStyle}
	      >
	        <button
	          type="button"
	          onClick={handleFloatingOrbClick}
	          onPointerDown={handleFloatingOrbPointerDown}
	          onPointerMove={handleFloatingOrbPointerMove}
	          onPointerUp={handleFloatingOrbPointerUp}
	          onPointerCancel={handleFloatingOrbPointerCancel}
	          onLostPointerCapture={handleFloatingOrbPointerCancel}
	          onContextMenu={(event) => event.preventDefault()}
	          className="music-floating-orb-button relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
	          aria-label="打开音乐播放器，长按拖到底部可移除"
	          data-dragging={orbDrag ? 'true' : 'false'}
	          data-removing={orbDrag?.overRemove ? 'true' : 'false'}
	        >
	          <LiquidMusicOrb playing={isPlaying} size="lg" />
	        </button>
	      </div>

	      {orbDrag && (
	        <div data-music-skin={skin} className="pointer-events-none fixed inset-x-0 bottom-[max(1.15rem,env(safe-area-inset-bottom))] z-[69] flex justify-center md:hidden" aria-hidden="true">
	          <div className="music-floating-remove-zone" data-active={orbDrag.overRemove ? 'true' : 'false'}>
	            <Trash2 className="music-floating-remove-icon" />
	          </div>
	        </div>
	      )}

      <div data-music-skin={skin} className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] hidden px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] md:block">
        <div className="surface-raised pointer-events-auto mx-auto w-full max-w-5xl overflow-hidden rounded-[1.35rem] text-[var(--ink-primary)]">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-3">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="music-control-button group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              aria-label="打开音乐大厅播放器"
            >
              <CoverDisc track={currentTrack} playing={isPlaying} size="sm" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--aurora-1)_75%,transparent)]">
                <Maximize2 className="h-3 w-3" />
              </span>
            </button>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-5 items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--aurora-1)]">
                  {playlistName}
                </span>
                <span className="truncate text-[11px] text-[var(--ink-muted)]">
                  {currentIndex + 1}/{tracks.length}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-bold text-[var(--ink-primary)] sm:text-base">{currentTrack.title}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--ink-secondary)]">
                {currentTrack.artist || '未知艺术家'}{activeLine ? ` · ${activeLine}` : ''}
              </p>
              <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="sm" className="mt-2" />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShuffle((value) => !value)}
                className={cn(
                  'music-control-button flex h-10 w-10 items-center justify-center rounded-full border',
                  shuffle
                    ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)]'
                    : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                )}
                aria-label="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button type="button" onClick={previousTrack} className="music-control-button flex h-10 w-10 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]" aria-label="上一首">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                className="music-control-button flex h-12 w-12 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_10px_30px_-12px_color-mix(in_oklch,var(--aurora-1)_80%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
              </button>
              <button type="button" onClick={nextTrack} className="music-control-button flex h-10 w-10 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]" aria-label="下一首">
                <SkipForward className="h-4 w-4" />
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
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐播放器"
          className="fixed inset-0 z-[70] md:hidden"
          onClick={() => setExpanded(false)}
        >
          <section
            className="music-mobile-player-sheet absolute inset-x-3 bottom-[max(0.85rem,env(safe-area-inset-bottom))] overflow-hidden rounded-[1.65rem] border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_92%,transparent)] text-[var(--ink-primary)] shadow-[0_26px_80px_-42px_color-mix(in_oklch,var(--aurora-1)_82%,transparent),0_18px_44px_-36px_color-mix(in_oklch,black_80%,transparent)] [backdrop-filter:blur(24px)_saturate(150%)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-7 max-w-[8.5rem] items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] px-3 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--aurora-1)]">
                  <span className="truncate">{playlistName}</span>
                </span>
                <span className="text-xs tnum text-[var(--ink-muted)]">{currentIndex + 1}/{tracks.length}</span>
              </div>
            </div>

            <div className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3 px-4 pt-3">
              <button
                type="button"
                onClick={togglePlayback}
                className="music-control-button relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
              >
                <CoverDisc track={currentTrack} playing={isPlaying} size="sm" />
                <span className="absolute inset-0 grid place-items-center rounded-full bg-[color-mix(in_oklch,black_28%,transparent)] text-[var(--bg-void)] opacity-0 transition-opacity duration-200 active:opacity-100">
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
                </span>
              </button>
              <div className="min-w-0">
                <h3 className="truncate text-base font-black tracking-normal text-[var(--ink-primary)]" title={currentTrack.title}>
                  {currentTrack.title}
                </h3>
                <p className="mt-0.5 truncate text-sm text-[var(--ink-muted)]" title={currentTrack.artist || currentTrack.album || currentTrack.title}>
                  {currentTrack.artist || '未知艺术家'}{activeLine ? ` · ${activeLine}` : ''}
                </p>
              </div>
            </div>

            <div className="px-4 pt-3">
              <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="sm" />
              <div className="flex items-center justify-between text-[11px] tnum text-[var(--ink-muted)]">
                <span>{formatMusicClock(progress)}</span>
                <span>{formatMusicClock(duration || currentTrack.durationSeconds || 0)}</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 px-4 py-4">
              <button
                type="button"
                onClick={() => setShuffle((value) => !value)}
                className={cn(
                  'music-control-button flex h-12 w-12 items-center justify-center rounded-full border',
                  shuffle
                    ? 'border-[color-mix(in_oklch,var(--aurora-1)_48%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)]'
                    : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)]'
                )}
                aria-label="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle className="h-5 w-5" />
              </button>
              <button type="button" onClick={previousTrack} className="music-control-button flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)]" aria-label="上一首">
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                className="music-control-button flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(180deg,var(--aurora-3),var(--aurora-1))] text-[var(--bg-void)] shadow-[0_18px_38px_-20px_color-mix(in_oklch,var(--aurora-1)_90%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
              >
                {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
              </button>
              <button type="button" onClick={nextTrack} className="music-control-button flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)]" aria-label="下一首">
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-3">
              <Link
                href="/music"
                onClick={() => setExpanded(false)}
                className="music-control-button inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-3 text-sm font-bold text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              >
                <Disc3 className="h-4 w-4" />
                音乐大厅
              </Link>
              <Link
                href="/music#playlist"
                onClick={() => setExpanded(false)}
                className="music-control-button inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 text-sm font-bold text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
              >
                <ListMusic className="h-4 w-4" />
                歌单页
              </Link>
            </div>
          </section>
        </div>

        <div
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐大厅播放器"
          className="fixed inset-0 z-[65] hidden overflow-y-auto bg-[color-mix(in_oklch,var(--bg-void)_92%,transparent)] px-4 py-[max(4.5rem,env(safe-area-inset-top))] text-[var(--ink-primary)] [backdrop-filter:blur(28px)_saturate(140%)] md:block"
        >
          <div className="mx-auto grid min-h-[calc(100dvh-8rem)] w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(340px,0.72fr)]">
            <section className="surface-luminous flex min-h-[560px] flex-col justify-between rounded-[2rem] p-5 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p data-eyebrow className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--aurora-1)]">Aether Music Hall</p>
                  <h2 className="mt-2 text-2xl font-black tracking-normal sm:text-4xl">音乐大厅</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/music"
                    onClick={() => setExpanded(false)}
                    className="inline-flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-sm font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] sm:w-auto sm:px-4"
                    aria-label="前往歌单页"
                  >
                    <ListMusic className="h-4 w-4" />
                    <span className="hidden sm:inline">歌单页</span>
                  </Link>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
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
                  <p className="text-sm font-bold text-[var(--ink-muted)]">{playlistName}</p>
                  <h3 className="mt-1 text-3xl font-black tracking-normal sm:text-h1">{currentTrack.title}</h3>
                  <p className="mt-2 text-base text-[var(--ink-secondary)]">{currentTrack.artist || '未知艺术家'} · {currentTrack.album || '未分专辑'}</p>
                </div>
                <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="lg" />
                <div className="flex items-center justify-between text-xs tnum text-[var(--ink-muted)]">
                  <span>{formatMusicClock(progress)}</span>
                  <span>{formatMusicClock(duration || currentTrack.durationSeconds || 0)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button type="button" onClick={() => setShuffle((value) => !value)} className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]', shuffle ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]' : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]')} aria-label="随机播放" aria-pressed={shuffle}>
                    <Shuffle className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={previousTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]" aria-label="上一首">
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={togglePlayback} className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_20px_44px_-20px_color-mix(in_oklch,var(--aurora-1)_85%,transparent)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]" aria-label={isPlaying ? '暂停音乐' : '播放音乐'}>
                    {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
                  </button>
                  <button type="button" onClick={nextTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]" aria-label="下一首">
                    <SkipForward className="h-5 w-5" />
                  </button>
                  {/* 音量条移动端隐藏 —— 手机用系统音量,避免控件换行挤压传输按钮 */}
                  <label className="hidden h-12 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-4 text-[var(--ink-secondary)] sm:flex">
                    <Volume2 className="h-4 w-4" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="w-24 accent-[var(--aurora-1)]"
                      aria-label="音量"
                    />
                  </label>
                </div>
              </div>
            </section>

            <aside className="grid gap-4 lg:grid-rows-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <section className="surface-leaf min-h-[300px] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p data-eyebrow className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Lyrics</p>
                    <h3 className="mt-1 text-lg font-black">歌词现场</h3>
                  </div>
                  <Music2 className="h-5 w-5 text-[var(--ink-muted)]" />
                </div>
                <div ref={lyricsBoxRef} className="mt-5 max-h-[360px] space-y-3 overflow-y-auto pr-1 scroll-smooth">
                  {lyrics.length === 0 ? (
                    <p className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-4 text-sm leading-6 text-[var(--ink-secondary)]">
                      当前歌曲还没有歌词。可以在后台音乐大厅的歌曲信息里维护歌词，前台会自动滚动高亮。
                    </p>
                  ) : lyrics.map((line, index) => (
                    <p
                      key={`${line.time ?? 'plain'}-${index}`}
                      ref={index === activeLyricIndex ? activeLyricRef : undefined}
                      className={cn(
                        'rounded-2xl px-4 py-2 text-sm leading-7 transition-all',
                        index === activeLyricIndex
                          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-lg font-black text-[var(--ink-primary)] shadow-[inset_3px_0_0_var(--aurora-1)]'
                          : 'text-[var(--ink-muted)]'
                      )}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </section>

              <section className="surface-leaf min-h-[300px] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p data-eyebrow className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Queue</p>
                    <h3 className="mt-1 text-lg font-black">播放队列</h3>
                  </div>
                  <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 py-1 text-xs text-[var(--ink-secondary)]">{tracks.length} 首</span>
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
                          ? 'border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]'
                          : 'border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
                      )}
                    >
                      <span className="text-xs tnum text-[var(--ink-muted)]">{String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[var(--ink-primary)]">{track.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">{track.artist || '未知艺术家'}</span>
                      </span>
                      {currentTrack.id === track.id && isPlaying ? (
                        <NowPlayingGlyph />
                      ) : (
                        <Play className="h-4 w-4 text-[var(--ink-muted)]" />
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
            className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_80%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] [backdrop-filter:blur(16px)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            aria-label="关闭音乐大厅播放器"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        </>
      )}
    </>
  );
}
