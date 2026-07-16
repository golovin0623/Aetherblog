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
  type CSSProperties,
  type ReactNode,
} from 'react';
import { animate, AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'framer-motion';
import { Disc3, ListMusic, Maximize2, Minimize2, Minus, Music2, Pause, Play, RefreshCw, SkipBack, SkipForward, X } from 'lucide-react';
import { duration as motionDuration, ease, spring, transition } from '@aetherblog/ui';
import { useMediaQuery } from '@aetherblog/hooks';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import {
  resolveAdminPlayerAutoCollapseDelay,
  resolveAdminPlayerAutoMinimizeDelay,
  resolveAdminPlayerDensityTransition,
  resolveAdminPlayerViewportCorrection,
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  isAdminPlaybackRequestCurrent,
  parseAdminMusicLyric,
  shouldCommitAdminAudioEvent,
  type AdminMusicLyricLine,
  resolveAdminPlayerGesture,
  resolveAdminMediaErrorMessage,
  type AdminPlayerDensity,
} from './adminMusicPlayerState';
import {
  createAdminMusicQueueState,
  isSameAdminMusicQueueSource,
  reconcileAdminMusicQueue,
  removeAdminMusicQueueTrack,
  replaceAdminMusicQueueTrack,
  type AdminMusicQueueState,
  type AdminMusicQueueSource,
} from './adminMusicQueueState';

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function normalizeAdminPlaybackUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, document.baseURI).href;
  } catch {
    return rawUrl;
  }
}

function activeLyricIndex(lines: AdminMusicLyricLine[], progress: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    if (t == null) continue;
    if (t <= progress + 0.15) idx = i;
    if (t > progress) break;
  }
  return idx;
}

const ADMIN_PLAYER_DOCK_POSITION_KEY = 'aetherblog.admin.music-player.position';
const ADMIN_PLAYER_DESKTOP_EDGE_MARGIN = 20;
const ADMIN_PLAYER_MOBILE_EDGE_MARGIN = 12;
const ADMIN_PLAYER_MINIMIZED_RADIUS = 30;
const ADMIN_PLAYER_MOBILE_MINIMIZED_RADIUS = 26;
const ADMIN_PLAYER_PANEL_RADIUS = 24;
const ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION = {
  duration: motionDuration.instant / 2,
  ease: ease.out,
} as const;
const ADMIN_PLAYER_COMPACT_MINIMIZED_ACTION_ENTER_DELAY = motionDuration.instant;
const ADMIN_PLAYER_EXPANDED_MINIMIZED_ACTION_ENTER_DELAY = (
  motionDuration.instant + motionDuration.quick
) / 2;

interface AdminMusicPlayerContextValue {
  queue: readonly MusicTrack[];
  queueSource: AdminMusicQueueSource;
  currentTrack?: MusicTrack;
  currentIndex: number;
  isPlaying: boolean;
  playbackError: string | null;
  playTracks: (tracks: MusicTrack[], index: number, source?: AdminMusicQueueSource, label?: string) => void;
  togglePlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  seekToPercent: (percent: number) => void;
  retryPlayback: () => Promise<void>;
  closePlayer: () => void;
  replaceQueueTrack: (track: MusicTrack) => void;
  removeQueueTrack: (trackId: number, expectedSource?: AdminMusicQueueSource) => void;
  reconcileQueue: (tracks: readonly MusicTrack[], source: AdminMusicQueueSource) => void;
  updateQueueSourceLabel: (source: AdminMusicQueueSource, label: string) => void;
  setMusicSkin: (value: string, seed?: string) => void;
  /** 页面级抑制浮层(如音乐管理页已有内嵌播放卡,避免重复 + 遮挡) */
  setDockSuppressed: (suppressed: boolean) => void;
}

interface AdminMusicPlayerTimelineValue {
  progress: number;
  duration: number;
  percent: number;
}

const AdminMusicPlayerContext = createContext<AdminMusicPlayerContextValue | null>(null);
const AdminMusicPlayerTimelineContext = createContext<AdminMusicPlayerTimelineValue | null>(null);

export function useAdminMusicPlayer() {
  const context = useContext(AdminMusicPlayerContext);
  if (!context) {
    throw new Error('useAdminMusicPlayer must be used within AdminMusicPlayerProvider');
  }
  return context;
}

export function useAdminMusicPlayerTimeline() {
  const context = useContext(AdminMusicPlayerTimelineContext);
  if (!context) {
    throw new Error('useAdminMusicPlayerTimeline must be used within AdminMusicPlayerProvider');
  }
  return context;
}

export function AdminMusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const playbackRequestRef = useRef(0);
  const desiredTrackIdRef = useRef<number | null>(null);
  const desiredUrlRef = useRef('');
  const desiredPlayingRef = useRef(false);
  const sourceTransitionRef = useRef(false);
  const dragControls = useDragControls();
  const dockX = useMotionValue(0);
  const dockY = useMotionValue(0);
  const prefersReducedMotion = useReducedMotion();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const dockDraggedRef = useRef(false);
  // 记录当前已 load 进 <audio> 的 URL —— 用来判断「重新点同一首」与「切到新一首」,
  // 替代用 currentIndex 比对(换队列后旧 index 的语义已失效,会抢播旧 src)。
  const loadedUrlRef = useRef('');
  const loadedTrackIdRef = useRef<number | null>(null);
  const [queueState, setQueueState] = useState(() => createAdminMusicQueueState([], 0, { type: 'library' }));
  const [queueLabel, setQueueLabel] = useState('歌曲库 · 当前页');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerDensity, setPlayerDensity] = useState<AdminPlayerDensity>('compact');
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lyricsFollowing, setLyricsFollowing] = useState(true);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const [dockSuppressed, setDockSuppressedState] = useState(false);
  const [musicSkin, setMusicSkinState] = useState<{ value: string; seed?: string }>({ value: 'crimson' });
  const queue = queueState.queue;
  const currentIndex = queueState.currentIndex;
  const currentTrack = queueState.currentTrack;
  const expanded = playerDensity === 'expanded';
  const playerSurfaceRadius = playerDensity === 'minimized'
    ? (isMobile ? ADMIN_PLAYER_MOBILE_MINIMIZED_RADIUS : ADMIN_PLAYER_MINIMIZED_RADIUS)
    : ADMIN_PLAYER_PANEL_RADIUS;
  const audioUrl = resolveAdminAudioUrl(currentTrack);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const cover = currentTrack?.coverUrl || currentTrack?.media?.thumbnailUrl || '';

  const lyrics = useMemo(() => parseAdminMusicLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const activeLyric = useMemo(() => activeLyricIndex(lyrics, progress), [lyrics, progress]);

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const dockBoundsRef = useRef<HTMLDivElement>(null);
  const dockSurfaceRef = useRef<HTMLDivElement>(null);
  const densityToggleRef = useRef<HTMLButtonElement>(null);
  const minimizedTriggerRef = useRef<HTMLButtonElement>(null);
  const expandedHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusExpandedHeadingOnOpenRef = useRef(false);
  const playerReturnFocusRef = useRef<HTMLElement | null>(null);
  const minimizeSourceDensityRef = useRef<AdminPlayerDensity>('compact');
  const percentRef = useRef(percent);
  const inputModalityRef = useRef<'keyboard' | 'pointer'>('keyboard');
  percentRef.current = percent;
  const minimizedActionEnterDelay = minimizeSourceDensityRef.current === 'expanded'
    ? ADMIN_PLAYER_EXPANDED_MINIMIZED_ACTION_ENTER_DELAY
    : ADMIN_PLAYER_COMPACT_MINIMIZED_ACTION_ENTER_DELAY;

  const enterMinimizedDensity = useCallback((sourceDensity: AdminPlayerDensity) => {
    if (sourceDensity === 'minimized') return;
    minimizeSourceDensityRef.current = sourceDensity;
    setPlayerDensity('minimized');
  }, []);

  const persistDockPosition = useCallback(() => {
    try {
      window.localStorage.setItem(ADMIN_PLAYER_DOCK_POSITION_KEY, JSON.stringify({
        x: dockX.get(),
        y: dockY.get(),
      }));
    } catch {
      /* Position memory is a progressive enhancement. */
    }
  }, [dockX, dockY]);

  const settleDockWithinViewport = useCallback(() => {
    const surface = dockSurfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const edgeMargin = isMobile
      ? ADMIN_PLAYER_MOBILE_EDGE_MARGIN
      : ADMIN_PLAYER_DESKTOP_EDGE_MARGIN;
    const correction = resolveAdminPlayerViewportCorrection({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      edgeMargin,
    });
    if (correction.x === 0 && correction.y === 0) return;

    const nextX = dockX.get() + correction.x;
    const nextY = dockY.get() + correction.y;
    if (prefersReducedMotion) {
      dockX.set(nextX);
      dockY.set(nextY);
      persistDockPosition();
      return;
    }
    const xAnimation = animate(dockX, nextX, spring.precise);
    const yAnimation = animate(dockY, nextY, spring.precise);
    void Promise.all([xAnimation, yAnimation])
      .then(persistDockPosition)
      .catch(() => undefined);
  }, [dockX, dockY, isMobile, persistDockPosition, prefersReducedMotion]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ADMIN_PLAYER_DOCK_POSITION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && Number.isFinite(parsed.x)) dockX.set(parsed.x);
      if (typeof parsed.y === 'number' && Number.isFinite(parsed.y)) dockY.set(parsed.y);
    } catch {
      /* Ignore stale or malformed position data. */
    }
  }, [dockX, dockY]);

  useEffect(() => {
    const surface = dockSurfaceRef.current;
    if (!surface || !currentTrack || dockSuppressed) return;
    const settleDelay = prefersReducedMotion ? 0 : motionDuration.flow * 1000 + 80;
    let timeout = window.setTimeout(settleDockWithinViewport, settleDelay);
    const scheduleSettle = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(settleDockWithinViewport, settleDelay);
    };
    const observer = new ResizeObserver(scheduleSettle);
    observer.observe(surface);
    window.addEventListener('resize', scheduleSettle);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener('resize', scheduleSettle);
    };
  }, [currentTrack, dockSuppressed, playerDensity, prefersReducedMotion, settleDockWithinViewport]);

  const reservePlaybackRequest = useCallback((
    track: MusicTrack | undefined,
    shouldPlay: boolean,
    transitioning: boolean,
  ) => {
    const expectedUrl = normalizeAdminPlaybackUrl(resolveAdminAudioUrl(track));
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    desiredTrackIdRef.current = track?.id ?? null;
    desiredUrlRef.current = expectedUrl;
    desiredPlayingRef.current = Boolean(expectedUrl && shouldPlay);
    sourceTransitionRef.current = Boolean(expectedUrl && transitioning);
    return { requestId, expectedUrl };
  }, []);

  const isCurrentPlaybackRequest = useCallback((requestId: number, expectedUrl: string) => (
    isAdminPlaybackRequestCurrent({
      requestId,
      latestRequestId: playbackRequestRef.current,
      expectedUrl,
      loadedUrl: loadedUrlRef.current,
    })
  ), []);

  const commitPlaybackFailure = useCallback((
    requestId: number,
    expectedUrl: string,
    message: string,
  ) => {
    if (
      !isCurrentPlaybackRequest(requestId, expectedUrl)
      || desiredUrlRef.current !== expectedUrl
      || !desiredPlayingRef.current
    ) return;
    playbackRequestRef.current += 1;
    desiredPlayingRef.current = false;
    sourceTransitionRef.current = false;
    playingRef.current = false;
    setIsPlaying(false);
    setPlaybackError(message);
    setPlayerDensity('compact');
  }, [isCurrentPlaybackRequest]);

  const commitPlaybackStarted = useCallback((requestId: number, expectedUrl: string) => {
    if (
      !isCurrentPlaybackRequest(requestId, expectedUrl)
      || desiredUrlRef.current !== expectedUrl
      || !desiredPlayingRef.current
    ) return;
    sourceTransitionRef.current = false;
    playingRef.current = true;
    setIsPlaying(true);
    setPlaybackError(null);
  }, [isCurrentPlaybackRequest]);

  const isCurrentAudioEvent = useCallback((
    audio: HTMLAudioElement,
    kind: Parameters<typeof shouldCommitAdminAudioEvent>[0]['kind'],
  ) => (
    loadedTrackIdRef.current === desiredTrackIdRef.current
    && shouldCommitAdminAudioEvent({
      kind,
      actualUrl: normalizeAdminPlaybackUrl(audio.currentSrc || audio.src),
      desiredUrl: desiredUrlRef.current,
      desiredPlaying: desiredPlayingRef.current,
      transitioning: sourceTransitionRef.current,
      paused: audio.paused,
      ended: audio.ended,
      hasError: audio.error != null,
    })
  ), []);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const markKeyboard = () => {
      inputModalityRef.current = 'keyboard';
    };
    const markPointer = () => {
      inputModalityRef.current = 'pointer';
    };
    window.addEventListener('keydown', markKeyboard, true);
    window.addEventListener('pointerdown', markPointer, true);
    return () => {
      window.removeEventListener('keydown', markKeyboard, true);
      window.removeEventListener('pointerdown', markPointer, true);
    };
  }, []);

  useEffect(() => {
    if (!expanded || !focusExpandedHeadingOnOpenRef.current) return;
    focusExpandedHeadingOnOpenRef.current = false;
    const focusFrame = window.requestAnimationFrame(() => {
      expandedHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [expanded]);

  const autoCollapseDelay = resolveAdminPlayerAutoCollapseDelay({
    expanded,
    isPlaying,
    pointerInside,
    focusWithin,
    isDragging,
    hasPlaybackError: Boolean(playbackError),
  });

  useEffect(() => {
    if (autoCollapseDelay == null) return;
    const timeout = window.setTimeout(() => setPlayerDensity('compact'), autoCollapseDelay);
    return () => window.clearTimeout(timeout);
  }, [audioUrl, autoCollapseDelay, currentIndex, interactionVersion]);

  const autoMinimizeDelay = resolveAdminPlayerAutoMinimizeDelay({
    density: playerDensity,
    isPlaying,
    pointerInside,
    focusWithin,
    isDragging,
    hasPlaybackError: Boolean(playbackError),
  });

  useEffect(() => {
    if (autoMinimizeDelay == null) return;
    const timeout = window.setTimeout(
      () => enterMinimizedDensity('compact'),
      autoMinimizeDelay,
    );
    return () => window.clearTimeout(timeout);
  }, [audioUrl, autoMinimizeDelay, currentIndex, enterMinimizedDensity, interactionVersion]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      reservePlaybackRequest(currentTrack, false, false);
      loadedUrlRef.current = '';
      loadedTrackIdRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      sourceTransitionRef.current = false;
      playingRef.current = false;
      setIsPlaying(false);
      setProgress(0);
      setDuration(currentTrack?.durationSeconds ?? 0);
      setPlaybackError(currentTrack ? '找不到可播放的媒体文件。' : null);
      return;
    }
    const normalizedAudioUrl = normalizeAdminPlaybackUrl(audioUrl);
    let requestId = playbackRequestRef.current;
    if (
      desiredTrackIdRef.current !== currentTrack?.id
      || desiredUrlRef.current !== normalizedAudioUrl
    ) {
      const reservation = reservePlaybackRequest(
        currentTrack,
        desiredPlayingRef.current || playingRef.current,
        true,
      );
      requestId = reservation.requestId;
    }
    // playTracks may already have started this URL inside the user's click task.
    // Reloading the same source here would interrupt it and lose user activation.
    if (
      loadedUrlRef.current === normalizedAudioUrl
      && loadedTrackIdRef.current === currentTrack?.id
    ) {
      setDuration(currentTrack?.durationSeconds ?? 0);
      return;
    }
    const shouldContinuePlaying = desiredPlayingRef.current;
    sourceTransitionRef.current = true;
    audio.src = audioUrl;
    const expectedUrl = audio.src || normalizedAudioUrl;
    loadedUrlRef.current = expectedUrl;
    loadedTrackIdRef.current = currentTrack?.id ?? null;
    desiredUrlRef.current = expectedUrl;
    audio.load();
    setPlaybackError(null);
    setProgress(0);
    setDuration(currentTrack?.durationSeconds ?? 0);
    if (shouldContinuePlaying) {
      audio.play()
        .then(() => commitPlaybackStarted(requestId, expectedUrl))
        .catch(() => {
          commitPlaybackFailure(requestId, expectedUrl, '这首歌暂时无法播放。');
        });
    } else {
      // No playback intent is crossing this source change. Keeping the
      // transition flag set would cause a later real pause event to be ignored.
      sourceTransitionRef.current = false;
    }
  }, [audioUrl, commitPlaybackFailure, commitPlaybackStarted, currentTrack, reservePlaybackRequest]);

  useEffect(() => {
    setLyricsFollowing(true);
  }, [currentTrack?.id]);

  // 歌词跟随:把高亮行滚到容器中央(只滚容器,不动页面)。用户手动
  // 浏览后暂停跟随，避免每次换行都抢走滚动位置。
  useEffect(() => {
    const box = lyricsBoxRef.current;
    const line = activeLineRef.current;
    if (!expanded || !lyricsFollowing || !box || !line) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyric, expanded, lyricsFollowing, prefersReducedMotion]);

  const playTracks = useCallback((
    tracks: MusicTrack[],
    index: number,
    source: AdminMusicQueueSource = { type: 'library' },
    label = source.type === 'playlist' ? '歌单播放' : '歌曲库 · 当前页'
  ) => {
    if (tracks.length === 0) return;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && activeElement !== document.body
      && !activeElement.closest('[data-admin-music-player-root]')
    ) {
      playerReturnFocusRef.current = activeElement;
    }
    // A new queue can begin at the same numeric index (or even replay the same
    // URL), so index/audio identity alone cannot reliably restart idle timing.
    setInteractionVersion((version) => version + 1);
    setPlayerDensity('compact');
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    const nextTrack = tracks[safeIndex];
    const nextUrl = resolveAdminAudioUrl(nextTrack);
    const normalizedNextUrl = normalizeAdminPlaybackUrl(nextUrl);
    const reservation = reservePlaybackRequest(
      nextTrack,
      true,
      true,
    );
    setQueueState(createAdminMusicQueueState(tracks, safeIndex, source));
    setQueueLabel(label);
    setPlaybackError(null);
    if (!nextUrl) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      loadedUrlRef.current = '';
      loadedTrackIdRef.current = null;
      sourceTransitionRef.current = false;
      desiredPlayingRef.current = false;
      playingRef.current = false;
      setIsPlaying(false);
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    // Start every click-selected track inside the same user gesture. The source
    // effect recognizes loadedUrlRef and will not reload this exact URL.
    const audio = audioRef.current;
    if (audio) {
      if (normalizedNextUrl !== loadedUrlRef.current) {
        audio.src = nextUrl;
        loadedUrlRef.current = audio.src || normalizedNextUrl;
        desiredUrlRef.current = loadedUrlRef.current;
        audio.load();
      } else {
        try {
          audio.currentTime = 0;
        } catch {
          /* Metadata may still be pending for a same-source replay. */
        }
      }
      loadedTrackIdRef.current = nextTrack.id;
      const expectedUrl = loadedUrlRef.current;
      audio.play()
        .then(() => commitPlaybackStarted(reservation.requestId, expectedUrl))
        .catch(() => {
          commitPlaybackFailure(reservation.requestId, expectedUrl, '这首歌暂时无法播放。');
        });
    }
  }, [commitPlaybackFailure, commitPlaybackStarted, reservePlaybackRequest]);

  const restartRequestedTrack = useCallback((track: MusicTrack | undefined) => {
    const nextUrl = resolveAdminAudioUrl(track);
    const normalizedNextUrl = normalizeAdminPlaybackUrl(nextUrl);
    const reservation = reservePlaybackRequest(
      track,
      true,
      true,
    );
    setPlaybackError(null);
    if (!nextUrl) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      loadedUrlRef.current = '';
      loadedTrackIdRef.current = null;
      desiredPlayingRef.current = false;
      sourceTransitionRef.current = false;
      playingRef.current = false;
      setIsPlaying(false);
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (normalizedNextUrl !== loadedUrlRef.current) {
      audio.src = nextUrl;
      loadedUrlRef.current = audio.src || normalizedNextUrl;
      desiredUrlRef.current = loadedUrlRef.current;
      audio.load();
    }
    loadedTrackIdRef.current = track?.id ?? null;
    try {
      audio.currentTime = 0;
    } catch {
      /* Some WebKit builds defer seeking until metadata becomes available. */
    }
    setProgress(0);
    const expectedUrl = loadedUrlRef.current;
    audio.play()
      .then(() => commitPlaybackStarted(reservation.requestId, expectedUrl))
      .catch(() => {
        commitPlaybackFailure(reservation.requestId, expectedUrl, '这首歌暂时无法播放。');
      });
  }, [commitPlaybackFailure, commitPlaybackStarted, reservePlaybackRequest]);

  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;
    const { nextIndex, restartCurrent } = resolveAdminAdjacentTrack({
      currentIndex,
      direction: 1,
      trackCount: queue.length,
    });
    if (restartCurrent) {
      restartRequestedTrack(currentTrack);
      return;
    }
    const nextQueueTrack = queue[nextIndex];
    restartRequestedTrack(nextQueueTrack);
    setQueueState((state) => ({
      ...state,
      currentIndex: nextIndex,
      currentTrack: state.queue[nextIndex],
    }));
  }, [currentIndex, currentTrack, queue, restartRequestedTrack]);

  const previousTrack = useCallback(() => {
    if (queue.length === 0) return;
    const { nextIndex, restartCurrent } = resolveAdminAdjacentTrack({
      currentIndex,
      direction: -1,
      trackCount: queue.length,
    });
    if (restartCurrent) {
      restartRequestedTrack(currentTrack);
      return;
    }
    const nextQueueTrack = queue[nextIndex];
    restartRequestedTrack(nextQueueTrack);
    setQueueState((state) => ({
      ...state,
      currentIndex: nextIndex,
      currentTrack: state.queue[nextIndex],
    }));
  }, [currentIndex, currentTrack, queue, restartRequestedTrack]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    if (desiredPlayingRef.current || !audio.paused) {
      reservePlaybackRequest(currentTrack, false, false);
      sourceTransitionRef.current = false;
      desiredPlayingRef.current = false;
      playingRef.current = false;
      audio.pause();
      setIsPlaying(false);
      return;
    }

    const normalizedAudioUrl = normalizeAdminPlaybackUrl(audioUrl);
    const reservation = reservePlaybackRequest(
      currentTrack,
      true,
      true,
    );
    if (loadedUrlRef.current !== normalizedAudioUrl) {
      audio.src = audioUrl;
      loadedUrlRef.current = audio.src || normalizedAudioUrl;
      desiredUrlRef.current = loadedUrlRef.current;
      audio.load();
    }
    loadedTrackIdRef.current = currentTrack?.id ?? null;
    const expectedUrl = loadedUrlRef.current;
    try {
      setPlaybackError(null);
      await audio.play();
      commitPlaybackStarted(reservation.requestId, expectedUrl);
    } catch {
      commitPlaybackFailure(reservation.requestId, expectedUrl, '这首歌暂时无法播放。');
    }
  }, [audioUrl, commitPlaybackFailure, commitPlaybackStarted, currentTrack, reservePlaybackRequest]);

  const retryPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    const normalizedAudioUrl = normalizeAdminPlaybackUrl(audioUrl);
    const reservation = reservePlaybackRequest(currentTrack, true, true);
    if (loadedUrlRef.current !== normalizedAudioUrl) {
      audio.src = audioUrl;
      loadedUrlRef.current = audio.src || normalizedAudioUrl;
      desiredUrlRef.current = loadedUrlRef.current;
    }
    loadedTrackIdRef.current = currentTrack?.id ?? null;
    const expectedUrl = loadedUrlRef.current;
    try {
      setPlaybackError(null);
      audio.load();
      await audio.play();
      commitPlaybackStarted(reservation.requestId, expectedUrl);
    } catch {
      commitPlaybackFailure(
        reservation.requestId,
        expectedUrl,
        '仍然无法播放，请检查媒体文件或稍后再试。'
      );
    }
  }, [audioUrl, commitPlaybackFailure, commitPlaybackStarted, currentTrack, reservePlaybackRequest]);

  const seekToClientX = useCallback((clientX: number, rect: DOMRect) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0 || rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const next = ratio * duration;
    audio.currentTime = next;
    setProgress(next);
  }, [duration]);

  const handleSeekPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointercancel') {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (event.type === 'pointerdown') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    seekToClientX(event.clientX, event.currentTarget.getBoundingClientRect());
    if (event.type === 'pointerup') {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, [seekToClientX]);

  const seekToPercent = useCallback((p: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const next = Math.min(duration, Math.max(0, (p / 100) * duration));
    audio.currentTime = next;
    setProgress(next);
  }, [duration]);

  const restorePlayerReturnFocus = useCallback(() => {
    const target = playerReturnFocusRef.current;
    playerReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, []);

  const focusDensityToggle = useCallback(() => {
    window.requestAnimationFrame(() => {
      densityToggleRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const focusMinimizedTrigger = useCallback(() => {
    window.requestAnimationFrame(() => {
      minimizedTriggerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const closePlayer = useCallback(() => {
    const audio = audioRef.current;
    reservePlaybackRequest(undefined, false, false);
    loadedUrlRef.current = '';
    loadedTrackIdRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    sourceTransitionRef.current = false;
    playingRef.current = false;
    setIsPlaying(false);
    setPlayerDensity('compact');
    setQueueState(createAdminMusicQueueState([], 0, { type: 'library' }));
    setQueueLabel('歌曲库 · 当前页');
    setProgress(0);
    setDuration(0);
    setPlaybackError(null);
    restorePlayerReturnFocus();
  }, [reservePlaybackRequest, restorePlayerReturnFocus]);

  const reserveQueueStateTransition = useCallback((nextState: AdminMusicQueueState) => {
    const nextTrack = nextState.currentTrack;
    const nextUrl = normalizeAdminPlaybackUrl(resolveAdminAudioUrl(nextTrack));
    if (
      desiredTrackIdRef.current === (nextTrack?.id ?? null)
      && desiredUrlRef.current === nextUrl
    ) return;
    reservePlaybackRequest(
      nextTrack,
      desiredPlayingRef.current || playingRef.current,
      Boolean(nextUrl && (
        nextUrl !== loadedUrlRef.current
        || (nextTrack?.id ?? null) !== loadedTrackIdRef.current
      )),
    );
  }, [reservePlaybackRequest]);

  const replaceQueueTrack = useCallback((track: MusicTrack) => {
    const nextState = replaceAdminMusicQueueTrack(queueState, track);
    if (nextState === queueState) return;
    reserveQueueStateTransition(nextState);
    setQueueState(nextState);
  }, [queueState, reserveQueueStateTransition]);

  const removeQueueTrack = useCallback((trackId: number, expectedSource?: AdminMusicQueueSource) => {
    const nextState = removeAdminMusicQueueTrack(queueState, trackId, expectedSource);
    if (nextState === queueState) return;
    if (!nextState.currentTrack) {
      closePlayer();
      return;
    }
    reserveQueueStateTransition(nextState);
    setQueueState(nextState);
  }, [closePlayer, queueState, reserveQueueStateTransition]);

  const reconcileQueue = useCallback((tracks: readonly MusicTrack[], source: AdminMusicQueueSource) => {
    if (queueState.queue.length === 0) return;
    const nextState = reconcileAdminMusicQueue(queueState, tracks, source);
    if (nextState === queueState) return;
    if (!nextState.currentTrack) {
      closePlayer();
      return;
    }
    reserveQueueStateTransition(nextState);
    setQueueState(nextState);
  }, [closePlayer, queueState, reserveQueueStateTransition]);

  const updateQueueSourceLabel = useCallback((source: AdminMusicQueueSource, label: string) => {
    const nextLabel = label.trim();
    if (!nextLabel || queueState.queue.length === 0) return;
    if (!isSameAdminMusicQueueSource(queueState.source, source)) return;
    setQueueLabel(nextLabel);
  }, [queueState.queue.length, queueState.source]);

  const setMusicSkin = useCallback((value: string, seed?: string) => {
    setMusicSkinState((current) => (
      current.value === value && current.seed === seed ? current : { value, seed }
    ));
  }, []);

  const setDockSuppressed = useCallback((suppressed: boolean) => {
    setDockSuppressedState(suppressed);
    if (suppressed) setPlayerDensity('compact');
  }, []);

  const value = useMemo<AdminMusicPlayerContextValue>(() => ({
    queue,
    queueSource: queueState.source,
    currentTrack,
    currentIndex,
    isPlaying,
    playbackError,
    playTracks,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    retryPlayback,
    closePlayer,
    replaceQueueTrack,
    removeQueueTrack,
    reconcileQueue,
    updateQueueSourceLabel,
    setMusicSkin,
    setDockSuppressed,
  }), [closePlayer, currentIndex, currentTrack, isPlaying, nextTrack, playTracks, playbackError, previousTrack, queue, queueState.source, reconcileQueue, removeQueueTrack, replaceQueueTrack, retryPlayback, seekToPercent, setDockSuppressed, setMusicSkin, togglePlayback, updateQueueSourceLabel]);

  const timelineValue = useMemo<AdminMusicPlayerTimelineValue>(() => ({
    progress,
    duration,
    percent,
  }), [duration, percent, progress]);

  const playlistName = queueLabel;
  const coverNode = cover ? (
    <img src={cover} alt="" draggable={false} className="h-full w-full select-none object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))]">
      <Disc3 className="h-1/3 w-1/3 text-[var(--ink-secondary)]" />
    </div>
  );

  const handleDockPositionEnd = useCallback(() => {
    setIsDragging(false);
    persistDockPosition();
    settleDockWithinViewport();
    window.setTimeout(() => {
      dockDraggedRef.current = false;
    }, 0);
  }, [persistDockPosition, settleDockWithinViewport]);

  const handleTrackDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const action = resolveAdminPlayerGesture({
      expanded,
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
    });
    if (action === 'next') nextTrack();
    if (action === 'previous') previousTrack();
    setIsDragging(false);
    window.setTimeout(() => {
      dockDraggedRef.current = false;
    }, 0);
  }, [expanded, nextTrack, previousTrack]);

  const togglePlayerDetail = useCallback(() => {
    const nextDensity = resolveAdminPlayerDensityTransition(playerDensity, 'toggle-detail');
    focusExpandedHeadingOnOpenRef.current = (
      nextDensity === 'expanded'
      && inputModalityRef.current === 'keyboard'
    );
    setPlayerDensity(nextDensity);
    if (nextDensity === 'compact' && inputModalityRef.current === 'keyboard') {
      focusDensityToggle();
    }
  }, [focusDensityToggle, playerDensity]);

  const minimizePlayer = useCallback(() => {
    enterMinimizedDensity(playerDensity);
    if (inputModalityRef.current === 'keyboard') focusMinimizedTrigger();
  }, [enterMinimizedDensity, focusMinimizedTrigger, playerDensity]);

  const restoreCompactPlayer = useCallback(() => {
    if (dockDraggedRef.current) return;
    setPlayerDensity(resolveAdminPlayerDensityTransition(playerDensity, 'restore'));
    if (inputModalityRef.current === 'keyboard') focusDensityToggle();
  }, [focusDensityToggle, playerDensity]);

  const startDockDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    dragControls.start(event);
  }, [dragControls]);

  const startDockDragFromTrigger = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragControls.start(event);
  }, [dragControls]);

  const handleDockKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (playerDensity === 'expanded') {
      setPlayerDensity('compact');
      focusDensityToggle();
      return;
    }
    if (playerDensity === 'compact') {
      enterMinimizedDensity(playerDensity);
      focusMinimizedTrigger();
      return;
    }
    closePlayer();
  }, [closePlayer, enterMinimizedDensity, focusDensityToggle, focusMinimizedTrigger, playerDensity]);

  const markPlayerActivity = useCallback(() => {
    setInteractionVersion((version) => version + 1);
  }, []);

  const handlePlayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    markPlayerActivity();
    handleDockKeyDown(event);
  }, [handleDockKeyDown, markPlayerActivity]);

  const handleSeekKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentPercent = percentRef.current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      seekToPercent(Math.min(100, currentPercent + 5));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      seekToPercent(Math.max(0, currentPercent - 5));
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekToPercent(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekToPercent(100);
    }
  }, [seekToPercent]);

  const resolvedDuration = duration || currentTrack?.durationSeconds || 0;
  const renderedLyricLines = useMemo(() => lyrics.map((line, index) => {
    const active = index === activeLyric;
    if (line.time == null || resolvedDuration <= 0) {
      return (
        <p
          key={`plain-${index}`}
          className={cn(
            'mx-auto flex min-h-11 w-full items-center justify-center rounded-[var(--music-radius-detail)] px-1 text-center',
            active ? 'font-black text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
          )}
        >
          <span className="line-clamp-2">{line.text}</span>
        </p>
      );
    }
    return (
      <button
        type="button"
        key={`${line.time}-${index}`}
        ref={active ? activeLineRef : undefined}
        onClick={() => {
          setLyricsFollowing(true);
          seekToPercent((line.time! / resolvedDuration) * 100);
        }}
        className={cn(
          'mx-auto flex min-h-11 w-full items-center justify-center rounded-[var(--music-radius-detail)] px-1 text-center transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
          active ? 'font-black text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
        )}
        aria-label={`跳转到 ${formatClock(line.time)}：${line.text}`}
      >
        <span className="line-clamp-2">{line.text}</span>
      </button>
    );
  }), [activeLyric, lyrics, resolvedDuration, seekToPercent]);
  const renderSeekBar = (showTimes: boolean, compact = false) => (
    <div>
      <div
        role="slider"
        tabIndex={playerDensity === 'minimized' ? -1 : 0}
        onPointerDown={handleSeekPointer}
        onPointerMove={handleSeekPointer}
        onPointerUp={handleSeekPointer}
        onPointerCancel={handleSeekPointer}
        onKeyDown={handleSeekKeyDown}
        className={cn(
          'flex w-full touch-none cursor-pointer items-center rounded-[var(--music-radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          compact ? 'min-h-7' : 'min-h-11'
        )}
        aria-label="调整播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`${formatClock(progress)} / ${formatClock(resolvedDuration)}`}
      >
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]">
          <span
            className="block h-full origin-left rounded-full bg-[var(--aurora-1)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </span>
      </div>
      {showTimes && (
        <div className="-mt-1 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
          <span>{formatClock(progress)}</span>
          <span>{formatClock(resolvedDuration)}</span>
        </div>
      )}
    </div>
  );

  const renderPlayButton = () => (
    <motion.button
      layout
      layoutDependency={playerDensity}
      type="button"
      data-admin-player-core-play
      data-admin-player-mini-play
      onClick={playbackError ? () => void retryPlayback() : togglePlayback}
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        playerDensity === 'expanded'
          ? 'h-14 w-14 bg-[var(--ink-primary)] text-[var(--bg-void)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--bg-void)_16%,transparent)]'
          : playerDensity === 'compact'
            ? 'h-11 w-11 border border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-primary)] shadow-none'
            : 'h-11 w-11 bg-transparent text-[var(--ink-secondary)] shadow-none'
      )}
      animate={{
        opacity: playerDensity === 'minimized' && isMobile ? 0 : 1,
        scale: playerDensity === 'minimized' && isMobile ? 0.82 : 1,
      }}
      transition={prefersReducedMotion ? transition.instant : spring.soft}
      style={{
        pointerEvents: playerDensity === 'minimized' && isMobile ? 'none' : 'auto',
      }}
      tabIndex={playerDensity === 'minimized' && isMobile ? -1 : 0}
      aria-hidden={playerDensity === 'minimized' && isMobile}
      aria-label={playbackError ? '重新尝试后台播放' : isPlaying ? '暂停后台播放' : '继续后台播放'}
      title={playbackError ? '重新尝试' : isPlaying ? '暂停' : '播放'}
    >
      <span
        data-admin-player-mini-play-visual
        className={cn(
          'grid place-items-center rounded-full',
          playerDensity === 'minimized'
            ? 'h-8 w-8 border border-[color-mix(in_oklch,var(--ink-primary)_32%,transparent)] bg-transparent'
            : 'h-full w-full border border-transparent',
        )}
        aria-hidden="true"
      >
        {playbackError ? (
          <RefreshCw className={playerDensity === 'minimized' ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.9} />
        ) : isPlaying ? (
          <Pause className={cn('fill-current', playerDensity === 'minimized' ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={1.5} />
        ) : (
          <Play className={cn('translate-x-px fill-current', playerDensity === 'minimized' ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={1.5} />
        )}
      </span>
    </motion.button>
  );

  const quietControlClass = 'flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const topActionControlClass = 'flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[color,opacity] duration-100 hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const secondaryMorphTransition = (visible: boolean, enterDelay = 0) => (
    prefersReducedMotion
      ? transition.instant
      : {
          layout: spring.soft,
          opacity: visible
            ? { ...transition.quick, delay: enterDelay }
            : ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION,
          scale: visible
            ? { ...spring.precise, delay: enterDelay }
            : ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION,
          y: visible
            ? { ...transition.quick, delay: enterDelay }
            : ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION,
        }
  );

  const renderDensityToggle = () => (
    <motion.button
      layout
      layoutDependency={playerDensity}
      ref={densityToggleRef}
      type="button"
      data-admin-player-density-toggle
      onClick={togglePlayerDetail}
      className={topActionControlClass}
      aria-label={expanded ? '收起播放器详情' : '展开播放器详情'}
      aria-expanded={expanded}
      aria-controls="admin-music-player-expanded"
      aria-hidden={playerDensity === 'minimized'}
      tabIndex={playerDensity === 'minimized' ? -1 : 0}
      title={expanded ? '收起详情' : '展开详情'}
    >
      <span className="relative grid h-5 w-5 place-items-center" aria-hidden="true">
        <motion.span
          className="absolute inset-0 grid place-items-center"
          animate={{
            opacity: expanded ? 1 : 0,
            rotate: expanded ? 0 : -24,
            scale: expanded ? 1 : 0.82,
          }}
          transition={prefersReducedMotion ? transition.instant : spring.precise}
        >
          <Minimize2 className="h-4 w-4" strokeWidth={1.7} />
        </motion.span>
        <motion.span
          className="absolute inset-0 grid place-items-center"
          animate={{
            opacity: expanded ? 0 : 1,
            rotate: expanded ? 24 : 0,
            scale: expanded ? 0.82 : 1,
          }}
          transition={prefersReducedMotion ? transition.instant : spring.precise}
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.7} />
        </motion.span>
      </span>
    </motion.button>
  );

  return (
    <AdminMusicPlayerContext.Provider value={value}>
      <AdminMusicPlayerTimelineContext.Provider value={timelineValue}>
        {children}
        <audio
        ref={audioRef}
        preload="metadata"
        onPlay={(event) => {
          if (!isCurrentAudioEvent(event.currentTarget, 'play')) return;
          sourceTransitionRef.current = false;
          playingRef.current = true;
          setIsPlaying(true);
          setPlaybackError(null);
        }}
        onPause={(event) => {
          if (!isCurrentAudioEvent(event.currentTarget, 'pause')) return;
          desiredPlayingRef.current = false;
          sourceTransitionRef.current = false;
          playingRef.current = false;
          setIsPlaying(false);
        }}
        onError={(event) => {
          const audio = event.currentTarget;
          if (!isCurrentAudioEvent(audio, 'error')) return;
          // MediaError is the authoritative failure for this generation. Move
          // the request id forward so a later rejection from the same play()
          // cannot replace its specific diagnosis with a generic message.
          playbackRequestRef.current += 1;
          desiredPlayingRef.current = false;
          sourceTransitionRef.current = false;
          playingRef.current = false;
          setIsPlaying(false);
          setPlaybackError(resolveAdminMediaErrorMessage(audio.error?.code));
          setPlayerDensity('compact');
        }}
        onEnded={(event) => {
          if (!isCurrentAudioEvent(event.currentTarget, 'ended')) return;
          nextTrack();
        }}
        onLoadedMetadata={(event) => {
          if (!isCurrentAudioEvent(event.currentTarget, 'metadata')) return;
          if (!desiredPlayingRef.current) sourceTransitionRef.current = false;
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : (currentTrack?.durationSeconds ?? 0));
        }}
        onTimeUpdate={(event) => {
          if (!isCurrentAudioEvent(event.currentTarget, 'timeupdate')) return;
          setProgress(event.currentTarget.currentTime || 0);
        }}
        />
        <AnimatePresence>
          {currentTrack && !dockSuppressed && (
            <motion.div
              ref={dockBoundsRef}
              data-admin-player-bounds
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={prefersReducedMotion ? transition.instant : transition.quick}
              className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-3 z-30 flex items-end justify-center min-[769px]:inset-5"
            >
              <motion.div
                data-admin-music-player-root
                data-admin-player-density={playerDensity}
                data-music-skin={musicSkin.value}
                layout
                layoutDependency={playerDensity}
                drag
                dragControls={dragControls}
                dragListener={false}
                dragMomentum={false}
                dragElastic={0.08}
                dragConstraints={dockBoundsRef}
                onDragStart={() => {
                  dockDraggedRef.current = true;
                  setIsDragging(true);
                }}
                onDragEnd={handleDockPositionEnd}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setPointerInside(true);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setPointerInside(false);
                }}
                onPointerDownCapture={markPlayerActivity}
                onFocusCapture={() => {
                  if (inputModalityRef.current === 'keyboard') setFocusWithin(true);
                }}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget as Node | null;
                  if (!nextTarget || !event.currentTarget.contains(nextTarget)) setFocusWithin(false);
                }}
                onKeyDown={handlePlayerKeyDown}
                role="region"
                aria-label="后台音乐播放器"
                aria-keyshortcuts="Escape"
                transition={prefersReducedMotion ? transition.instant : spring.soft}
                style={{
                  x: dockX,
                  y: dockY,
                  originX: 0.5,
                  originY: 1,
                  ...(musicSkin.seed ? ({ ['--music-seed']: musicSkin.seed } as CSSProperties) : {}),
                }}
                className="admin-music-player-root pointer-events-auto"
              >
                <motion.div
                  ref={dockSurfaceRef}
                  data-admin-player-surface
                  layout
                  layoutDependency={playerDensity}
                  initial={{ borderRadius: playerSurfaceRadius }}
                  animate={{ borderRadius: playerSurfaceRadius }}
                  transition={prefersReducedMotion
                    ? transition.instant
                    : { layout: spring.soft, borderRadius: spring.soft }}
                  style={{ originX: 0.5, originY: 1 }}
                  className={cn(
                    'admin-music-player-surface surface-raised relative h-full w-full overflow-hidden text-[var(--ink-primary)]',
                    playerDensity === 'minimized' && 'max-[768px]:!border-0',
                  )}
                >
                  <motion.div
                    id={expanded ? 'admin-music-player-expanded' : undefined}
                    data-admin-player-morph-content
                    data-admin-player-minimized={playerDensity === 'minimized' ? '' : undefined}
                    data-admin-player-compact-layout={playerDensity === 'compact' ? '' : undefined}
                    data-admin-player-expanded-layout={playerDensity === 'expanded' ? '' : undefined}
                    data-admin-player-drag-zone
                    layout="position"
                    layoutDependency={playerDensity}
                    onPointerDown={startDockDrag}
                    transition={prefersReducedMotion ? transition.instant : spring.soft}
                    className="admin-player-morph-content"
                  >
                    <motion.div
                      data-admin-player-core-cover
                      data-admin-player-mini-cover
                      data-admin-player-compact-cover
                      data-admin-player-mobile-orb
                      layout="preserve-aspect"
                      layoutDependency={playerDensity}
                      drag={expanded && !prefersReducedMotion ? 'x' : false}
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.18}
                      dragMomentum={false}
                      onDragStart={() => {
                        dockDraggedRef.current = true;
                        setIsDragging(true);
                      }}
                      onPointerDown={(event) => {
                        if (expanded) event.stopPropagation();
                      }}
                      onDragEnd={handleTrackDragEnd}
                      role={expanded ? 'group' : undefined}
                      aria-label={expanded ? '左右滑动切换歌曲' : undefined}
                      animate={{
                        borderRadius: playerDensity === 'minimized'
                          ? (isMobile ? 26 : 22)
                          : playerDensity === 'expanded'
                            ? 18
                            : 14,
                      }}
                      transition={prefersReducedMotion
                        ? transition.instant
                        : { layout: spring.soft, borderRadius: spring.soft }}
                      style={{ touchAction: expanded ? 'pan-y' : 'none' }}
                      className="admin-player-core-cover"
                    >
                      <motion.span
                        className="admin-player-core-cover-ring"
                        aria-hidden="true"
                        animate={isPlaying && !prefersReducedMotion ? { rotate: 360 } : { rotate: 0 }}
                        transition={isPlaying
                          ? { duration: motionDuration.ambient * 4, ease: 'linear', repeat: Infinity }
                          : transition.quick}
                      />
                      <span className="admin-player-core-cover-image">
                        {coverNode}
                      </span>
                    </motion.div>

                    <button
                      ref={minimizedTriggerRef}
                      type="button"
                      data-admin-player-minimized-trigger
                      data-admin-player-desktop-mini-card
                      onPointerDown={startDockDragFromTrigger}
                      onClick={restoreCompactPlayer}
                      className="admin-player-minimized-trigger cursor-grab touch-none rounded-[var(--music-radius-capsule)] text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                      aria-label="展开后台播放器；拖动可移动"
                      aria-hidden={playerDensity !== 'minimized'}
                      tabIndex={playerDensity === 'minimized' ? 0 : -1}
                      title="展开播放器"
                    />

                    <motion.div
                      data-admin-player-core-identity
                      data-admin-player-compact-identity
                      layout
                      layoutDependency={playerDensity}
                      animate={{
                        opacity: playerDensity === 'minimized' && isMobile ? 0 : 1,
                      }}
                      transition={prefersReducedMotion ? transition.instant : spring.soft}
                      className="admin-player-core-identity"
                    >
                      <motion.div
                        data-eyebrow
                        animate={{
                          opacity: playerDensity === 'expanded' ? 1 : 0,
                          y: playerDensity === 'expanded' ? 0 : 3,
                        }}
                        transition={prefersReducedMotion ? transition.instant : transition.quick}
                        className="admin-player-core-eyebrow"
                      >
                        <Disc3 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{playlistName}</span>
                      </motion.div>
                      <h2
                        ref={expandedHeadingRef}
                        data-admin-player-mini-title
                        tabIndex={expanded ? -1 : undefined}
                        className="admin-player-core-title focus:outline-none focus-visible:rounded-none focus-visible:shadow-[inset_0_-2px_0_color-mix(in_oklch,var(--aurora-1)_72%,transparent)]"
                        title={currentTrack.title}
                      >
                        {currentTrack.title}
                      </h2>
                      <p
                        className={cn(
                          'admin-player-core-meta',
                          playbackError && 'font-semibold text-[var(--signal-danger)]',
                        )}
                      >
                        {playbackError ? (
                          playbackError
                        ) : (
                          <>
                            <span>{currentTrack.artist || '未知艺术家'}</span>
                            <span className="admin-player-core-queue">
                              {' '}· 队列 {currentIndex + 1}/{queue.length}
                            </span>
                          </>
                        )}
                      </p>
                    </motion.div>

                    <motion.div
                      data-admin-player-expanded-detail
                      layout
                      layoutDependency={playerDensity}
                      animate={{
                        opacity: expanded ? 1 : 0,
                        clipPath: expanded
                          ? 'inset(0% 0% 0% 0% round 14px)'
                          : 'inset(0% 0% 100% 0% round 14px)',
                      }}
                      transition={prefersReducedMotion
                        ? transition.instant
                        : {
                            layout: spring.soft,
                            opacity: expanded
                              ? transition.quick
                              : ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION,
                            clipPath: expanded
                              ? spring.soft
                              : ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION,
                          }}
                      aria-hidden={!expanded}
                      inert={!expanded ? true : undefined}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="admin-player-expanded-detail"
                    >
                      {!lyricsFollowing && lyrics.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLyricsFollowing(true)}
                          className="absolute right-1 top-1 z-10 inline-flex min-h-11 items-center rounded-[var(--music-radius-control)] border border-[var(--music-stroke)] bg-[color-mix(in_oklch,var(--bg-raised)_94%,transparent)] px-3 text-[11px] font-bold text-[var(--ink-primary)] shadow-sm backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                        >
                          回到当前歌词
                        </button>
                      )}
                      <div
                        ref={lyricsBoxRef}
                        onPointerDown={() => setLyricsFollowing(false)}
                        onWheel={() => setLyricsFollowing(false)}
                        className="relative h-full overflow-y-auto overscroll-contain pr-1 text-center text-sm leading-7 [scrollbar-width:none]"
                        aria-label="歌词"
                      >
                        {lyrics.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--ink-muted)]">
                            <Music2 className="h-5 w-5" />
                            暂无歌词
                          </div>
                        ) : renderedLyricLines}
                      </div>
                    </motion.div>

                    <motion.div
                      data-admin-player-core-transport
                      data-admin-player-transport
                      data-admin-player-compact-transport
                      layout
                      layoutDependency={playerDensity}
                      onPointerDown={(event) => event.stopPropagation()}
                      transition={prefersReducedMotion ? transition.instant : spring.soft}
                      className="admin-player-core-transport"
                    >
                      <motion.button
                        layout
                        layoutDependency={playerDensity}
                        type="button"
                        onClick={previousTrack}
                        className={quietControlClass}
                        animate={{
                          opacity: playerDensity === 'minimized' ? 0 : 1,
                          scale: playerDensity === 'minimized' ? 0.82 : 1,
                        }}
                        transition={secondaryMorphTransition(playerDensity !== 'minimized')}
                        style={{ pointerEvents: playerDensity === 'minimized' ? 'none' : 'auto' }}
                        tabIndex={playerDensity === 'minimized' ? -1 : 0}
                        aria-hidden={playerDensity === 'minimized'}
                        aria-label="上一首"
                        title="上一首"
                      >
                        <SkipBack
                          className={cn('fill-current', playerDensity === 'compact' ? 'h-[18px] w-[18px]' : 'h-5 w-5')}
                          strokeWidth={1.55}
                        />
                      </motion.button>
                      {renderPlayButton()}
                      <motion.button
                        layout
                        layoutDependency={playerDensity}
                        type="button"
                        onClick={nextTrack}
                        className={quietControlClass}
                        animate={{
                          opacity: playerDensity === 'minimized' ? 0 : 1,
                          scale: playerDensity === 'minimized' ? 0.82 : 1,
                        }}
                        transition={secondaryMorphTransition(playerDensity !== 'minimized')}
                        style={{ pointerEvents: playerDensity === 'minimized' ? 'none' : 'auto' }}
                        tabIndex={playerDensity === 'minimized' ? -1 : 0}
                        aria-hidden={playerDensity === 'minimized'}
                        aria-label="下一首"
                        title="下一首"
                      >
                        <SkipForward
                          className={cn('fill-current', playerDensity === 'compact' ? 'h-[18px] w-[18px]' : 'h-5 w-5')}
                          strokeWidth={1.55}
                        />
                      </motion.button>
                    </motion.div>

                    <motion.div
                      data-admin-player-core-actions
                      data-admin-player-compact-actions
                      data-admin-player-compact-mobile-controls
                      layout
                      layoutDependency={playerDensity}
                      onPointerDown={(event) => event.stopPropagation()}
                      transition={prefersReducedMotion ? transition.instant : spring.soft}
                      className="admin-player-core-actions"
                    >
                      <motion.button
                        layout
                        layoutDependency={playerDensity}
                        type="button"
                        data-admin-player-mini-restore
                        onClick={restoreCompactPlayer}
                        className={cn(topActionControlClass, 'admin-player-action-restore')}
                        animate={{
                          opacity: playerDensity === 'minimized' && !isMobile ? 1 : 0,
                          scale: playerDensity === 'minimized' && !isMobile ? 1 : 0.82,
                        }}
                        transition={secondaryMorphTransition(
                          playerDensity === 'minimized' && !isMobile,
                          playerDensity === 'minimized'
                            ? minimizedActionEnterDelay
                            : 0,
                        )}
                        style={{
                          pointerEvents: playerDensity === 'minimized' && !isMobile ? 'auto' : 'none',
                        }}
                        tabIndex={playerDensity === 'minimized' && !isMobile ? 0 : -1}
                        aria-hidden={playerDensity !== 'minimized' || isMobile}
                        aria-label="展开后台播放器"
                        title="展开播放器"
                      >
                        <ListMusic className="h-5 w-5" strokeWidth={1.7} />
                      </motion.button>
                      <motion.button
                        layout
                        layoutDependency={playerDensity}
                        type="button"
                        onClick={minimizePlayer}
                        className={cn(topActionControlClass, 'admin-player-action-minimize')}
                        animate={{
                          opacity: playerDensity === 'minimized' ? 0 : 1,
                          scale: playerDensity === 'minimized' ? 0.82 : 1,
                        }}
                        transition={secondaryMorphTransition(playerDensity !== 'minimized')}
                        style={{ pointerEvents: playerDensity === 'minimized' ? 'none' : 'auto' }}
                        tabIndex={playerDensity === 'minimized' ? -1 : 0}
                        aria-hidden={playerDensity === 'minimized'}
                        aria-label="最小化后台播放器"
                        title="最小化"
                      >
                        <Minus className="h-4 w-4" strokeWidth={1.7} />
                      </motion.button>
                      <motion.div
                        layout
                        layoutDependency={playerDensity}
                        className="admin-player-action-density"
                        animate={{
                          opacity: playerDensity === 'minimized' ? 0 : 1,
                          scale: playerDensity === 'minimized' ? 0.82 : 1,
                        }}
                        transition={secondaryMorphTransition(playerDensity !== 'minimized')}
                        style={{ pointerEvents: playerDensity === 'minimized' ? 'none' : 'auto' }}
                        aria-hidden={playerDensity === 'minimized'}
                      >
                        {renderDensityToggle()}
                      </motion.div>
                      <motion.button
                        layout
                        layoutDependency={playerDensity}
                        type="button"
                        onClick={closePlayer}
                        className={cn(topActionControlClass, 'admin-player-action-close')}
                        animate={{
                          opacity: expanded ? 1 : 0,
                          scale: expanded ? 1 : 0.82,
                        }}
                        transition={secondaryMorphTransition(expanded)}
                        style={{ pointerEvents: expanded ? 'auto' : 'none' }}
                        tabIndex={expanded ? 0 : -1}
                        aria-hidden={!expanded}
                        aria-label="关闭后台播放器"
                        title="关闭后台播放器"
                      >
                        <X className="h-[18px] w-[18px]" strokeWidth={1.7} />
                      </motion.button>
                    </motion.div>

                    <motion.div
                      data-admin-player-core-progress
                      data-admin-player-compact-progress
                      layout
                      layoutDependency={playerDensity}
                      onPointerDown={(event) => event.stopPropagation()}
                      animate={{
                        opacity: playerDensity === 'minimized' ? 0 : 1,
                        y: playerDensity === 'minimized' ? 4 : 0,
                      }}
                      transition={secondaryMorphTransition(playerDensity !== 'minimized')}
                      style={{ pointerEvents: playerDensity === 'minimized' ? 'none' : 'auto' }}
                      aria-hidden={playerDensity === 'minimized'}
                      className="admin-player-core-progress"
                    >
                      {renderSeekBar(expanded, !expanded)}
                    </motion.div>

                    {playbackError && (
                      <span role="alert" className="sr-only">
                        {playbackError} 请选择播放按钮重新尝试。
                      </span>
                    )}
                  </motion.div>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </AdminMusicPlayerTimelineContext.Provider>
    </AdminMusicPlayerContext.Provider>
  );
}
