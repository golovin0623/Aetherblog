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
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import { AlertCircle, Disc3, Music2, Pause, Play, RefreshCw, SkipBack, SkipForward, X } from 'lucide-react';
import { transition } from '@aetherblog/ui';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import {
  resolveAdminPlayerAutoCollapseDelay,
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  isAdminPlaybackRequestCurrent,
  parseAdminMusicLyric,
  shouldCommitAdminAudioEvent,
  type AdminMusicLyricLine,
  resolveAdminPlayerGesture,
  resolveAdminMediaErrorMessage,
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
  const prefersReducedMotion = useReducedMotion();
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
  const [expanded, setExpanded] = useState(false);
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
  const audioUrl = resolveAdminAudioUrl(currentTrack);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const cover = currentTrack?.coverUrl || currentTrack?.media?.thumbnailUrl || '';

  const lyrics = useMemo(() => parseAdminMusicLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const activeLyric = useMemo(() => activeLyricIndex(lyrics, progress), [lyrics, progress]);

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const dockHandleRef = useRef<HTMLButtonElement>(null);
  const playerReturnFocusRef = useRef<HTMLElement | null>(null);
  const percentRef = useRef(percent);
  const inputModalityRef = useRef<'keyboard' | 'pointer'>('keyboard');
  percentRef.current = percent;

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
    const timeout = window.setTimeout(() => setExpanded(false), autoCollapseDelay);
    return () => window.clearTimeout(timeout);
  }, [audioUrl, autoCollapseDelay, currentIndex, interactionVersion]);

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

  const focusDockHandle = useCallback(() => {
    window.requestAnimationFrame(() => {
      dockHandleRef.current?.focus({ preventScroll: true });
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
    setExpanded(false);
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
    if (suppressed) setExpanded(false);
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
    <img src={cover} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))]">
      <Disc3 className="h-1/3 w-1/3 text-[var(--ink-secondary)]" />
    </div>
  );

  const handleDockDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const action = resolveAdminPlayerGesture({
      expanded,
      deltaX: info.offset.x,
      deltaY: info.offset.y,
      velocityX: info.velocity.x,
      velocityY: info.velocity.y,
    });
    if (action === 'collapse') setExpanded(false);
    if (action === 'expand') setExpanded(true);
    setIsDragging(false);
    window.setTimeout(() => {
      dockDraggedRef.current = false;
    }, 0);
  }, [expanded]);

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

  const handleDockKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (expanded) {
      setExpanded(false);
      focusDockHandle();
    } else {
      closePlayer();
    }
  }, [closePlayer, expanded, focusDockHandle]);

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
  const renderSeekBar = (showTimes: boolean) => (
    <div>
      <div
        role="slider"
        tabIndex={0}
        onPointerDown={handleSeekPointer}
        onPointerMove={handleSeekPointer}
        onPointerUp={handleSeekPointer}
        onPointerCancel={handleSeekPointer}
        onKeyDown={handleSeekKeyDown}
        className="flex min-h-11 w-full touch-none cursor-pointer items-center rounded-[var(--music-radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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

  const renderPlayButton = (large: boolean) => (
    <button
      type="button"
      onClick={playbackError ? () => void retryPlayback() : togglePlayback}
      className={cn(
        'relative flex items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--bg-void)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--bg-void)_16%,transparent)] transition-opacity duration-100 hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        large ? 'h-14 w-14' : 'h-12 w-12'
      )}
      aria-label={playbackError ? '重新尝试后台播放' : isPlaying ? '暂停后台播放' : '继续后台播放'}
      title={playbackError ? '重新尝试' : isPlaying ? '暂停' : '播放'}
    >
      {playbackError ? (
        <RefreshCw className="h-5 w-5" strokeWidth={1.9} />
      ) : isPlaying ? (
        <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} />
      ) : (
        <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />
      )}
    </button>
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
            data-music-skin={musicSkin.value}
            style={musicSkin.seed ? ({ ['--music-seed']: musicSkin.seed } as CSSProperties) : undefined}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={prefersReducedMotion ? transition.instant : transition.quick}
            className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] max-[360px]:pl-[max(0.75rem,env(safe-area-inset-left))] max-[360px]:pr-[max(0.75rem,env(safe-area-inset-right))]"
          >
            <motion.div
              data-admin-music-player-root
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragDirectionLock
              dragSnapToOrigin
              dragMomentum={false}
              dragConstraints={{ top: -140, bottom: 140 }}
              dragElastic={{ top: 0.16, bottom: 0.18 }}
              onDragStart={() => {
                dockDraggedRef.current = true;
                setIsDragging(true);
              }}
              onDragEnd={handleDockDragEnd}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setPointerInside(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') setPointerInside(false);
              }}
              onPointerDown={markPlayerActivity}
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
              className="pointer-events-auto w-full max-w-[520px]"
            >
              <div className="relative">
                <button
                  ref={dockHandleRef}
                  type="button"
                  onPointerDown={(event) => dragControls.start(event)}
                  onClick={() => {
                    if (dockDraggedRef.current) return;
                    setExpanded((value) => !value);
                  }}
                  data-admin-player-drag-handle
                  className="absolute left-1/2 -top-8 z-20 flex h-11 w-24 -translate-x-1/2 cursor-grab touch-none items-end justify-center rounded-full pb-2 text-[var(--ink-muted)] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:text-[var(--ink-secondary)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  aria-label={expanded ? '下滑收起后台播放器,点击切换' : '上滑展开后台播放器,点击切换'}
                  aria-keyshortcuts="Escape"
                  aria-expanded={expanded}
                  aria-controls="admin-music-player-expanded"
                  title={expanded ? '下滑收起,点击切换' : '上滑展开,点击切换'}
                >
                  <span className="h-1 w-10 rounded-full bg-current opacity-30" />
                </button>
                <motion.div
                  layout="size"
                  transition={prefersReducedMotion ? transition.instant : transition.quick}
                  className="surface-raised relative overflow-hidden rounded-[var(--music-radius-floating)] text-[var(--ink-primary)]"
                >
                  <div className="max-h-[calc(100dvh_-_5rem_-_env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                  <AnimatePresence initial={false} mode="popLayout">
                    {expanded ? (
                    <motion.div
                      id="admin-music-player-expanded"
                      key="expanded"
                      data-admin-player-expanded-layout
                      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                      transition={prefersReducedMotion ? transition.instant : transition.quick}
                      className="p-1"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_44px] items-start gap-3">
                        <div className="min-w-0">
                          <div data-eyebrow className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--aurora-1)]">
                            <Disc3 className="h-3.5 w-3.5" />
                            {playlistName}
                          </div>
                          <h2 className="mt-1 truncate text-lg font-black leading-tight" title={currentTrack.title}>
                            {currentTrack.title}
                          </h2>
                          <p className="mt-1 truncate text-xs text-[var(--ink-secondary)]">
                            {currentTrack.artist || '未知艺术家'} · 队列 {currentIndex + 1}/{queue.length}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closePlayer}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-muted)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                          aria-label="关闭后台播放器"
                          title="关闭后台播放器"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-[104px_minmax(0,1fr)] items-stretch gap-4 max-[380px]:grid-cols-[88px_minmax(0,1fr)] max-[380px]:gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                        <motion.div
                          drag={prefersReducedMotion ? false : 'x'}
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={0.18}
                          onDragStart={() => {
                            dockDraggedRef.current = true;
                            setIsDragging(true);
                          }}
                          onDragEnd={handleTrackDragEnd}
                          style={{ touchAction: 'pan-y' }}
                          className="relative aspect-square overflow-hidden rounded-[var(--music-radius-artwork-lg)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]"
                          role="group"
                          aria-label="左右滑动切换歌曲"
                        >
                          {coverNode}
                        </motion.div>
                        <div className="relative h-[104px] min-w-0 max-[380px]:h-[88px] sm:h-[120px]">
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
                        </div>
                      </div>

                      <div className="mt-2">
                        {renderSeekBar(true)}
                      </div>

                      <div
                        data-admin-player-transport
                        className="mx-auto mt-2 grid w-fit grid-cols-[44px_56px_44px] items-center gap-3"
                      >
                        <button type="button" onClick={previousTrack} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent" aria-label="上一首" title="上一首">
                          <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
                        </button>
                        {renderPlayButton(true)}
                        <button type="button" onClick={nextTrack} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent" aria-label="下一首" title="下一首">
                          <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
                        </button>
                      </div>
                    </motion.div>
                    ) : (
                      <motion.div
                        key="compact"
                        data-admin-player-compact-layout
                        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                        transition={prefersReducedMotion ? transition.instant : transition.quick}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 max-[460px]:grid-cols-1 max-[360px]:gap-2.5"
                      >
                        <motion.button
                          type="button"
                          drag={prefersReducedMotion ? false : 'x'}
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={0.18}
                          onDragStart={() => {
                            dockDraggedRef.current = true;
                            setIsDragging(true);
                          }}
                          onDragEnd={handleTrackDragEnd}
                          onClick={() => {
                            if (!dockDraggedRef.current) setExpanded(true);
                          }}
                          style={{ touchAction: 'pan-y' }}
                          className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-[var(--music-radius-detail)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] max-[460px]:grid-cols-[48px_minmax(0,1fr)]"
                          aria-label="展开后台播放器；左右滑动切换歌曲"
                        >
                          <span
                            className="relative h-[3.25rem] w-[3.25rem] overflow-hidden rounded-[var(--music-radius-artwork-sm)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] max-[460px]:h-12 max-[460px]:w-12"
                            aria-hidden="true"
                          >
                            {coverNode}
                          </span>

                          <span className="min-w-0">
                            <span data-eyebrow className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--aurora-1)]">
                              <Disc3 className="h-3.5 w-3.5" />
                              {playlistName}
                            </span>
                            <span className="mt-1 block truncate text-sm font-black" title={currentTrack.title}>{currentTrack.title}</span>
                            <span className="mt-0.5 block truncate text-xs text-[var(--ink-secondary)]">
                              {currentTrack.artist || '未知艺术家'} · {currentIndex + 1}/{queue.length}
                            </span>
                          </span>
                        </motion.button>

                        <div className="grid grid-cols-[44px_48px_44px_44px] items-center gap-2 max-[460px]:justify-self-center">
                          <button type="button" onClick={previousTrack} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent" aria-label="上一首" title="上一首">
                            <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
                          </button>
                          {renderPlayButton(false)}
                          <button type="button" onClick={nextTrack} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent" aria-label="下一首" title="下一首">
                            <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={closePlayer}
                            className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-muted)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                            aria-label="关闭后台播放器"
                            title="关闭后台播放器"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="col-span-full -mt-1">
                          {renderSeekBar(false)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {playbackError && (
                    <div role="alert" className="mt-2 flex items-center gap-2 rounded-[var(--music-radius-detail)] bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 py-2 text-xs text-[var(--ink-primary)]">
                      <AlertCircle className="h-4 w-4 shrink-0 text-[var(--signal-danger)]" />
                      <span className="min-w-0 flex-1">{playbackError}</span>
                      <button type="button" onClick={() => void retryPlayback()} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--music-radius-control)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 font-bold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">
                        <RefreshCw className="h-3.5 w-3.5" />
                        重新尝试
                      </button>
                    </div>
                  )}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
      </AdminMusicPlayerTimelineContext.Provider>
    </AdminMusicPlayerContext.Provider>
  );
}
