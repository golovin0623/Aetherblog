import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import { Disc3, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { spring, transition } from '@aetherblog/ui';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';

const DISMISS_DRAG_DISTANCE = 86;
const DISMISS_DRAG_VELOCITY = 720;

function resolveAudioUrl(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media?.publicUrl || track.media?.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  return raw;
}

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
  playTracks: (tracks: MusicTrack[], index: number) => void;
  togglePlayback: () => Promise<void>;
  nextTrack: () => void;
  previousTrack: () => void;
  seekToPercent: (percent: number) => void;
  closePlayer: () => void;
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
  // 记录当前已 load 进 <audio> 的 URL —— 用来判断「重新点同一首」与「切到新一首」,
  // 替代用 currentIndex 比对(换队列后旧 index 的语义已失效,会抢播旧 src)。
  const loadedUrlRef = useRef('');
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [dockSuppressed, setDockSuppressed] = useState(false);
  const [dockDismissed, setDockDismissed] = useState(false);
  const currentTrack = queue[currentIndex];
  const audioUrl = resolveAudioUrl(currentTrack);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const cover = currentTrack?.coverUrl || currentTrack?.media?.thumbnailUrl || '';

  const lyrics = useMemo(() => parseLyric(currentTrack?.lyric), [currentTrack?.lyric]);
  const activeLyric = useMemo(() => activeLyricIndex(lyrics, progress), [lyrics, progress]);

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.src = audioUrl;
    audio.load();
    loadedUrlRef.current = audioUrl;
    setProgress(0);
    setDuration(currentTrack?.durationSeconds ?? 0);
    if (playingRef.current) {
      audio.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
      });
    }
  }, [audioUrl, currentTrack?.durationSeconds]);

  // 歌词跟随:把高亮行滚到容器中央(只滚容器,不动页面)
  useEffect(() => {
    const box = lyricsBoxRef.current;
    const line = activeLineRef.current;
    if (!expanded || !box || !line) return;
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' });
  }, [activeLyric, expanded]);

  const playTracks = useCallback((tracks: MusicTrack[], index: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    playingRef.current = true;
    setDockDismissed(false);
    setQueue(tracks);
    setCurrentIndex(safeIndex);
    setIsPlaying(true);
    // 目标曲目就是当前已加载的那首(同 URL)→ src effect 不会重跑,手动从头重播;
    // 否则交给 src 切换 effect 自动续播(playingRef 已置真),不抢播旧 src。
    const nextUrl = resolveAudioUrl(tracks[safeIndex]);
    const audio = audioRef.current;
    if (audio && nextUrl && nextUrl === loadedUrlRef.current) {
      audio.currentTime = 0;
      audio.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
      });
    }
  }, []);

  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;
    playingRef.current = true;
    setCurrentIndex((index) => (index + 1) % queue.length);
    setIsPlaying(true);
  }, [queue.length]);

  const previousTrack = useCallback(() => {
    if (queue.length === 0) return;
    playingRef.current = true;
    setCurrentIndex((index) => (index - 1 + queue.length) % queue.length);
    setIsPlaying(true);
  }, [queue.length]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (audio.paused) {
      try {
        if (!audio.src) audio.src = audioUrl;
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
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

  const seekToPercent = useCallback((p: number) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const next = Math.min(duration, Math.max(0, (p / 100) * duration));
    audio.currentTime = next;
    setProgress(next);
  }, [duration]);

  const closePlayer = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = false;
    loadedUrlRef.current = '';
    setIsPlaying(false);
    setExpanded(false);
    setDockDismissed(false);
    setQueue([]);
    setCurrentIndex(0);
    setProgress(0);
    setDuration(0);
  }, []);

  const dismissDock = useCallback(() => {
    setExpanded(false);
    setDockDismissed(true);
  }, []);

  const value = useMemo<AdminMusicPlayerContextValue>(() => ({
    queue,
    currentTrack,
    currentIndex,
    isPlaying,
    progress,
    duration,
    percent,
    playTracks,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    closePlayer,
    setDockSuppressed,
  }), [closePlayer, currentIndex, currentTrack, duration, isPlaying, nextTrack, percent, playTracks, previousTrack, progress, queue, seekToPercent, togglePlayback]);

  const playlistName = '后台播放';
  const coverNode = cover ? (
    <img src={cover} alt={currentTrack?.title || ''} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))]">
      <Disc3 className={cn('h-1/3 w-1/3 text-[var(--ink-secondary)]', isPlaying && 'animate-spin [animation-duration:6s]')} />
    </div>
  );

  const handleDockDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > DISMISS_DRAG_DISTANCE || info.velocity.y > DISMISS_DRAG_VELOCITY) {
      dismissDock();
    }
  }, [dismissDock]);

  const handleDockKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dismissDock();
  }, [dismissDock]);

  return (
    <AdminMusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={nextTrack}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : (currentTrack?.durationSeconds ?? 0));
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime || 0)}
      />
      <AnimatePresence>
        {currentTrack && !dockSuppressed && !dockDismissed && (
          <motion.div
            data-music-skin="crimson"
            layout
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 42, scale: 0.96 }}
            transition={prefersReducedMotion ? transition.quick : spring.soft}
            className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-3 sm:px-4"
          >
            <motion.div
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragDirectionLock
              dragSnapToOrigin
              dragConstraints={{ top: 0, bottom: 180 }}
              dragElastic={{ top: 0.02, bottom: 0.35 }}
              dragTransition={prefersReducedMotion ? { bounceStiffness: 600, bounceDamping: 60 } : { bounceStiffness: 360, bounceDamping: 34 }}
              whileDrag={prefersReducedMotion ? undefined : { scale: 0.985 }}
              onDragEnd={handleDockDragEnd}
              onKeyDown={handleDockKeyDown}
              aria-keyshortcuts="Escape"
              className="pointer-events-auto w-full max-w-[460px]"
            >
              <div className="surface-raised overflow-hidden rounded-[1.6rem] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)] p-3 text-[var(--ink-primary)] shadow-[0_24px_70px_-30px_color-mix(in_oklch,black_72%,transparent)] backdrop-blur-xl">
                <button
                  type="button"
                  onPointerDown={(event) => dragControls.start(event)}
                  onClick={() => setExpanded((v) => !v)}
                  className="mx-auto mb-2 flex h-11 w-28 cursor-grab touch-none items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:text-[var(--ink-secondary)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                  aria-label={expanded ? '拖动隐藏后台播放器,点击收起' : '拖动隐藏后台播放器,点击展开'}
                  aria-keyshortcuts="Escape"
                  title={expanded ? '拖动隐藏,点击收起' : '拖动隐藏,点击展开'}
                >
                  <span className="h-1.5 w-12 rounded-full bg-current opacity-35" />
                </button>

                {/* 展开区:封面 + 滚动歌词 */}
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key="expanded"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={prefersReducedMotion ? transition.instant : transition.flow}
                      className="overflow-hidden"
                    >
                      <div className="mb-3 grid grid-cols-[104px_minmax(0,1fr)] gap-3 sm:grid-cols-[118px_minmax(0,1fr)]">
                        <div className={cn(
                          'relative aspect-square overflow-hidden rounded-[1.35rem] border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]',
                          isPlaying && 'shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]'
                        )}>
                          {coverNode}
                        </div>
                        <div
                          ref={lyricsBoxRef}
                          className="relative max-h-[104px] overflow-y-auto pr-1 text-center text-sm leading-7 sm:max-h-[118px]"
                        >
                          {lyrics.length === 0 ? (
                            <div className="flex h-[104px] flex-col items-center justify-center gap-2 text-xs text-[var(--ink-muted)] sm:h-[118px]">
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
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 紧凑常驻行 */}
                <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5 sm:gap-3">
                  <div
                    className={cn(
                      'relative h-[3.25rem] w-[3.25rem] overflow-hidden rounded-[1rem] border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] shadow-[0_14px_30px_-22px_color-mix(in_oklch,black_70%,transparent)]',
                      isPlaying && 'ring-2 ring-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)]'
                    )}
                    aria-hidden="true"
                  >
                    {coverNode}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--aurora-1)]">
                      <Disc3 className={cn('h-3.5 w-3.5', isPlaying && 'animate-spin [animation-duration:3s]')} />
                      {playlistName}
                    </div>
                    <p className="mt-1 truncate text-sm font-black">{currentTrack.title}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--ink-secondary)]">
                      {currentTrack.artist || '未知艺术家'} · 队列 {currentIndex + 1}/{queue.length}
                    </p>
                    <div
                      role="slider"
                      tabIndex={0}
                      onClick={(event) => seekToClientX(event.clientX, event.currentTarget.getBoundingClientRect())}
                      onKeyDown={(event) => {
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
                      }}
                      className="mt-1.5 flex h-5 w-full cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                      aria-label="调整播放进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(percent)}
                      aria-valuetext={`${formatClock(progress)} / ${formatClock(duration || currentTrack.durationSeconds || 0)}`}
                    >
                      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]">
                        <span className="block h-full rounded-full bg-[var(--aurora-1)] transition-[width] duration-200" style={{ width: `${percent}%` }} />
                      </span>
                    </div>
                    {expanded && (
                      <div className="mt-1 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
                        <span>{formatClock(progress)}</span>
                        <span>{formatClock(duration || currentTrack.durationSeconds || 0)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button type="button" onClick={previousTrack} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]" aria-label="上一首" title="上一首">
                      <SkipBack className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlayback}
                      className="relative flex h-12 min-h-12 w-12 min-w-12 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_16px_36px_-18px_color-mix(in_oklch,var(--aurora-1)_85%,transparent)] transition-transform hover:scale-105"
                      aria-label={isPlaying ? '暂停后台播放' : '继续后台播放'}
                      title={isPlaying ? '暂停' : '播放'}
                    >
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
                    </button>
                    <button type="button" onClick={nextTrack} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]" aria-label="下一首" title="下一首">
                      <SkipForward className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminMusicPlayerContext.Provider>
  );
}
