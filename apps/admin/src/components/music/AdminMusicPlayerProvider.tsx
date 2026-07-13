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
  resolveAdminMediaErrorMessage,
} from './adminMusicPlayerState';

const DISMISS_DRAG_DISTANCE = 86;
const DISMISS_DRAG_VELOCITY = 720;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// ---- 紧凑 LRC 解析(后台试听用,与前台 parseMusicLyric 行为一致) ----
interface LyricLine {
  time: number | null;
  text: string;
}

function parseLyric(raw: string | undefined | null): LyricLine[] {
  if (!raw || !raw.trim()) return [];
  const out: LyricLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(re, '').trim();
    re.lastIndex = 0;
    const matches = Array.from(line.matchAll(re));
    if (matches.length === 0) {
      if (text) out.push({ time: null, text });
      continue;
    }
    for (const m of matches) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      out.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text: text || '♪' });
    }
  }
  return out.sort((a, b) => (a.time ?? Number.MAX_SAFE_INTEGER) - (b.time ?? Number.MAX_SAFE_INTEGER));
}

function activeLyricIndex(lines: LyricLine[], progress: number): number {
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
  queue: MusicTrack[];
  currentTrack?: MusicTrack;
  currentIndex: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  percent: number;
  playbackError: string | null;
  playTracks: (tracks: MusicTrack[], index: number) => void;
  togglePlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  seekToPercent: (percent: number) => void;
  retryPlayback: () => Promise<void>;
  closePlayer: () => void;
  setMusicSkin: (value: string, seed?: string) => void;
  /** 页面级抑制浮层(如音乐管理页已有内嵌播放卡,避免重复 + 遮挡) */
  setDockSuppressed: (suppressed: boolean) => void;
}

const AdminMusicPlayerContext = createContext<AdminMusicPlayerContextValue | null>(null);

export function useAdminMusicPlayer() {
  const context = useContext(AdminMusicPlayerContext);
  if (!context) {
    throw new Error('useAdminMusicPlayer must be used within AdminMusicPlayerProvider');
  }
  return context;
}

export function AdminMusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const dragControls = useDragControls();
  const prefersReducedMotion = useReducedMotion();
  const dockDraggedRef = useRef(false);
  // 记录当前已 load 进 <audio> 的 URL —— 用来判断「重新点同一首」与「切到新一首」,
  // 替代用 currentIndex 比对(换队列后旧 index 的语义已失效,会抢播旧 src)。
  const loadedUrlRef = useRef('');
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const [dockSuppressed, setDockSuppressed] = useState(false);
  const [musicSkin, setMusicSkinState] = useState<{ value: string; seed?: string }>({ value: 'crimson' });
  const currentTrack = queue[currentIndex];
  const audioUrl = resolveAdminAudioUrl(currentTrack);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const cover = currentTrack?.coverUrl || currentTrack?.media?.thumbnailUrl || '';

  const lyrics = useMemo(() => parseLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const activeLyric = useMemo(() => activeLyricIndex(lyrics, progress), [lyrics, progress]);

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLParagraphElement>(null);
  const inputModalityRef = useRef<'keyboard' | 'pointer'>('keyboard');

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
  });

  useEffect(() => {
    if (autoCollapseDelay == null) return;
    const timeout = window.setTimeout(() => setExpanded(false), autoCollapseDelay);
    return () => window.clearTimeout(timeout);
  }, [autoCollapseDelay, currentIndex, interactionVersion]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      loadedUrlRef.current = '';
      playingRef.current = false;
      setIsPlaying(false);
      setProgress(0);
      setDuration(currentTrack?.durationSeconds ?? 0);
      setPlaybackError(currentTrack ? '找不到可播放的媒体文件。' : null);
      return;
    }
    // playTracks may already have started this URL inside the user's click task.
    // Reloading the same source here would interrupt it and lose user activation.
    if (loadedUrlRef.current === audioUrl) {
      setDuration(currentTrack?.durationSeconds ?? 0);
      return;
    }
    const shouldContinuePlaying = playingRef.current;
    audio.src = audioUrl;
    audio.load();
    setPlaybackError(null);
    loadedUrlRef.current = audioUrl;
    setProgress(0);
    setDuration(currentTrack?.durationSeconds ?? 0);
    if (shouldContinuePlaying) {
      audio.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
        setPlaybackError('这首歌暂时无法播放。');
      });
    }
  }, [audioUrl, currentTrack?.durationSeconds]);

  // 歌词跟随:把高亮行滚到容器中央(只滚容器,不动页面)
  useEffect(() => {
    const box = lyricsBoxRef.current;
    const line = activeLineRef.current;
    if (!expanded || !box || !line) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeLyric, expanded, prefersReducedMotion]);

  const playTracks = useCallback((tracks: MusicTrack[], index: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    const nextUrl = resolveAdminAudioUrl(tracks[safeIndex]);
    setQueue(tracks);
    setCurrentIndex(safeIndex);
    setPlaybackError(null);
    if (!nextUrl) {
      playingRef.current = false;
      setIsPlaying(false);
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    playingRef.current = true;
    setIsPlaying(true);
    // Start every click-selected track inside the same user gesture. The source
    // effect recognizes loadedUrlRef and will not reload this exact URL.
    const audio = audioRef.current;
    if (audio) {
      if (nextUrl !== loadedUrlRef.current) {
        audio.src = nextUrl;
        loadedUrlRef.current = nextUrl;
        audio.load();
      } else {
        audio.currentTime = 0;
      }
      audio.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
        setPlaybackError('这首歌暂时无法播放。');
      });
    }
  }, []);

  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;
    const { nextIndex, restartCurrent } = resolveAdminAdjacentTrack({
      currentIndex,
      direction: 1,
      trackCount: queue.length,
    });
    playingRef.current = true;
    setPlaybackError(null);
    if (restartCurrent) {
      if (!audioUrl) {
        playingRef.current = false;
        setIsPlaying(false);
        setPlaybackError('找不到可播放的媒体文件。');
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setProgress(0);
        audio.play().catch(() => {
          playingRef.current = false;
          setIsPlaying(false);
          setPlaybackError('这首歌暂时无法播放。');
        });
      }
      return;
    }
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [audioUrl, currentIndex, queue.length]);

  const previousTrack = useCallback(() => {
    if (queue.length === 0) return;
    const { nextIndex, restartCurrent } = resolveAdminAdjacentTrack({
      currentIndex,
      direction: -1,
      trackCount: queue.length,
    });
    playingRef.current = true;
    setPlaybackError(null);
    if (restartCurrent) {
      if (!audioUrl) {
        playingRef.current = false;
        setIsPlaying(false);
        setPlaybackError('找不到可播放的媒体文件。');
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setProgress(0);
        audio.play().catch(() => {
          playingRef.current = false;
          setIsPlaying(false);
          setPlaybackError('这首歌暂时无法播放。');
        });
      }
      return;
    }
    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [audioUrl, currentIndex, queue.length]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    if (audio.paused) {
      try {
        if (!audio.src) audio.src = audioUrl;
        setPlaybackError(null);
        await audio.play();
      } catch {
        playingRef.current = false;
        setIsPlaying(false);
        setPlaybackError('这首歌暂时无法播放。');
      }
    } else {
      audio.pause();
    }
  }, [audioUrl]);

  const retryPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) {
      setPlaybackError('找不到可播放的媒体文件。');
      return;
    }
    try {
      setPlaybackError(null);
      playingRef.current = true;
      audio.load();
      await audio.play();
    } catch {
      playingRef.current = false;
      setIsPlaying(false);
      setPlaybackError('仍然无法播放，请检查媒体文件或稍后再试。');
    }
  }, [audioUrl]);

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

  const closePlayer = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    playingRef.current = false;
    loadedUrlRef.current = '';
    setIsPlaying(false);
    setExpanded(false);
    setQueue([]);
    setCurrentIndex(0);
    setProgress(0);
    setDuration(0);
    setPlaybackError(null);
  }, []);

  const setMusicSkin = useCallback((value: string, seed?: string) => {
    setMusicSkinState((current) => (
      current.value === value && current.seed === seed ? current : { value, seed }
    ));
  }, []);

  const dismissDock = useCallback(() => {
    closePlayer();
  }, [closePlayer]);

  const value = useMemo<AdminMusicPlayerContextValue>(() => ({
    queue,
    currentTrack,
    currentIndex,
    isPlaying,
    progress,
    duration,
    percent,
    playbackError,
    playTracks,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    retryPlayback,
    closePlayer,
    setMusicSkin,
    setDockSuppressed,
  }), [closePlayer, currentIndex, currentTrack, duration, isPlaying, nextTrack, percent, playTracks, playbackError, previousTrack, progress, queue, retryPlayback, seekToPercent, setMusicSkin, togglePlayback]);

  const playlistName = '后台播放';
  const coverNode = cover ? (
    <img src={cover} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))]">
      <Disc3 className="h-1/3 w-1/3 text-[var(--ink-secondary)]" />
    </div>
  );

  const handleDockDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > DISMISS_DRAG_DISTANCE || info.velocity.y > DISMISS_DRAG_VELOCITY) {
      dismissDock();
    }
    window.setTimeout(() => {
      dockDraggedRef.current = false;
    }, 0);
  }, [dismissDock]);

  const handleDockKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dismissDock();
  }, [dismissDock]);

  const markPlayerActivity = useCallback(() => {
    setInteractionVersion((version) => version + 1);
  }, []);

  const handlePlayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    markPlayerActivity();
    handleDockKeyDown(event);
  }, [handleDockKeyDown, markPlayerActivity]);

  const handleSeekKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      seekToPercent(Math.min(100, percent + 5));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      seekToPercent(Math.max(0, percent - 5));
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekToPercent(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekToPercent(100);
    }
  }, [percent, seekToPercent]);

  const resolvedDuration = duration || currentTrack?.durationSeconds || 0;
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
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => {
          playingRef.current = true;
          setIsPlaying(true);
        }}
        onPause={() => {
          playingRef.current = false;
          setIsPlaying(false);
        }}
        onError={() => {
          const audio = audioRef.current;
          if (!audio?.getAttribute('src')) return;
          playingRef.current = false;
          setIsPlaying(false);
          setPlaybackError(resolveAdminMediaErrorMessage(audio.error?.code));
        }}
        onEnded={nextTrack}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : (currentTrack?.durationSeconds ?? 0));
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime || 0)}
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
            className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4 max-[360px]:px-3"
          >
            <motion.div
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragDirectionLock
              dragSnapToOrigin
              dragMomentum={false}
              dragConstraints={{ top: 0, bottom: 180 }}
              dragElastic={{ top: 0, bottom: 0.18 }}
              onDragStart={() => {
                dockDraggedRef.current = true;
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
                  type="button"
                  onPointerDown={(event) => dragControls.start(event)}
                  onClick={() => {
                    if (dockDraggedRef.current) return;
                    setExpanded((value) => !value);
                  }}
                  data-admin-player-drag-handle
                  className="absolute left-1/2 -top-8 z-20 flex h-11 w-24 -translate-x-1/2 cursor-grab touch-none items-end justify-center rounded-full pb-2 text-[var(--ink-muted)] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:text-[var(--ink-secondary)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  aria-label={expanded ? '下拖关闭后台播放器,点击收起' : '下拖关闭后台播放器,点击展开'}
                  aria-keyshortcuts="Escape"
                  aria-expanded={expanded}
                  aria-controls="admin-music-player-expanded"
                  title={expanded ? '下拖关闭,点击收起' : '下拖关闭,点击展开'}
                >
                  <span className="h-1 w-10 rounded-full bg-current opacity-30" />
                </button>
                <motion.div
                  layout="size"
                  transition={prefersReducedMotion ? transition.instant : transition.quick}
                  className="surface-raised relative max-h-[calc(100dvh_-_5rem_-_env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-[var(--music-radius-panel)] p-3 text-[var(--ink-primary)]"
                >
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
                        <div className="relative aspect-square overflow-hidden rounded-[var(--music-radius-artwork-lg)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]">
                          {coverNode}
                        </div>
                        <div
                          ref={lyricsBoxRef}
                          className="relative h-[104px] overflow-y-auto overscroll-contain pr-1 text-center text-sm leading-7 [scrollbar-width:none] max-[380px]:h-[88px] sm:h-[120px]"
                          aria-label="歌词"
                        >
                          {lyrics.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--ink-muted)]">
                              <Music2 className="h-5 w-5" />
                              暂无歌词
                            </div>
                          ) : (
                            lyrics.map((line, index) => {
                              const active = index === activeLyric;
                              return (
                                <p
                                  key={`${line.time ?? 'plain'}-${index}`}
                                  ref={active ? activeLineRef : undefined}
                                  className={cn(
                                    'truncate transition-colors duration-300',
                                    active ? 'font-black text-[var(--aurora-1)]' : 'text-[var(--ink-muted)]'
                                  )}
                                >
                                  {line.text}
                                </p>
                              );
                            })
                          )}
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
                        className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 max-[460px]:grid-cols-[48px_minmax(0,1fr)] max-[360px]:gap-2.5"
                      >
                        <div
                          className="relative h-[3.25rem] w-[3.25rem] overflow-hidden rounded-[var(--music-radius-artwork-sm)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] max-[460px]:h-12 max-[460px]:w-12"
                          aria-hidden="true"
                        >
                          {coverNode}
                        </div>

                        <div className="min-w-0">
                          <div data-eyebrow className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--aurora-1)]">
                            <Disc3 className="h-3.5 w-3.5" />
                            {playlistName}
                          </div>
                          <p className="mt-1 truncate text-sm font-black" title={currentTrack.title}>{currentTrack.title}</p>
                          <p className="mt-0.5 truncate text-xs text-[var(--ink-secondary)]">
                            {currentTrack.artist || '未知艺术家'} · {currentIndex + 1}/{queue.length}
                          </p>
                          <div className="mt-0.5">
                            {renderSeekBar(false)}
                          </div>
                        </div>

                        <div className="grid grid-cols-[48px_44px_44px] items-center gap-1 max-[460px]:col-span-2 max-[460px]:mt-1 max-[460px]:justify-self-center">
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
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminMusicPlayerContext.Provider>
  );
}
