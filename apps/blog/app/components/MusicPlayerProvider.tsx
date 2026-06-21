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
  Music2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { transition } from '@aetherblog/ui';
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
  const heightClass = size === 'lg' ? 'h-2.5' : size === 'sm' ? 'h-1.5' : 'h-2';
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
        'block w-full cursor-pointer overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
        heightClass,
        className
      )}
    >
      <span className="block h-full rounded-full bg-[var(--aurora-1)] transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
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
  lyrics: LyricLine[];
  activeLyricIndex: number;
  canRender: boolean;
  /** 访客本次会话是否已开始过播放（dock 仅在此后浮出，不打扰未听歌的人） */
  engaged: boolean;
  /** 访客是否已 ✕ 关闭 dock（到下次播放前不再显示） */
  dismissed: boolean;
  /** 关闭 dock：暂停并隐藏，直到下次播放再回来 */
  closeDock: () => void;
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
  // dock 可见性门控：仅在访客「真正开始过播放」(engaged) 后浮出，未播放的访客不会被
  // 常驻 dock 打扰；✕ 关闭 (dismissed) 收起到下次播放。两者皆为内存态：刷新后
  // isPlaying 复位为 false → engaged 自然回到 false → 新页面默认不显示，符合预期。
  const [engaged, setEngaged] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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

  // 首次进入播放即「激活」dock；重新播放会撤销此前的 ✕ 关闭，让 dock 回来。
  useEffect(() => {
    if (isPlaying) {
      setEngaged(true);
      setDismissed(false);
    }
  }, [isPlaying]);

  // 关闭 dock：暂停播放并标记 dismissed → 隐藏，直到下次播放（isPlaying→true）再浮出。
  const closeDock = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setDismissed(true);
  }, []);

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
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [audioSrc, isPlaying]);

  const previousTrack = useCallback(() => {
    if (tracks.length === 0) return;
    playingRef.current = true;
    setCurrentIndex((index) => (index - 1 + tracks.length) % tracks.length);
    setIsPlaying(true);
  }, [tracks.length]);

  const nextTrack = useCallback(() => advanceTrack(true), [advanceTrack]);

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
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
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
    lyrics,
    activeLyricIndex: lyricIndex,
    canRender,
    engaged,
    dismissed,
    closeDock,
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
    engaged,
    dismissed,
    closeDock,
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
    engaged,
    dismissed,
    closeDock,
    skin,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
    setVolume,
  } = value;

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLParagraphElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 迷你浮标:默认只露一颗左下角的浮标(播放时带均衡器/脉冲环),
  // 点击才展开紧凑控制面板 —— 把"前台显眼控制条"降级为"后台不打扰的浮标"。
  const [miniOpen, setMiniOpen] = useState(false);
  const miniPanelRef = useRef<HTMLDivElement>(null);
  const miniOrbRef = useRef<HTMLButtonElement>(null);

  // 迷你面板:Esc 关闭 + 点击浮标/面板以外区域关闭(浮标自身的 onClick 负责 toggle)
  useEffect(() => {
    if (!miniOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMiniOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (miniPanelRef.current?.contains(target) || miniOrbRef.current?.contains(target)) return;
      setMiniOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    // 打开时把焦点移入面板(role=dialog),让键盘 Tab 顺序进入控件而非越过浮标(preventScroll 避免页面跳动)
    const focusTimer = window.setTimeout(() => miniPanelRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [miniOpen]);

  // 进入沉浸大厅时强制收起迷你面板,避免两层播放面叠加
  useEffect(() => {
    if (expanded) setMiniOpen(false);
  }, [expanded]);

  // 沉浸层:Esc 关闭 + 打开时锁滚动 + 焦点落到关闭键(对话框语义)
  useEffect(() => {
    if (!expanded) return;
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
  }, [expanded, setExpanded]);

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

  // 整个播放器都不渲染：功能未开启 / 无可播曲目。
  if (!canRender || !currentTrack) return null;

  // dock（完整 bar / 最小化 pill）的显示门控：
  //  · 访客尚未开始播放，或已 ✕ 关闭（engaged / dismissed）—— 不打扰未听歌的人
  //  · 全屏「应用型」表面（Agent 工作台 / 对话空间）自带底部 composer，悬浮 dock 会盖住输入框
  // 注意：沉浸全屏 expanded 是用户显式打开的模态，**不受此门控约束** —— 否则未播放就点
  // 「沉浸模式」时 expanded 副作用锁了 body 滚动却无 UI 渲染，页面会卡死（PR #789 评审 P2）。
  const dockHidden =
    !engaged ||
    dismissed ||
    pathname?.startsWith('/agent/workspace') ||
    pathname?.startsWith('/team-chat');
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : '';
  const playlistName = player?.playlist?.name || '音乐大厅';
  const cover = resolveMusicCoverSrc(currentTrack);

  return (
    <>
      {/* 迷你浮标 —— 沉浸大厅未打开时常驻左下角:播放时带均衡器跳动 + 脉冲环,
          静止时只是一颗带播放三角的小球。点击才展开紧凑控制面板,
          取代旧的「全宽常驻控制条」,把音乐降级为后台不打扰的存在。
          仍受 #789 的 dockHidden 门控:未开始播放 / 已 ✕ 关闭 / 对话空间 / Agent 工作台均不打扰。 */}
      {!dockHidden && !expanded && (
        <div
          data-music-skin={skin}
          className="pointer-events-none fixed bottom-0 left-0 z-[70] flex flex-col items-start gap-3 pb-[max(1.1rem,env(safe-area-inset-bottom))] pl-[max(1.1rem,env(safe-area-inset-left))]"
        >
          {miniOpen && (
            <div
              ref={miniPanelRef}
              role="dialog"
              aria-label="迷你播放器"
              tabIndex={-1}
              className="surface-overlay pointer-events-auto w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-[1.4rem] p-4 text-[var(--ink-primary)] focus:outline-none animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-6 items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--aurora-1)]">
                  {playlistName}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] tnum text-[var(--ink-muted)]">{currentIndex + 1}/{tracks.length}</span>
                  {/* 关闭：暂停并收起整个浮标(置 dismissed),直到下次播放再回来 —— 保留 #789 的「彻底关闭」能力 */}
                  <button
                    type="button"
                    onClick={closeDock}
                    className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_oklch,var(--signal-danger)_45%,transparent)] hover:text-[var(--signal-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
                    aria-label="关闭播放器"
                    title="关闭播放器"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMiniOpen(false)}
                    className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
                    aria-label="收起迷你播放器"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <CoverDisc track={currentTrack} playing={isPlaying} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--ink-primary)]" title={currentTrack.title}>{currentTrack.title}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--ink-secondary)]">{currentTrack.artist || '未知艺术家'}</p>
                  {activeLine ? <p className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]">{activeLine}</p> : null}
                </div>
              </div>

              <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="sm" className="mt-4" />
              <div className="mt-1.5 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
                <span>{formatMusicClock(progress)}</span>
                <span>{formatMusicClock(duration || currentTrack.durationSeconds || 0)}</span>
              </div>

              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShuffle((value) => !value)}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
                    shuffle
                      ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)]'
                      : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                  )}
                  aria-label="随机播放"
                  aria-pressed={shuffle}
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button type="button" onClick={previousTrack} className="flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_10px_30px_-12px_color-mix(in_oklch,var(--aurora-1)_80%,transparent)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
                </button>
                <button type="button" onClick={nextTrack} className="flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setMiniOpen(false); setExpanded(true); }}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-xs font-bold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                >
                  <Disc3 className="h-3.5 w-3.5" />
                  音乐大厅
                </button>
                <Link
                  href="/music"
                  onClick={() => setMiniOpen(false)}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-xs font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                >
                  <ListMusic className="h-3.5 w-3.5" />
                  歌单页
                </Link>
              </div>
            </div>
          )}

          <button
            ref={miniOrbRef}
            type="button"
            onClick={() => setMiniOpen((value) => !value)}
            className="group pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            aria-label={miniOpen ? '收起迷你播放器' : isPlaying ? `正在播放 ${currentTrack.title}，点击展开播放器` : '展开迷你播放器'}
            aria-expanded={miniOpen}
          >
            {isPlaying && (
              <span aria-hidden="true" className="music-orb-ring absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]" />
            )}
            <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[var(--bg-raised)] shadow-[0_14px_40px_-16px_color-mix(in_oklch,black_70%,transparent)] transition-transform duration-200 group-hover:scale-105">
              {cover ? (
                <Image
                  src={cover}
                  alt=""
                  fill
                  sizes="3.5rem"
                  className={cn('object-cover opacity-55', isPlaying && 'music-vinyl-spin')}
                  unoptimized
                />
              ) : (
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,color-mix(in_oklch,var(--aurora-1)_38%,transparent),var(--bg-void))]" />
              )}
              <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent,color-mix(in_oklch,black_70%,transparent))]" />
              {isPlaying ? (
                <span className="relative z-10 flex h-6 items-end gap-[3px]" aria-hidden="true">
                  <span className="music-eq-bar" />
                  <span className="music-eq-bar [animation-delay:140ms]" />
                  <span className="music-eq-bar [animation-delay:260ms]" />
                </span>
              ) : (
                <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_6px_16px_-6px_color-mix(in_oklch,var(--aurora-1)_80%,transparent)]">
                  <Play className="h-3.5 w-3.5 translate-x-px" />
                </span>
              )}
            </span>
            <span className="pointer-events-none absolute left-[calc(100%+0.6rem)] top-1/2 hidden max-w-[12rem] -translate-y-1/2 truncate whitespace-nowrap rounded-full surface-raised px-3 py-1.5 text-xs font-bold text-[var(--ink-primary)] opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 md:block">
              {currentTrack.title}
            </span>
          </button>
        </div>
      )}

      <AnimatePresence>
      {expanded && (
        <motion.div
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐大厅播放器"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={transition.flow}
          className="fixed inset-0 z-[65] overflow-y-auto bg-[color-mix(in_oklch,var(--bg-void)_92%,transparent)] px-4 py-[max(4.5rem,env(safe-area-inset-top))] text-[var(--ink-primary)] [backdrop-filter:blur(28px)_saturate(140%)]"
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
                  <button type="button" onClick={() => setShuffle((value) => !value)} className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]', shuffle ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]' : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]')} aria-label="随机播放" aria-pressed={shuffle}>
                    <Shuffle className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={previousTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]" aria-label="上一首">
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={togglePlayback} className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_20px_44px_-20px_color-mix(in_oklch,var(--aurora-1)_85%,transparent)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]" aria-label={isPlaying ? '暂停音乐' : '播放音乐'}>
                    {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
                  </button>
                  <button type="button" onClick={nextTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]" aria-label="下一首">
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
                        <span className="flex h-7 items-end gap-0.5" aria-hidden="true">
                          <span className="music-eq-bar" />
                          <span className="music-eq-bar [animation-delay:140ms]" />
                          <span className="music-eq-bar [animation-delay:260ms]" />
                        </span>
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
            className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_80%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] [backdrop-filter:blur(16px)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
            aria-label="关闭音乐大厅播放器"
          >
            <X className="h-5 w-5" />
          </button>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
