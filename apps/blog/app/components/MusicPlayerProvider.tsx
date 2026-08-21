'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useIsMobile } from '@aetherblog/hooks';
import { musicMotion, spring, transition as motionTransition } from '@aetherblog/ui';
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
  type Variants,
} from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  AlertCircle,
  Disc3,
  ListMusic,
  LibraryBig,
  Minus,
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
  parseMusicLyric,
  parseStoredMusicPlayback,
  recordShuffleSelection,
  resolveAdjacentTrack,
  resolveIdleMusicSeekPreviewPosition,
  resolveMusicArtworkSource,
  resolveMusicPlayerGesture,
  resolveMusicPlayerSurface,
  resolveStableMusicTrackIndex,
  resolveMusicTrackPresentation,
  resolveMusicStartIndex,
  resolveRestoredMusicPosition,
  resolveShuffleNavigation,
  shouldCollapseMusicCompactFromPointer,
  shouldRotateMusicPresentation,
  type MusicArtworkSize,
  type LyricLine,
} from './musicPlayerState';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';

export { parseMusicLyric };
export type { LyricLine };

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

/**
 * 形变窗口 —— data-music-morphing 的存活时长。取 CSS 形变时长再留一档缓冲,
 * 保证 will-change 与降级高斯半径撤销时形变已经完全落位(提前撤会在最后几帧
 * 抖一下)。缓冲刻意保持一档 quick,不另立数值。
 */
const MUSIC_MORPH_WINDOW_MS = Math.round(
  (musicMotion.duration.morph + musicMotion.duration.reduced) * 1000,
);

/**
 * 浮岛显隐 —— 锚角缩放 variants。
 *
 * 之前这里只有 opacity 0↔1:浮岛在原地由透变实,没有任何「从哪来、到哪去」,
 * 这就是「突然出现 / 突然消失」的字面成因。浮岛的 transform-origin 恒为
 * left bottom,所以单靠 scale 就等于从屏幕左下角的锚点长出来,既不占用被拖拽
 * 征用的 y,也不需要额外位移。
 *
 * exit 用函数形式读 AnimatePresence 的 custom(布尔 handoff),于是同一个壳体
 * 能分辨两种消失:
 *   handoff=true  —— 交接给沉浸台,反向微放并快速淡出,像被展开的整屏吸走
 *   handoff=false —— 真正收起 / 关闭,缩回锚点
 *
 * 这一整组只在触屏视口生效;指针端走下面的 pointer* 组,保持本轮之前的行为。
 */
const musicIslandVariants: Variants = {
  /* ---- 触屏:锚角缩放 ---------------------------------------------------- */
  hidden: {
    opacity: 0,
    scale: musicMotion.island.enterScale,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      scale: musicMotion.spring.islandEnter,
      // 透明度先于弹簧收尾:浮岛还在落位时就已经是实体,而不是一路半透明
      opacity: { duration: musicMotion.duration.islandEnter, ease: musicMotion.ease.emphasis },
    },
  },
  exit: (handoff: boolean) => ({
    opacity: 0,
    scale: handoff ? musicMotion.island.handoffScale : musicMotion.island.exitScale,
    transition: {
      duration: handoff ? musicMotion.duration.contentOut : musicMotion.duration.islandExit,
      ease: musicMotion.ease.recede,
    },
  }),

  /* ---- 指针端:保持既有的 opacity-only 入场 ------------------------------ */
  pointerHidden: { opacity: 0 },
  pointerVisible: { opacity: 1, transition: motionTransition.quick },
  pointerExit: { opacity: 0, transition: motionTransition.quick },

  /* ---- prefers-reduced-motion:只留最短淡入淡出,不做任何位移 / 缩放 ------ */
  reducedHidden: { opacity: 0 },
  reducedVisible: {
    opacity: 1,
    transition: { duration: musicMotion.duration.reduced },
  },
  reducedExit: {
    opacity: 0,
    transition: { duration: musicMotion.duration.reduced },
  },
};

/**
 * 按视口 / 无障碍偏好挑一组 variant 名。
 *
 * 指针端刻意回到 pointer* 那组(= 本轮之前的 opacity-only / transition.quick):
 * AGENTS.md §移动端 UI 开发约定明写「修改移动端样式时不得影响桌面端」,而锚角
 * 缩放那一档是为 52px 的灵动音乐元调的,套在指针端那条横幅上偏重。
 */
function resolveMusicIslandMotion(isMobile: boolean, prefersReducedMotion: boolean | null) {
  if (prefersReducedMotion) {
    return { initial: 'reducedHidden', animate: 'reducedVisible', exit: 'reducedExit' } as const;
  }
  if (!isMobile) {
    return { initial: 'pointerHidden', animate: 'pointerVisible', exit: 'pointerExit' } as const;
  }
  return { initial: 'hidden', animate: 'visible', exit: 'exit' } as const;
}

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

export function resolveMusicAudioSrc(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media?.publicUrl || track.media?.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  const safe = sanitizeUrl(raw, '');
  return safe === '#' ? '' : safe;
}

export function resolveMusicCoverSrc(
  track: MusicTrack | undefined,
  fallback = '',
  size: MusicArtworkSize = 'hero',
): string {
  return sanitizeImageUrl(resolveMusicArtworkSource({
    coverUrl: track?.coverUrl,
    thumbnailUrl: track?.media?.thumbnailUrl,
    size,
  }), fallback);
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
 * 交互态带 role="slider" 与 aria-value*；只读态退为 progressbar 并让指针
 * 穿透给外层手势。三处播放面(大厅 / dock / 沉浸层)统一复用,
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
  interactive = true,
}: {
  percent: number;
  progress: number;
  duration: number;
  onSeek: (percent: number) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
  interactive?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const heightClass = size === 'lg' ? 'h-1.5' : size === 'sm' ? 'h-[3px]' : 'h-1';
  const hoverHeightClass = size === 'lg'
    ? 'group-hover/music-seek:h-2 group-active/music-seek:h-2'
    : size === 'sm'
      ? 'group-hover/music-seek:h-[5px] group-active/music-seek:h-[5px]'
      : 'group-hover/music-seek:h-1.5 group-active/music-seek:h-1.5';
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
  const finishPointerScrub = (
    event: ReactPointerEvent<HTMLDivElement>,
    commit: boolean,
  ) => {
    if (activePointerRef.current !== event.pointerId) return;
    if (commit) seekFromClientX(event.clientX);
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current === event.pointerId) {
      activePointerRef.current = null;
    }
  };
  return (
    <div
      ref={trackRef}
      role={interactive ? 'slider' : 'progressbar'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      aria-disabled={interactive ? undefined : true}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedPercent)}
      aria-valuetext={`${formatMusicClock(progress)} / ${formatMusicClock(duration)}`}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? (event) => finishPointerScrub(event, true) : undefined}
      onPointerCancel={interactive ? (event) => finishPointerScrub(event, false) : undefined}
      onLostPointerCapture={interactive ? handleLostPointerCapture : undefined}
      onKeyDown={interactive ? (event) => {
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
      } : undefined}
      className={cn(
        'group/music-seek flex min-h-11 w-full items-center py-3 focus-visible:outline-none',
        interactive && 'touch-none cursor-pointer',
        !interactive && 'pointer-events-none touch-auto cursor-default',
        className
      )}
      style={{ ['--music-progress' as string]: `${clampedPercent}%` }}
    >
      <span
        className={cn(
          'relative block w-full overflow-visible rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] transition-[height] duration-200 motion-reduce:transition-none',
          interactive && hoverHeightClass,
          heightClass
        )}
      >
        <span
          className="absolute inset-0 origin-left rounded-full bg-[var(--aurora-1)] transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${clampedPercent / 100})` }}
        />
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink-primary)] opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
            interactive && 'group-hover/music-seek:opacity-100 group-focus-visible/music-seek:opacity-100 group-focus-visible/music-seek:ring-2 group-focus-visible/music-seek:ring-[var(--aurora-1)] group-active/music-seek:opacity-100',
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
  volume: number;
  expanded: boolean;
  hasPlaybackSession: boolean;
  playbackSurfaceVisible: boolean;
  lyrics: LyricLine[];
  canRender: boolean;
  canUseSurface: (surface: 'home' | 'profile') => boolean;
  reportPlaybackSurfaceVisibility: (surfaceId: string, visible: boolean) => void;
  playIndex: (index: number, options?: { expand?: boolean }) => void;
  playTrack: (trackId: number, options?: { expand?: boolean }) => void;
  playAll: (options?: { expand?: boolean }) => void;
  playShuffled: (options?: { expand?: boolean }) => void;
  togglePlayback: () => Promise<void>;
  retryPlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  skipToPreviousTrack: () => void;
  seekToTime: (seconds: number) => void;
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

interface MusicPlayerTimelineValue {
  progress: number;
  duration: number;
  percent: number;
  activeLyricIndex: number;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);
const MusicPlayerTimelineContext = createContext<MusicPlayerTimelineValue | null>(null);

export function useMusicPlayer() {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  }
  return context;
}

/** 高频播放时间线独立订阅，避免整页与列表随 audio.timeupdate 重渲染。 */
export function useMusicPlayerTimeline() {
  const context = useContext(MusicPlayerTimelineContext);
  if (!context) {
    throw new Error('useMusicPlayerTimeline must be used within MusicPlayerProvider');
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
  const playbackTrackIdRef = useRef<number | null>(null);
  const presentationTrackIdRef = useRef<number | null>(null);
  const trackOrderSignatureRef = useRef('');
  const progressRef = useRef(0);
  const volumeRef = useRef(0.86);
  const shuffleHistoryRef = useRef(createShuffleHistory(0));
  const storedPlaybackRef = useRef<ReturnType<typeof parseStoredMusicPlayback>>(null);
  const pendingRestoreRef = useRef<{ trackId: number; position: number } | null>(null);
  const visiblePlaybackSurfacesRef = useRef(new Set<string>());
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
  const [playbackSurfaceVisible, setPlaybackSurfaceVisible] = useState(false);
  const [idleSeekPreview, setIdleSeekPreview] = useState<{ trackId: number; position: number } | null>(null);
  const [playbackPreferencesHydrated, setPlaybackPreferencesHydrated] = useState(false);

  const stablePlaybackIndex = resolveStableMusicTrackIndex(
    tracks,
    playbackTrackIdRef.current,
    playbackIndex,
  );
  const stablePresentationIndex = resolveStableMusicTrackIndex(
    tracks,
    presentationTrackIdRef.current,
    presentationIndex,
  );
  const currentIndex = hasPlaybackSession ? stablePlaybackIndex : stablePresentationIndex;
  const currentTrack = tracks[currentIndex];
  const playbackTrack = tracks[stablePlaybackIndex];
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
  const displayedProgress = hasPlaybackSession
    ? progress
    : resolveIdleMusicSeekPreviewPosition(idleSeekPreview, currentTrack?.id ?? null);
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

  const reportPlaybackSurfaceVisibility = useCallback((surfaceId: string, visible: boolean) => {
    if (visible) visiblePlaybackSurfacesRef.current.add(surfaceId);
    else visiblePlaybackSurfacesRef.current.delete(surfaceId);
    const nextVisible = visiblePlaybackSurfacesRef.current.size > 0;
    setPlaybackSurfaceVisible((current) => current === nextVisible ? current : nextVisible);
  }, []);

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

  const selectPlaybackIndex = useCallback((
    index: number,
    options?: { initialPosition?: number },
  ) => {
    if (tracks.length === 0) return 0;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    const targetTrack = tracks[safeIndex];
    const initialPosition = Math.max(0, options?.initialPosition ?? 0);
    const sourceChanged = tracks[safeIndex]?.id !== playbackTrackIdRef.current;
    if (sourceChanged) {
      sourceTransitionRef.current = true;
      sourceRequestRef.current += 1;
      activeAudioSrcRef.current = '';
      audioRef.current?.pause();
      setIsPlaying(false);
    }
    pendingRestoreRef.current = targetTrack && initialPosition > 0
      ? { trackId: targetTrack.id, position: initialPosition }
      : null;
    if (!sourceChanged && audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {
        /* Metadata may not be ready yet; the visible progress still restarts at zero. */
      }
    }
    playbackIndexRef.current = safeIndex;
    presentationIndexRef.current = safeIndex;
    playbackTrackIdRef.current = tracks[safeIndex]?.id ?? null;
    presentationTrackIdRef.current = tracks[safeIndex]?.id ?? null;
    setPlaybackIndex(safeIndex);
    setPresentationIndex(safeIndex);
    progressRef.current = initialPosition;
    setProgress(initialPosition);
    setIdleSeekPreview(null);
    if (shuffle) {
      shuffleHistoryRef.current = recordShuffleSelection(shuffleHistoryRef.current, safeIndex);
    }
    persistPlaybackSnapshot(initialPosition);
    return safeIndex;
  }, [persistPlaybackSnapshot, shuffle, tracks]);

  const previewAdjacentTrack = useCallback((direction: -1 | 1) => {
    if (tracks.length === 0) return;
    const currentPresentationIndex = resolveStableMusicTrackIndex(
      tracks,
      presentationTrackIdRef.current,
      presentationIndexRef.current,
    );
    const { nextIndex } = resolveAdjacentTrack({
      currentIndex: currentPresentationIndex,
      direction,
      trackCount: tracks.length,
    });
    presentationIndexRef.current = nextIndex;
    presentationTrackIdRef.current = tracks[nextIndex]?.id ?? null;
    setPresentationIndex(nextIndex);
  }, [tracks]);

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
    setIdleSeekPreview(null);
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
    playbackTrackIdRef.current = restoredTrack.id;
    presentationTrackIdRef.current = restoredTrack.id;
    setPlaybackIndex(restoredIndex);
    setPresentationIndex(restoredIndex);
    shuffleHistoryRef.current = createShuffleHistory(restoredIndex);
    progressRef.current = position;
    setProgress(position);
    if (position > 0) {
      pendingRestoreRef.current = { trackId: restoredTrack.id, position };
    }
  }, [playbackPreferencesHydrated, tracks]);

  useEffect(() => {
    if (tracks.length > 0) {
      // The restore effect runs immediately before this one. Resolve once more
      // from the refs it may have updated, while render-time consumers already
      // use the stable indexes above and cannot observe a stale audio source.
      const nextPlaybackIndex = resolveStableMusicTrackIndex(
        tracks,
        playbackTrackIdRef.current,
        stablePlaybackIndex,
      );
      const nextPresentationIndex = resolveStableMusicTrackIndex(
        tracks,
        presentationTrackIdRef.current,
        stablePresentationIndex,
      );
      playbackIndexRef.current = nextPlaybackIndex;
      presentationIndexRef.current = nextPresentationIndex;
      playbackTrackIdRef.current = tracks[nextPlaybackIndex]?.id ?? null;
      presentationTrackIdRef.current = tracks[nextPresentationIndex]?.id ?? null;
      setPlaybackIndex((current) => current === nextPlaybackIndex ? current : nextPlaybackIndex);
      setPresentationIndex((current) => current === nextPresentationIndex ? current : nextPresentationIndex);
      const trackOrderSignature = tracks.map((track) => track.id).join(',');
      if (trackOrderSignatureRef.current !== trackOrderSignature) {
        trackOrderSignatureRef.current = trackOrderSignature;
        shuffleHistoryRef.current = createShuffleHistory(nextPlaybackIndex);
      }
      if (
        pendingRestoreRef.current
        && !tracks.some((track) => track.id === pendingRestoreRef.current?.trackId)
      ) {
        pendingRestoreRef.current = null;
      }
    } else {
      playbackTrackIdRef.current = null;
      presentationTrackIdRef.current = null;
      trackOrderSignatureRef.current = '';
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
      setExpanded(false);
    }
  }, [canRender, stablePlaybackIndex, stablePresentationIndex, tracks]);

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
      const pendingRestore = pendingRestoreRef.current;
      if (!hasPlaybackSession && isCurrentSource && pendingRestore?.trackId === tracks[targetIndex]?.id) {
        await attemptPlayback({ source: targetSource });
        return;
      }
      selectPlaybackIndex(targetIndex, {
        initialPosition: !hasPlaybackSession && pendingRestore?.trackId === tracks[targetIndex]?.id
          ? pendingRestore.position
          : 0,
      });
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

  const navigateToPreviousTrack = useCallback((restartElapsedTrack: boolean) => {
    if (tracks.length === 0) return;
    if (!hasPlaybackSession) {
      previewAdjacentTrack(-1);
      return;
    }
    const index = playbackIndexRef.current;
    if (restartElapsedTrack && progressRef.current > 3) {
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
  }, [hasPlaybackSession, previewAdjacentTrack, restartCurrentPlayback, selectPlaybackIndex, shuffle, tracks.length]);

  const previousTrack = useCallback(() => {
    navigateToPreviousTrack(true);
  }, [navigateToPreviousTrack]);

  // Artwork swipes are an explicit navigation gesture. Unlike the transport
  // button, a right swipe must always reveal the previous queue item instead
  // of restarting the current track after its first three seconds.
  const skipToPreviousTrack = useCallback(() => {
    navigateToPreviousTrack(false);
  }, [navigateToPreviousTrack]);

  const nextTrack = useCallback(() => {
    if (!hasPlaybackSession) {
      previewAdjacentTrack(1);
      return;
    }
    advanceTrack(true);
  }, [advanceTrack, hasPlaybackSession, previewAdjacentTrack]);

  useEffect(() => {
    if (!canRender || expanded || !shouldRotateCarousel || tracks.length <= 1) return;

    const timer = window.setInterval(() => {
      setPresentationIndex((index) => {
        const nextIndex = shuffle
          ? pickRandomIndex(tracks.length, index)
          : (index + 1) % tracks.length;
        presentationIndexRef.current = nextIndex;
        presentationTrackIdRef.current = tracks[nextIndex]?.id ?? null;
        return nextIndex;
      });
    }, carouselIntervalMs);

    return () => window.clearInterval(timer);
  }, [canRender, carouselIntervalMs, expanded, shouldRotateCarousel, shuffle, tracks]);

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
      if (!targetTrack) return;
      setIdleSeekPreview({ trackId: targetTrack.id, position: nextTime });
      pendingRestoreRef.current = { trackId: targetTrack.id, position: nextTime };
      progressRef.current = nextTime;
      setProgress(nextTime);
      return;
    }
    if (targetTrack && (!audio || audio.readyState === 0)) {
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
  }, [effectiveDuration, hasPlaybackSession, persistPlaybackSnapshot, tracks]);

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
    setIdleSeekPreview(null);
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
    volume,
    expanded,
    hasPlaybackSession,
    playbackSurfaceVisible,
    lyrics,
    canRender,
    canUseSurface,
    reportPlaybackSurfaceVisibility,
    playIndex,
    playTrack,
    playAll,
    playShuffled,
    togglePlayback,
    retryPlayback,
    nextTrack,
    previousTrack,
    skipToPreviousTrack,
    seekToTime,
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
    expanded,
    hasPlaybackSession,
    playbackSurfaceVisible,
    isPlaying,
    isBuffering,
    isPlayerLoading,
    lyrics,
    nextTrack,
    playAll,
    playShuffled,
    playIndex,
    playTrack,
    player,
    playerLoadError,
    reportPlaybackSurfaceVisibility,
    previousTrack,
    skipToPreviousTrack,
    seekToTime,
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

  const timelineValue = useMemo<MusicPlayerTimelineValue>(() => ({
    progress: effectiveProgress,
    duration: effectiveDuration,
    percent: effectivePercent,
    activeLyricIndex: lyricIndex,
  }), [effectiveDuration, effectivePercent, effectiveProgress, lyricIndex]);

  return (
    <MusicPlayerContext.Provider value={value}>
      <MusicPlayerTimelineContext.Provider value={timelineValue}>
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
        <PersistentMusicDock value={value} timeline={timelineValue} />
      </MusicPlayerTimelineContext.Provider>
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
  const cover = resolveMusicCoverSrc(track, '', size);
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
          draggable={false}
          className="select-none object-cover"
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

const MemoizedMusicLyricRows = memo(function MemoizedMusicLyricRows({
  lines,
  activeIndex,
  activeRef,
  onSeek,
  onResumeFollowing,
  variant,
}: {
  lines: readonly LyricLine[];
  activeIndex: number;
  activeRef: RefObject<HTMLButtonElement | null>;
  onSeek: (seconds: number) => void;
  onResumeFollowing: () => void;
  variant: 'mobile' | 'desktop';
}) {
  const mobile = variant === 'mobile';
  return lines.map((line, index) => {
    const lineClass = cn(
      'block w-full rounded-[var(--music-radius-control)] px-2 py-1 text-left font-semibold transition-[color,opacity,transform,background-color] duration-200 motion-reduce:translate-x-0 motion-reduce:transition-none',
      mobile ? 'min-h-11 text-[1.15rem] leading-8' : 'min-h-10 text-[0.95rem] leading-7',
      line.time != null && 'hover:bg-[var(--music-control-fill)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
      index === activeIndex
        ? 'music-lyric-line-active translate-x-1 text-[var(--ink-primary)]'
        : 'text-[var(--ink-muted)] opacity-55',
    );
    if (line.time == null) {
      return (
        <p key={mobile ? `plain-mobile-${index}` : `plain-${index}`} className={lineClass}>
          {line.text}
        </p>
      );
    }
    return (
      <button
        key={mobile ? `${line.time}-mobile-${index}` : `${line.time}-${index}`}
        type="button"
        ref={index === activeIndex ? activeRef : undefined}
        onClick={() => {
          onSeek(line.time!);
          onResumeFollowing();
        }}
        aria-current={index === activeIndex ? 'true' : undefined}
        className={lineClass}
      >
        {line.text}
      </button>
    );
  });
});

const MemoizedMusicQueueRows = memo(function MemoizedMusicQueueRows({
  tracks,
  currentIndex,
  hasPlaybackSession,
  isPlaying,
  isBuffering,
  playbackError,
  playlistName,
  onPlayIndex,
  onRetryPlayback,
  onTogglePlayback,
  variant,
}: {
  tracks: readonly MusicTrack[];
  currentIndex: number;
  hasPlaybackSession: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  playbackError: string | null;
  playlistName: string;
  onPlayIndex: (index: number) => void;
  onRetryPlayback: () => Promise<void>;
  onTogglePlayback: () => Promise<void>;
  variant: 'mobile' | 'desktop';
}) {
  const mobile = variant === 'mobile';
  return tracks.map((track, index) => {
    const active = hasPlaybackSession && currentIndex === index;
    const presentation = resolveMusicTrackPresentation(track);
    const queueArtist = presentation.artist || meaningfulMusicText(track.album) || playlistName;
    return (
      <button
        key={track.id}
        type="button"
        onClick={() => {
          if (!active) {
            onPlayIndex(index);
          } else if (playbackError) {
            void onRetryPlayback();
          } else {
            void onTogglePlayback();
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
        className={mobile
          ? 'grid min-h-[72px] w-full grid-cols-[1.25rem_48px_minmax(0,1fr)_44px] items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]'
          : 'group/queue-row grid h-[52px] w-full grid-cols-[1.75rem_36px_minmax(0,1fr)_36px] items-center gap-2.5 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-left transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]'}
      >
        <span className={cn('text-xs tnum text-[var(--ink-muted)]', mobile && 'text-center')}>
          {mobile
            ? (active && isPlaying ? <NowPlayingGlyph /> : index + 1)
            : String(index + 1).padStart(2, '0')}
        </span>
        <MusicArtwork track={track} className={mobile ? 'h-12 w-12' : 'h-9 w-9'} sizes={mobile ? '48px' : '36px'} />
        <span className="min-w-0">
          <span className={cn('block truncate font-bold', mobile ? 'text-sm' : 'text-[13px]', active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>
            {presentation.title}
          </span>
          <span className={cn('block truncate text-[var(--ink-muted)]', mobile ? 'mt-1 text-xs' : 'mt-0.5 text-[11px]')}>{queueArtist}</span>
        </span>
        <span
          className={cn(
            'grid place-items-center text-[var(--ink-muted)]',
            mobile ? 'h-11 w-11' : 'h-9 w-9',
            !mobile && !active && 'opacity-0 transition-opacity duration-200 group-hover/queue-row:opacity-100 group-focus-visible/queue-row:opacity-100',
          )}
          aria-hidden="true"
        >
          {active && isBuffering
            ? <RefreshCw className="h-4 w-4 animate-spin" />
            : active && isPlaying
              ? <Pause className="h-4 w-4" />
              : <Play className="h-4 w-4" />}
        </span>
      </button>
    );
  });
});

function PersistentMusicDock({
  value,
  timeline,
}: {
  value: MusicPlayerContextValue;
  timeline: MusicPlayerTimelineValue;
}) {
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
    volume,
    expanded,
    hasPlaybackSession,
    playbackSurfaceVisible,
    lyrics,
    canRender,
    skin,
    playIndex,
    togglePlayback,
    retryPlayback,
    nextTrack,
    previousTrack,
    skipToPreviousTrack,
    seekToTime,
    seekToPercent,
    dismissPlayer,
    setShuffle,
    setExpanded,
    setVolume,
  } = value;
  const { progress, duration, percent, activeLyricIndex } = timeline;

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const surfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const compactIdentityTriggerRef = useRef<HTMLButtonElement>(null);
  const compactPanelRef = useRef<HTMLElement>(null);
  const compactGestureRef = useRef(false);
  const immersiveGestureRef = useRef(false);
  const compactInputModalityRef = useRef<'keyboard' | 'pointer'>('keyboard');
  const pendingSurfaceFocusRef = useRef<'orb' | 'compact' | null>(null);
  const mobileLyricsBoxRef = useRef<HTMLDivElement>(null);
  const mobileActiveLyricRef = useRef<HTMLButtonElement>(null);
  const mobilePaneHeadingRef = useRef<HTMLHeadingElement>(null);
  const desktopLyricsTabRef = useRef<HTMLButtonElement>(null);
  const desktopQueueTabRef = useRef<HTMLButtonElement>(null);
  const [mobilePane, setMobilePane] = useState<'player' | 'lyrics' | 'queue'>('player');
  const [desktopPane, setDesktopPane] = useState<'lyrics' | 'queue'>('lyrics');
  const [compactOpen, setCompactOpen] = useState(false);
  const [compactInteractionVersion, setCompactInteractionVersion] = useState(0);
  const [compactPointerInside, setCompactPointerInside] = useState(false);
  const [compactFocusWithin, setCompactFocusWithin] = useState(false);
  const [lyricsFollowing, setLyricsFollowing] = useState(true);
  const [artworkDirection, setArtworkDirection] = useState<1 | -1>(1);
  const [morphing, setMorphing] = useState(false);
  const [sheetOrigin, setSheetOrigin] = useState<{ x: number; y: number } | null>(null);
  const previousDensityRef = useRef<'minimized' | 'compact' | 'expanded' | null>(null);
  const expandedRef = useRef(expanded);
  const previousSessionRef = useRef(false);
  const previousPlaybackErrorRef = useRef<string | null>(null);
  const compactDragControls = useDragControls();
  const immersiveDragControls = useDragControls();
  const compactDragY = useMotionValue(0);
  const immersiveDragY = useMotionValue(0);
  const mobileBackdropOpacity = useTransform(immersiveDragY, [0, 320], [1, 0.18]);
  const prefersReducedMotion = useReducedMotion();
  const registerCompactInteraction = useCallback(() => {
    setCompactInteractionVersion((version) => version + 1);
  }, []);
  const resumeLyricsFollowing = useCallback(() => {
    setLyricsFollowing(true);
  }, []);
  const openCompactSurface = useCallback(() => {
    setCompactOpen(true);
  }, []);
  const collapseToOrb = useCallback(() => {
    setCompactPointerInside(false);
    setCompactFocusWithin(false);
    setCompactOpen(false);
  }, []);
  const manuallyCollapseToOrb = useCallback((restoreKeyboardFocus = true) => {
    if (restoreKeyboardFocus) pendingSurfaceFocusRef.current = 'orb';
    setExpanded(false);
    collapseToOrb();
  }, [collapseToOrb, setExpanded]);
  const focusPendingSurface = useCallback(() => {
    const pendingTarget = pendingSurfaceFocusRef.current;
    if (!pendingTarget) return;
    window.requestAnimationFrame(() => {
      const target = pendingTarget === 'compact'
        ? compactIdentityTriggerRef.current
        : surfaceTriggerRef.current;
      if (!target?.isConnected) return;
      target.focus({ preventScroll: true });
      pendingSurfaceFocusRef.current = null;
    });
  }, []);
  const focusPersistentIdentityAfterDensityChange = useCallback(() => {
    window.requestAnimationFrame(() => {
      compactIdentityTriggerRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const closeExpandedPlayer = useCallback(() => {
    compactDragY.set(0);
    setExpanded(false);
    setCompactPointerInside(false);
    setCompactFocusWithin(false);
    openCompactSurface();
    registerCompactInteraction();
  }, [compactDragY, openCompactSurface, registerCompactInteraction, setExpanded]);
  const openImmersivePlayer = useCallback(() => {
    compactDragY.set(0);
    immersiveDragY.set(0);
    // 记下浮岛此刻的视口中心,沉浸台就以这个点为 transform-origin 放大。
    // 少了它,整屏面只能从屏幕正中淡入 —— 与指尖刚点过的左下角毫无空间关系,
    // 那正是「突然出现」的来源。
    const islandRect = compactPanelRef.current?.getBoundingClientRect();
    setSheetOrigin(islandRect && islandRect.width > 0
      ? { x: islandRect.left + islandRect.width / 2, y: islandRect.top + islandRect.height / 2 }
      : null);
    setCompactPointerInside(false);
    setCompactFocusWithin(false);
    setCompactOpen(false);
    setExpanded(true);
  }, [compactDragY, immersiveDragY, setExpanded]);
  const goToNextTrack = useCallback(() => {
    setArtworkDirection(1);
    nextTrack();
  }, [nextTrack]);
  const goToPreviousTrack = useCallback(() => {
    setArtworkDirection(-1);
    previousTrack();
  }, [previousTrack]);
  const goToPreviousTrackByGesture = useCallback(() => {
    setArtworkDirection(-1);
    skipToPreviousTrack();
  }, [skipToPreviousTrack]);
  const handleTrackGesture = useCallback((info: PanInfo) => {
    registerCompactInteraction();
    const action = resolveMusicPlayerGesture({
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
      allowHorizontal: true,
      allowVertical: false,
    });
    if (action === 'next') goToNextTrack();
    if (action === 'previous') goToPreviousTrackByGesture();
    window.setTimeout(() => {
      compactGestureRef.current = false;
    }, 0);
  }, [goToNextTrack, goToPreviousTrackByGesture, registerCompactInteraction]);
  const handleCompactCollapseGesture = useCallback((info: PanInfo) => {
    registerCompactInteraction();
    const action = resolveMusicPlayerGesture({
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
      allowHorizontal: false,
      allowVertical: true,
    });
    if (action === 'collapse') {
      if (prefersReducedMotion) {
        collapseToOrb();
      } else {
        // Preserve the finger's current vertical displacement and let the
        // same bottom-left anchored shell morph back into the orb while the
        // displacement settles. Sliding the whole card off-screen first made
        // the orb re-enter on a second, visibly disconnected trajectory.
        collapseToOrb();
        animate(compactDragY, 0, musicMotion.spring.orbSnap);
      }
    } else {
      animate(compactDragY, 0, musicMotion.spring.rebound);
    }
    window.setTimeout(() => {
      compactGestureRef.current = false;
    }, 0);
  }, [collapseToOrb, compactDragY, prefersReducedMotion, registerCompactInteraction]);
  const handleImmersiveCollapseGesture = useCallback((info: PanInfo) => {
    const action = resolveMusicPlayerGesture({
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
      allowHorizontal: false,
      allowVertical: true,
    });
    if (action === 'collapse') {
      if (prefersReducedMotion) {
        closeExpandedPlayer();
      } else {
        void animate(immersiveDragY, Math.max(window.innerHeight, 720), {
          duration: musicMotion.duration.swap,
          ease: musicMotion.ease.fling,
        }).then(closeExpandedPlayer);
      }
    } else {
      animate(immersiveDragY, 0, musicMotion.spring.reanchor);
    }
    window.setTimeout(() => {
      immersiveGestureRef.current = false;
    }, 0);
  }, [closeExpandedPlayer, immersiveDragY, prefersReducedMotion]);
  const handleImmersiveSurfaceGesture = useCallback((info: PanInfo) => {
    const action = resolveMusicPlayerGesture({
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
      allowHorizontal: true,
      allowVertical: false,
    });
    if (action === 'next') goToNextTrack();
    if (action === 'previous') goToPreviousTrackByGesture();
    window.setTimeout(() => {
      compactGestureRef.current = false;
    }, 0);
  }, [goToNextTrack, goToPreviousTrackByGesture]);
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
    open: expanded && isMobile,
    onClose: closeExpandedPlayer,
    containerRef: mobileDialogRef,
    initialFocusRef: mobileDialogRef,
    returnFocusRef: compactIdentityTriggerRef,
    modal: true,
    trapFocus: true,
  });

  useEffect(() => {
    if (!expanded || isMobile) return;
    const handleDesktopExpandedKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeExpandedPlayer();
      focusPersistentIdentityAfterDensityChange();
    };
    document.addEventListener('keydown', handleDesktopExpandedKeyDown);
    return () => document.removeEventListener('keydown', handleDesktopExpandedKeyDown);
  }, [closeExpandedPlayer, expanded, focusPersistentIdentityAfterDensityChange, isMobile]);

  useEffect(() => {
    const markKeyboard = () => {
      compactInputModalityRef.current = 'keyboard';
    };
    const markPointer = () => {
      compactInputModalityRef.current = 'pointer';
    };
    window.addEventListener('keydown', markKeyboard, true);
    window.addEventListener('pointerdown', markPointer, true);
    return () => {
      window.removeEventListener('keydown', markKeyboard, true);
      window.removeEventListener('pointerdown', markPointer, true);
    };
  }, []);

  useEffect(() => {
    if (!expanded) setMobilePane('player');
  }, [expanded]);

  useEffect(() => {
    if (hasPlaybackSession && !previousSessionRef.current) {
      compactDragY.set(0);
      // Playing from an in-page card should update that card, not spawn a
      // second control surface over it. Once the card leaves the viewport the
      // density resolver starts from the ambient orb.
      setCompactOpen(false);
    }
    if (!hasPlaybackSession) {
      setCompactOpen(false);
    }
    previousSessionRef.current = hasPlaybackSession;
  }, [compactDragY, hasPlaybackSession]);

  useEffect(() => {
    if (playbackError && !previousPlaybackErrorRef.current && !playbackSurfaceVisible) {
      compactDragY.set(0);
      openCompactSurface();
      registerCompactInteraction();
    }
    previousPlaybackErrorRef.current = playbackError;
  }, [compactDragY, openCompactSurface, playbackError, playbackSurfaceVisible, registerCompactInteraction]);

  useEffect(() => {
    if (!playbackSurfaceVisible || expanded) return;
    setCompactPointerInside(false);
    setCompactFocusWithin(false);
    setCompactOpen(false);
  }, [expanded, playbackSurfaceVisible]);

  useEffect(() => {
    if (compactOpen) compactDragY.set(0);
  }, [compactDragY, compactOpen]);

  useEffect(() => {
    if (expanded) immersiveDragY.set(0);
  }, [expanded, immersiveDragY]);

  useEffect(() => {
    if (
      !compactOpen ||
      expanded ||
      playbackError ||
      compactPointerInside ||
      compactFocusWithin
    ) return;
    const timer = window.setTimeout(collapseToOrb, isPlaying ? 8000 : 14000);
    return () => window.clearTimeout(timer);
  }, [
    collapseToOrb,
    compactFocusWithin,
    compactInteractionVersion,
    compactOpen,
    compactPointerInside,
    expanded,
    isPlaying,
    playbackError,
  ]);

  useEffect(() => {
    if (!compactOpen || expanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      const panel = compactPanelRef.current;
      const targetInsideSurface = event.target instanceof Element
        && Boolean(event.target.closest('[data-music-compact-player]'));
      const pathInsideSurface = Boolean(
        panel
        && (
          event.composedPath().includes(panel)
          || (event.target instanceof Node && panel.contains(event.target))
        ),
      );
      if (!shouldCollapseMusicCompactFromPointer({ targetInsideSurface, pathInsideSurface })) return;
      collapseToOrb();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        manuallyCollapseToOrb(true);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [collapseToOrb, compactOpen, expanded, manuallyCollapseToOrb]);

  useEffect(() => {
    setLyricsFollowing(true);
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!expanded || !isMobile || mobilePane === 'player') return;
    mobilePaneHeadingRef.current?.focus({ preventScroll: true });
  }, [expanded, isMobile, mobilePane]);

  // 歌词自动滚动:当前行始终居中可见，并尊重系统“减少动态效果”设置。
  useEffect(() => {
    if (!expanded || isMobile || desktopPane !== 'lyrics' || !lyricsFollowing) return;
    const line = activeLyricRef.current;
    const box = lyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyricIndex, desktopPane, expanded, isMobile, lyricsFollowing, prefersReducedMotion]);

  useEffect(() => {
    if (!expanded || !isMobile || mobilePane !== 'lyrics' || !lyricsFollowing) return;
    const line = mobileActiveLyricRef.current;
    const box = mobileLyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyricIndex, expanded, isMobile, lyricsFollowing, mobilePane, prefersReducedMotion]);

  const routeBlocksPlayerSurface =
    pathname.startsWith('/agent/workspace') ||
    pathname.startsWith('/team-chat') ||
    pathname.startsWith('/reader/');

  useEffect(() => {
    if (routeBlocksPlayerSurface && expanded) setExpanded(false);
  }, [expanded, routeBlocksPlayerSurface, setExpanded]);

  const surface = resolveMusicPlayerSurface({
    canRender: canRender && Boolean(currentTrack),
    hasPlaybackSession,
    routeBlocked: routeBlocksPlayerSurface,
    playbackSurfaceVisible,
    compactOpen,
    expanded,
  });
  const floatingDensity = surface === 'orb'
    ? 'minimized'
    : surface === 'immersive'
      ? 'expanded'
      : 'compact';

  useEffect(() => {
    if (surface === 'orb' || surface === 'compact') focusPendingSurface();
  }, [focusPendingSurface, surface]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // 形变窗口:只在密度真正切换的这几百毫秒内挂 will-change 并把两层高斯半径砍
  // 半。常驻 will-change 会让浏览器长期为浮岛保留合成层预算,在低端机上反过来
  // 拖垮页面滚动 —— 这就是「只在需要时申报」而不是「一直申报」的原因。
  useEffect(() => {
    const previousDensity = previousDensityRef.current;
    previousDensityRef.current = floatingDensity;
    if (previousDensity === null || previousDensity === floatingDensity) return;
    if (prefersReducedMotion) {
      // 形变中途开启「减少动态效果」时,上一轮 effect 的 cleanup 会清掉那个
      // 唯一负责复位的定时器,而本轮又直接返回 —— morphing 会永久停在 true,
      // will-change 与降级滤镜跟着常驻到刷新为止,恰好是本机制要避免的那件事。
      setMorphing(false);
      return;
    }
    setMorphing(true);
    const timer = window.setTimeout(() => setMorphing(false), MUSIC_MORPH_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [floatingDensity, prefersReducedMotion]);

  if (!currentTrack) return null;
  const activeLine = activeLyricIndex >= 0 ? lyrics[activeLyricIndex]?.text : '';
  const playlistName = player?.playlist?.name || '音乐大厅';
  const currentPresentation = resolveMusicTrackPresentation(currentTrack);
  const artistLabel = currentPresentation.artist || meaningfulMusicText(currentTrack.album);
  const compactArtistLabel = artistLabel || playlistName;
  const currentCover = resolveMusicCoverSrc(currentTrack);
  const currentThumbnail = resolveMusicCoverSrc(currentTrack, '', 'thumbnail');
  const persistentCover = currentThumbnail || currentCover;
  const mobilePaneTransport = (
    <div className="grid grid-cols-3 items-center justify-items-center border-t border-[var(--music-stroke)] py-3">
      <button type="button" onClick={goToPreviousTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
        <SkipBack className="h-7 w-7 fill-current" strokeWidth={1.5} />
      </button>
      <button type="button" onClick={playbackError ? () => void retryPlayback() : togglePlayback} className="music-control-button music-transport-button music-transport-button--primary grid h-16 w-16 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}>
        {isBuffering ? <RefreshCw className="h-8 w-8 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-9 w-9 fill-current" strokeWidth={1.5} /> : <Play className="h-9 w-9 translate-x-px fill-current" strokeWidth={1.5} />}
      </button>
      <button type="button" onClick={goToNextTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
        <SkipForward className="h-7 w-7 fill-current" strokeWidth={1.5} />
      </button>
    </div>
  );

  // AnimatePresence 的 custom 在「子节点已从树上摘掉」的那一次渲染里求值,所以
  // 它是唯一能让退场动画分辨「交接给沉浸台」与「真正收起」的通道 —— 组件自身的
  // props 此时读到的还是上一帧(那时 surface 仍是 compact)。
  // 交接只在触屏成立:指针端沉浸态仍留在同一个壳体里,壳体根本不会卸载。
  const islandExitIntent = surface === 'immersive' && isMobile;
  const islandMotion = resolveMusicIslandMotion(isMobile, prefersReducedMotion);

  return (
    <LayoutGroup id="persistent-music-player">
      <>
      <AnimatePresence custom={islandExitIntent} initial={false} onExitComplete={focusPendingSurface}>
        {(surface === 'orb' || surface === 'compact' || (surface === 'immersive' && !isMobile)) && (
          <motion.section
            key="music-floating-shell"
            ref={compactPanelRef}
            drag={surface === 'compact' && !prefersReducedMotion ? 'y' : false}
            dragControls={compactDragControls}
            dragListener={false}
            dragMomentum={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.58 }}
            onDragStart={() => {
              compactGestureRef.current = true;
              registerCompactInteraction();
            }}
            onDragEnd={(_, info) => handleCompactCollapseGesture(info)}
            data-music-skin={skin}
            data-music-floating-root
            data-music-floating-density={floatingDensity}
            data-music-morphing={morphing ? 'true' : undefined}
            data-music-playing={isPlaying ? 'true' : 'false'}
            data-music-compact-player={surface === 'compact' ? '' : undefined}
            aria-label={floatingDensity === 'expanded' ? '展开的音乐播放器' : floatingDensity === 'compact' ? '迷你播放器' : '灵动音乐元'}
            className="music-floating-player-root pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] z-[70] overflow-visible text-[var(--ink-primary)] max-[360px]:left-[max(0.75rem,env(safe-area-inset-left))] max-[360px]:right-[max(0.75rem,env(safe-area-inset-right))] min-[769px]:bottom-8 min-[769px]:left-8 min-[769px]:right-auto"
            style={{ y: compactDragY, originX: 0, originY: 1 }}
            custom={islandExitIntent}
            variants={musicIslandVariants}
            initial={islandMotion.initial}
            animate={islandMotion.animate}
            exit={islandMotion.exit}
            onPointerEnter={() => {
              if (surface === 'compact') setCompactPointerInside(true);
            }}
            onPointerLeave={() => setCompactPointerInside(false)}
            onPointerDown={() => {
              compactInputModalityRef.current = 'pointer';
              setCompactFocusWithin(false);
              if (surface === 'compact') registerCompactInteraction();
            }}
            onFocusCapture={() => {
              if (surface === 'compact' && compactInputModalityRef.current === 'keyboard') setCompactFocusWithin(true);
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setCompactFocusWithin(false);
              }
            }}
          >
            <div
              data-music-floating-shell
              aria-hidden="true"
              className="music-floating-player-surface pointer-events-auto absolute inset-0"
            >
              {persistentCover && (
                <span className="music-floating-ambient" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 壳体内封面氛围光,高斯化装饰渲染 */}
                  <img src={persistentCover} alt="" draggable={false} />
                </span>
              )}
            </div>

            <motion.button
              ref={surfaceTriggerRef}
              type="button"
              data-music-floating-artwork
              data-music-island-cover
              data-music-playback-orb={floatingDensity === 'minimized' ? '' : undefined}
              data-playing={isPlaying ? 'true' : 'false'}
              data-buffering={isBuffering ? 'true' : 'false'}
              drag={surface === 'compact' && !prefersReducedMotion ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              dragMomentum={false}
              // 封面是浮岛上最大的命中区,却是唯一没有按压反馈的控件 —— 触屏上
              // 「按下去有没有响应」全靠这一下。指针端不给:那边有 hover 态可
              // 依赖,且本轮是移动端改造,不该顺手改掉桌面的点击手感。
              whileTap={isMobile && !prefersReducedMotion ? { scale: 0.94, transition: spring.precise } : undefined}
              onDragStart={() => {
                compactGestureRef.current = true;
                registerCompactInteraction();
              }}
              onDragEnd={(_, info) => handleTrackGesture(info)}
              onClick={(event) => {
                if (floatingDensity === 'minimized') {
                  compactGestureRef.current = false;
                  if (event.detail === 0) pendingSurfaceFocusRef.current = 'compact';
                  compactDragY.set(0);
                  openCompactSurface();
                  registerCompactInteraction();
                  return;
                }
                if (compactGestureRef.current) return;
                if (floatingDensity === 'compact') {
                  openImmersivePlayer();
                  return;
                }
                if (playbackError) {
                  void retryPlayback();
                } else {
                  togglePlayback();
                }
              }}
              className="music-playback-orb music-floating-artwork-button music-island-cover pointer-events-auto absolute z-20 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              aria-label={floatingDensity === 'minimized'
                ? playbackError
                  ? `播放失败，打开迷你播放器重试：${currentPresentation.title}`
                  : `打开迷你播放器：${currentPresentation.title}`
                : floatingDensity === 'compact'
                  ? `打开沉浸播放器：${currentPresentation.title}，${compactArtistLabel}`
                  : playbackError
                    ? '重新尝试播放'
                    : isPlaying
                      ? '暂停音乐'
                      : '播放音乐'}
              tabIndex={floatingDensity === 'compact' ? -1 : undefined}
              aria-hidden={floatingDensity === 'compact' ? true : undefined}
              title={floatingDensity === 'minimized' ? '打开迷你播放器' : floatingDensity === 'compact' ? '打开沉浸播放器' : isPlaying ? '暂停音乐' : '播放音乐'}
              style={{
                ['--music-orb-progress' as string]: `${percent * 3.6}deg`,
                touchAction: floatingDensity === 'minimized' ? 'manipulation' : 'pan-y pinch-zoom',
              }}
            >
              <span className="music-playback-orb__progress music-island-cover-ring" aria-hidden="true" />
              <span className="music-playback-orb__artwork music-island-cover-image" aria-hidden="true">
                {persistentCover ? (
                  <Image
                    data-music-island-cover-pixels
                    src={persistentCover}
                    alt=""
                    width={120}
                    height={120}
                    sizes="120px"
                    className="music-island-cover-pixels object-cover"
                    draggable={false}
                    unoptimized
                  />
                ) : (
                  <Music2 className="music-island-cover-fallback" strokeWidth={1.8} />
                )}
                {(playbackError || isBuffering) && (
                  <span className="music-playback-orb__status">
                    {playbackError
                      ? <AlertCircle className="h-[18px] w-[18px]" />
                      : <RefreshCw className="h-[18px] w-[18px] animate-spin" />}
                  </span>
                )}
              </span>
            </motion.button>

            <button
              ref={compactIdentityTriggerRef}
              type="button"
              data-music-island-identity
              data-music-compact-focus-target
              onClick={(event) => {
                if (floatingDensity === 'minimized') {
                  if (event.detail === 0) pendingSurfaceFocusRef.current = 'compact';
                  openCompactSurface();
                  registerCompactInteraction();
                } else if (floatingDensity === 'compact') {
                  openImmersivePlayer();
                } else {
                  closeExpandedPlayer();
                }
              }}
              tabIndex={isMobile && floatingDensity === 'minimized' ? -1 : undefined}
              aria-hidden={isMobile && floatingDensity === 'minimized' ? true : undefined}
              aria-label={floatingDensity === 'expanded'
                ? `收起播放器：${currentPresentation.title}，${compactArtistLabel}`
                : floatingDensity === 'compact'
                  ? `打开沉浸播放器：${currentPresentation.title}，${compactArtistLabel}`
                  : `展开迷你播放器：${currentPresentation.title}，${compactArtistLabel}`}
              className="music-island-identity pointer-events-auto absolute z-10 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
            >
              <span className="music-island-eyebrow flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--aurora-1)]">
                <Disc3 className="h-3 w-3 shrink-0" />
                <span className="truncate">{playlistName}</span>
              </span>
              <span className="music-island-title block truncate font-bold leading-5 text-[var(--ink-primary)]">{currentPresentation.title}</span>
              {/* 曲序不参与截断:艺人名一长,原先整行一起 truncate 会把「第几首 /
                  共几首」整个吃掉 —— 而那恰恰是浮岛上最需要一眼看到的定位信息。
                  拆成 min-w-0 的艺人 + shrink-0 的等宽曲序,长名只压艺人。 */}
              <span className={cn('music-island-meta flex min-w-0 items-center gap-1.5 leading-4', playbackError ? 'font-semibold text-[var(--signal-danger)]' : 'text-[var(--ink-muted)]')}>
                {playbackError ? (
                  <span className="min-w-0 truncate">{playbackError}</span>
                ) : isBuffering ? (
                  <span className="min-w-0 truncate">正在载入…</span>
                ) : (
                  <>
                    {isPlaying && <NowPlayingGlyph className="music-island-wave shrink-0" />}
                    <span className="min-w-0 truncate">{compactArtistLabel}</span>
                    <span className="music-island-count tnum shrink-0 font-mono">{currentIndex + 1}/{tracks.length}</span>
                  </>
                )}
              </span>
            </button>

            <div data-music-island-transport aria-hidden={isMobile && floatingDensity === 'minimized' ? true : undefined} inert={isMobile && floatingDensity === 'minimized'} className="music-island-transport pointer-events-auto absolute z-10 grid grid-cols-[44px_48px_44px] items-center gap-3">
              <button type="button" onClick={goToPreviousTrack} className="music-control-button music-icon-button music-island-transport-previous grid h-11 w-11 place-items-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
                <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={playbackError ? () => void retryPlayback() : togglePlayback}
                className="music-control-button music-icon-button music-icon-button--tinted music-island-transport-play grid h-12 w-12 place-items-center rounded-full text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label={playbackError ? '重新尝试播放' : isBuffering ? '取消载入' : isPlaying ? '暂停音乐' : '播放音乐'}
              >
                {isBuffering ? <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.8} /> : isPlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
              </button>
              <button type="button" onClick={goToNextTrack} className="music-control-button music-icon-button music-island-transport-next grid h-11 w-11 place-items-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
              </button>
            </div>

            <div data-music-island-progress aria-hidden={floatingDensity === 'minimized' ? true : undefined} inert={floatingDensity === 'minimized'} className="music-island-progress pointer-events-auto absolute z-10 flex items-center gap-2.5">
              <span className="music-island-progress-time shrink-0 text-[10px] tnum text-[var(--ink-muted)]">{formatMusicClock(progress)}</span>
              <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="sm" className="min-w-0 flex-1" />
              <span className="music-island-progress-time shrink-0 text-[10px] tnum text-[var(--ink-muted)]">{formatMusicClock(duration || currentTrack?.durationSeconds || 0)}</span>
            </div>

            <div data-music-island-actions className="music-island-actions pointer-events-auto absolute z-20 flex items-center gap-1">
              <button type="button" data-music-density-toggle onClick={(event) => {
                openImmersivePlayer();
                if (!isMobile && event.detail === 0) focusPersistentIdentityAfterDensityChange();
              }} tabIndex={floatingDensity === 'compact' ? 0 : -1} aria-hidden={floatingDensity === 'compact' ? undefined : true} className="music-control-button music-icon-button music-island-action music-island-action--expand grid h-11 w-11 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="打开沉浸播放器">
                <ChevronUp className="h-[19px] w-[19px]" strokeWidth={1.8} />
              </button>
              <button type="button" onClick={(event) => {
                closeExpandedPlayer();
                if (!isMobile && event.detail === 0) focusPersistentIdentityAfterDensityChange();
              }} tabIndex={floatingDensity === 'expanded' ? 0 : -1} aria-hidden={floatingDensity === 'expanded' ? undefined : true} className="music-control-button music-icon-button music-island-action music-island-action--collapse grid h-11 w-11 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="收起播放器">
                <ChevronDown className="h-[19px] w-[19px]" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onPointerDown={(event) => {
                  if (!prefersReducedMotion && floatingDensity === 'compact') compactDragControls.start(event);
                  registerCompactInteraction();
                }}
                onClick={(event) => {
                  if (!compactGestureRef.current) manuallyCollapseToOrb(event.detail === 0);
                }}
                tabIndex={floatingDensity === 'minimized' ? -1 : 0}
                aria-hidden={floatingDensity === 'minimized' ? true : undefined}
                className="music-control-button music-icon-button music-island-action music-island-action--minimize grid h-11 w-11 touch-none place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label="收起为灵动音乐元；下滑也可收起"
                title="最小化播放器"
              >
                <Minus className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
              <button type="button" data-dismiss-music-player onClick={dismissPlayer} tabIndex={floatingDensity === 'minimized' ? -1 : 0} aria-hidden={floatingDensity === 'minimized' ? true : undefined} className="music-control-button music-icon-button music-island-action music-island-action--close grid h-11 w-11 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="停止播放并关闭播放器">
                <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            </div>

            <section
              data-music-island-expanded-detail
              aria-hidden={floatingDensity !== 'expanded'}
              inert={floatingDensity !== 'expanded'}
              className="music-island-expanded-detail pointer-events-auto absolute z-10 flex min-h-0 flex-col overflow-hidden"
            >
              <div className="music-island-detail-header flex shrink-0 items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 pb-2">
                <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">{desktopPane === 'lyrics' ? '歌词' : `${tracks.length} 首`}</p>
                <div role="tablist" aria-label="播放详情" className="grid shrink-0 grid-cols-2 gap-1 rounded-[var(--music-radius-control)] bg-[var(--music-control-fill)] p-1">
                  <button ref={desktopLyricsTabRef} id="desktop-lyrics-tab" type="button" role="tab" aria-selected={desktopPane === 'lyrics'} aria-controls="desktop-lyrics-panel" tabIndex={desktopPane === 'lyrics' ? 0 : -1} onClick={() => setDesktopPane('lyrics')} onKeyDown={handleDesktopPaneKeyDown} className={cn('music-control-button inline-flex min-h-11 items-center gap-1.5 rounded-[calc(var(--music-radius-control)-0.2rem)] px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', desktopPane === 'lyrics' ? 'bg-[var(--music-control-fill-hover)] text-[var(--ink-primary)]' : 'text-[var(--ink-muted)]')}>
                    <Music2 className="h-4 w-4" />歌词
                  </button>
                  <button ref={desktopQueueTabRef} id="desktop-queue-tab" type="button" role="tab" aria-selected={desktopPane === 'queue'} aria-controls="desktop-queue-panel" tabIndex={desktopPane === 'queue' ? 0 : -1} onClick={() => setDesktopPane('queue')} onKeyDown={handleDesktopPaneKeyDown} className={cn('music-control-button inline-flex min-h-11 items-center gap-1.5 rounded-[calc(var(--music-radius-control)-0.2rem)] px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', desktopPane === 'queue' ? 'bg-[var(--music-control-fill-hover)] text-[var(--ink-primary)]' : 'text-[var(--ink-muted)]')}>
                    <ListMusic className="h-4 w-4" />队列
                  </button>
                </div>
              </div>
              {desktopPane === 'lyrics' ? (
                <section id="desktop-lyrics-panel" role="tabpanel" aria-labelledby="desktop-lyrics-tab" className="relative min-h-0 flex-1">
                  {!lyricsFollowing && (
                    <button type="button" onClick={() => setLyricsFollowing(true)} className="music-control-button music-pill-button absolute right-1 top-2 z-10 min-h-11 bg-[var(--music-control-fill)] px-3 text-xs font-semibold text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">回到当前歌词</button>
                  )}
                  <div ref={lyricsBoxRef} onPointerDown={() => setLyricsFollowing(false)} onWheel={() => setLyricsFollowing(false)} className="music-island-detail-scroll music-island-lyrics-scroll h-full space-y-1 overflow-y-auto overscroll-contain px-3 py-3 pr-1.5">
                    {lyrics.length === 0 ? (
                      <div className="flex min-h-full flex-col items-center justify-center text-center text-[var(--ink-muted)]">
                        <Music2 className="h-6 w-6" aria-hidden="true" />
                        <p className="mt-2 text-xs font-semibold text-[var(--ink-secondary)]">这首歌暂时没有歌词，先让旋律继续。</p>
                      </div>
                    ) : (
                      <MemoizedMusicLyricRows lines={lyrics} activeIndex={activeLyricIndex} activeRef={activeLyricRef} onSeek={seekToTime} onResumeFollowing={resumeLyricsFollowing} variant="desktop" />
                    )}
                  </div>
                </section>
              ) : (
                <section id="desktop-queue-panel" role="tabpanel" aria-labelledby="desktop-queue-tab" className="music-island-detail-scroll music-island-queue-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
                  <MemoizedMusicQueueRows tracks={tracks} currentIndex={currentIndex} hasPlaybackSession={hasPlaybackSession} isPlaying={isPlaying} isBuffering={isBuffering} playbackError={playbackError} playlistName={playlistName} onPlayIndex={playIndex} onRetryPlayback={retryPlayback} onTogglePlayback={togglePlayback} variant="desktop" />
                </section>
              )}
            </section>

            <div
              data-music-island-toolbar
              aria-hidden={floatingDensity !== 'expanded'}
              inert={floatingDensity !== 'expanded'}
              className="music-island-toolbar pointer-events-none absolute z-10 flex items-center justify-between gap-3"
            >
              <div className="pointer-events-auto flex min-w-0 items-center gap-0.5 text-[var(--ink-muted)]">
                <button type="button" onClick={() => setShuffle((selected) => !selected)} className={cn('music-control-button music-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]', shuffle ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]')} data-selected={shuffle ? 'true' : 'false'} aria-label="随机播放" aria-pressed={shuffle}>
                  <Shuffle className="h-[17px] w-[17px]" />
                </button>
                <label className="music-island-volume flex h-11 w-40 min-w-0 items-center gap-2 px-1">
                  <Volume2 className="h-4 w-4 shrink-0" />
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="music-volume-range h-11 min-w-0 flex-1 appearance-none bg-transparent" aria-label="音量" />
                </label>
              </div>
              <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
                <Link href="/music" onClick={closeExpandedPlayer} className="music-control-button music-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="进入音乐大厅" title="进入音乐大厅">
                  <LibraryBig className="h-[18px] w-[18px]" />
                </Link>
                <button type="button" data-dismiss-music-player onClick={dismissPlayer} className="music-control-button music-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="停止播放并关闭播放器" title="停止播放并关闭播放器">
                  <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </button>
              </div>
            </div>

            {floatingDensity !== 'minimized' && activeLine && (
              <span className="sr-only" aria-live="polite">{activeLine}</span>
            )}
            {playbackError && <span role="alert" className="sr-only">音乐播放失败，请打开播放器重试。</span>}
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
      {surface === 'immersive' && isMobile && (
        <motion.div
          ref={mobileDialogRef}
          data-music-skin={skin}
          role="dialog"
          aria-modal="true"
          aria-label="音乐播放器"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? musicMotion.duration.reduced : musicMotion.duration.dialog, ease: musicMotion.ease.glide }}
          className="fixed inset-0 z-[70] h-[100dvh] overflow-hidden text-[var(--ink-primary)]"
        >
          <motion.div
            onClick={closeExpandedPlayer}
            aria-hidden="true"
            className="absolute inset-0 cursor-default bg-[color-mix(in_oklch,var(--bg-void)_82%,transparent)]"
            style={{ opacity: mobileBackdropOpacity }}
          />
          <motion.section
            drag={prefersReducedMotion ? false : 'y'}
            dragControls={immersiveDragControls}
            dragListener={false}
            dragMomentum={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.015, bottom: 0.62 }}
            onDragStart={() => {
              immersiveGestureRef.current = true;
            }}
            onDragEnd={(_, info) => handleImmersiveCollapseGesture(info)}
            onAnimationComplete={() => {
              // 收起动画跑完才忘掉原点 —— 提前清会让正在进行的回收动画中途丢掉
              // transform-origin。清掉之后,下一次若不是从浮岛展开(音乐大厅的
              // 正在播放条、Profile 卡的 openPlayer 都是直接 setExpanded(true),
              // 不经过 openImmersivePlayer),台面就回落到居中放大,而不是从一个
              // 与本次触发毫无关系的左下角旧坐标窜出来。
              // 读 ref 而非闭包里的 expanded:退场时渲染的是 AnimatePresence 缓存
              // 的那一帧元素,其闭包里 expanded 仍为 true。
              if (!expandedRef.current) setSheetOrigin(null);
            }}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: musicMotion.island.sheetZoomFrom }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: musicMotion.island.sheetZoomFrom }}
            transition={prefersReducedMotion
              ? { duration: musicMotion.duration.reduced }
              : { scale: musicMotion.spring.sheetZoom, opacity: { duration: musicMotion.duration.veil, ease: musicMotion.ease.emphasis } }}
            style={{
              y: immersiveDragY,
              // 沉浸台自浮岛原位放大。transform-origin 是元素自身坐标系,而
              // sheetOrigin 记的是视口坐标 —— 中间差的正好是台面的左 / 上内缩,
              // 那两个值恰好就是本元素的 left / top 内联量,于是用 calc() 原样
              // 减掉即可,不必再测一次台面尺寸。
              transformOrigin: sheetOrigin
                ? `calc(${sheetOrigin.x}px - max(0.75rem, env(safe-area-inset-left))) calc(${sheetOrigin.y}px - max(0.5rem, env(safe-area-inset-top)))`
                : undefined,
            }}
            className="music-mobile-player-sheet absolute bottom-0 left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] flex min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,color-mix(in_oklch,var(--aurora-1)_10%,var(--bg-raised)),var(--bg-void)_72%)] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {currentCover && (
              <div className="music-mobile-player-backdrop pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <Image src={currentCover} alt="" fill sizes="100vw" className="scale-110 object-cover opacity-[0.26] blur-3xl saturate-150" unoptimized />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--bg-void)_22%,transparent),color-mix(in_oklch,var(--bg-void)_88%,transparent)_86%)]" />
              </div>
            )}

            <header data-mobile-player-header className="relative z-10 grid min-h-12 grid-cols-[44px_minmax(0,1fr)_44px] items-center px-2 pt-1">
              <button
                type="button"
                data-mobile-player-density-toggle={mobilePane === 'player' ? '' : undefined}
                onPointerDown={(event) => {
                  if (mobilePane === 'player' && !prefersReducedMotion) immersiveDragControls.start(event);
                }}
                onClick={() => {
                  if (immersiveGestureRef.current) return;
                  if (mobilePane === 'player') closeExpandedPlayer();
                  else setMobilePane('player');
                }}
                className="music-control-button music-icon-button grid h-11 w-11 touch-none place-items-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                aria-label={mobilePane === 'player' ? '收起为迷你播放器；下滑也可收起' : '返回正在播放'}
              >
                {mobilePane === 'player' ? <ChevronDown className="h-6 w-6" strokeWidth={1.8} /> : <ChevronLeft className="h-6 w-6" />}
              </button>
              <div className="min-w-0 text-center" aria-live="polite" aria-atomic="true">
                <p className="truncate text-[11px] font-semibold text-[var(--ink-secondary)]">
                  {mobilePane === 'player' ? playlistName : mobilePane === 'lyrics' ? '歌词' : '播放队列'}
                </p>
                <p className="mt-0.5 truncate text-[10px] tnum text-[var(--ink-muted)]">
                  {mobilePane === 'player' ? `${currentPresentation.title} · ${currentIndex + 1} / ${tracks.length}` : mobilePane === 'lyrics' ? currentPresentation.title : `${tracks.length} 首`}
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

            <AnimatePresence initial={false} mode="popLayout">
            {mobilePane === 'player' ? (
            <motion.div
              key="mobile-player-pane"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: prefersReducedMotion ? musicMotion.duration.reduced : musicMotion.duration.pane, ease: musicMotion.ease.glide }}
              className="relative z-10 mx-auto flex min-h-0 w-full max-w-[26rem] flex-1 flex-col overflow-y-auto overscroll-contain px-5"
            >
              <motion.div
                data-now-playing-artwork
                drag={prefersReducedMotion ? false : 'x'}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                dragMomentum={false}
                onDragStart={() => {
                  compactGestureRef.current = true;
                  registerCompactInteraction();
                }}
                onDragEnd={(_, info) => handleImmersiveSurfaceGesture(info)}
                style={{ touchAction: 'pan-y pinch-zoom' }}
                className={cn(
                  'flex justify-center',
                  currentCover
                    ? 'music-mobile-player-artwork-frame min-h-0 flex-1 items-center py-4'
                    : 'items-start pb-6 pt-5',
                )}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={currentTrack.id}
                    initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: artworkDirection * 28, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: artworkDirection * -22, scale: 0.97 }}
                    transition={{ duration: prefersReducedMotion ? musicMotion.duration.reduced : musicMotion.duration.swap, ease: musicMotion.ease.glide }}
                    className="flex w-full justify-center"
                  >
                    <MusicArtwork
                      track={currentTrack}
                      size="hero"
                      className={cn(
                        currentCover
                          ? 'music-mobile-player-artwork w-[min(100cqw,100cqh,40dvh,23rem)]'
                          : 'w-[min(42%,10rem)]',
                      )}
                      sizes="(max-width: 768px) calc(100vw - 4rem), 23rem"
                      showFallbackLabel={!currentCover}
                    />
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              {/* 整屏台面上还 truncate 标题是浪费:两行 + balance 让长曲名断在
                  语义处而不是被砍掉。tracking 从 -0.025em 放宽到 -0.015em ——
                  前者是给拉丁大标题的收紧量,压在 CJK 上会糊成一片。 */}
              <div data-now-playing-track-info className="min-w-0 text-left">
                <h2 className="music-mobile-player-title line-clamp-2 text-[1.4rem] font-bold leading-[1.28] tracking-[-0.015em] text-[var(--ink-primary)]" title={currentPresentation.title}>{currentPresentation.title}</h2>
                {artistLabel && <p className="mt-1.5 truncate text-[15px] font-medium text-[var(--ink-secondary)]" title={artistLabel}>{artistLabel}</p>}
                {activeLine && <p data-now-playing-active-line className="mt-2 line-clamp-1 text-[13px] leading-snug text-[var(--ink-secondary)]">{activeLine}</p>}
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
                <button type="button" onClick={goToPreviousTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="上一首">
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
                <button type="button" onClick={goToNextTrack} className="music-control-button music-transport-button grid h-14 w-14 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="下一首">
                  <SkipForward className="h-8 w-8 fill-current" strokeWidth={1.5} />
                </button>
              </div>

              <label data-now-playing-volume className="music-mobile-player-volume mt-3 flex h-11 items-center gap-3 text-[var(--ink-muted)]">
                <Volume2 className="h-4 w-4 shrink-0" />
                <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="music-volume-range h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-[var(--ink-primary)]" aria-label="音量" />
              </label>

              <div data-now-playing-tools className="music-mobile-player-tools mt-auto grid grid-cols-4 border-t border-[var(--music-stroke)] pt-2">
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
                <Link href="/music" onClick={closeExpandedPlayer} className="music-control-button music-icon-button mx-auto grid h-12 w-12 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]" aria-label="进入音乐大厅">
                  <LibraryBig className="h-[21px] w-[21px]" strokeWidth={1.7} />
                  <span className="sr-only">进入音乐大厅</span>
                </Link>
              </div>
            </motion.div>
            ) : mobilePane === 'lyrics' ? (
              <motion.div
                key="mobile-lyrics-pane"
                data-mobile-lyrics-pane
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: prefersReducedMotion ? musicMotion.duration.reduced : musicMotion.duration.pane, ease: musicMotion.ease.glide }}
                className="relative z-10 mx-auto flex min-h-0 w-full max-w-[26rem] flex-1 flex-col px-6 pt-4"
              >
                <h2 ref={mobilePaneHeadingRef} tabIndex={-1} className="sr-only">歌词</h2>
                <div className="flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-4">
                  <MusicArtwork track={currentTrack} className="h-14 w-14" sizes="56px" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-[var(--ink-primary)]">{currentPresentation.title}</h2>
                    <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{compactArtistLabel}</p>
                  </div>
                  {!lyricsFollowing && (
                    <button type="button" onClick={() => setLyricsFollowing(true)} className="music-control-button music-pill-button ml-auto min-h-11 shrink-0 bg-[var(--music-control-fill)] px-3 text-xs font-semibold text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">
                      回到当前歌词
                    </button>
                  )}
                </div>
                <div
                  ref={mobileLyricsBoxRef}
                  onPointerDown={() => setLyricsFollowing(false)}
                  onWheel={() => setLyricsFollowing(false)}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-6 pr-1"
                >
                  {lyrics.length === 0 ? (
                    <div className="flex min-h-[16rem] flex-col items-center justify-center text-center text-[var(--ink-muted)]">
                      <Music2 className="h-7 w-7" aria-hidden="true" />
                      <p className="mt-4 text-sm font-semibold text-[var(--ink-secondary)]">这首歌暂时没有歌词，先让旋律继续。</p>
                    </div>
                  ) : (
                    <MemoizedMusicLyricRows
                      lines={lyrics}
                      activeIndex={activeLyricIndex}
                      activeRef={mobileActiveLyricRef}
                      onSeek={seekToTime}
                      onResumeFollowing={resumeLyricsFollowing}
                      variant="mobile"
                    />
                  )}
                </div>
                {mobilePaneTransport}
              </motion.div>
            ) : (
              <motion.div
                key="mobile-queue-pane"
                data-mobile-queue-pane
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: prefersReducedMotion ? musicMotion.duration.reduced : musicMotion.duration.pane, ease: musicMotion.ease.glide }}
                className="relative z-10 mx-auto flex min-h-0 w-full max-w-[30rem] flex-1 flex-col px-5 pt-4"
              >
                <h2 ref={mobilePaneHeadingRef} tabIndex={-1} className="sr-only">播放队列</h2>
                <div className="flex items-end justify-between gap-3 pb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--ink-muted)]">接下来播放</p>
                    <h2 className="mt-1 truncate text-xl font-black text-[var(--ink-primary)]" title={playlistName}>{playlistName}</h2>
                  </div>
                  <span className="shrink-0 text-xs tnum text-[var(--ink-muted)]">{tracks.length} 首</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[color-mix(in_oklch,var(--ink-primary)_9%,transparent)]">
                  <MemoizedMusicQueueRows
                    tracks={tracks}
                    currentIndex={currentIndex}
                    hasPlaybackSession={hasPlaybackSession}
                    isPlaying={isPlaying}
                    isBuffering={isBuffering}
                    playbackError={playbackError}
                    playlistName={playlistName}
                    onPlayIndex={playIndex}
                    onRetryPlayback={retryPlayback}
                    onTogglePlayback={togglePlayback}
                    variant="mobile"
                  />
                </div>
                {mobilePaneTransport}
              </motion.div>
            )}
            </AnimatePresence>
          </motion.section>
        </motion.div>
      )}
      </AnimatePresence>

      </>
    </LayoutGroup>
  );
}
