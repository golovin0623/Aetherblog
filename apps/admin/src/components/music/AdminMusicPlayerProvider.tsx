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
import { Disc3, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';

function resolveAudioUrl(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media.publicUrl || track.media.fileUrl || '';
  if (!raw) return '';
  if (raw.startsWith('uploads/')) return `/${raw}`;
  return raw;
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
  closePlayer: () => void;
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
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentTrack = queue[currentIndex];
  const audioUrl = resolveAudioUrl(currentTrack);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.src = audioUrl;
    audio.load();
    setProgress(0);
    setDuration(currentTrack?.durationSeconds ?? 0);
    if (playingRef.current) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [audioUrl, currentTrack?.durationSeconds]);

  const playTracks = useCallback((tracks: MusicTrack[], index: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    setQueue(tracks);
    setCurrentIndex(safeIndex);
    setIsPlaying(true);
    if (safeIndex === currentIndex) {
      audioRef.current?.play().catch(() => setIsPlaying(false));
    }
  }, [currentIndex]);

  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndex((index) => (index + 1) % queue.length);
    setIsPlaying(true);
  }, [queue.length]);

  const previousTrack = useCallback(() => {
    if (queue.length === 0) return;
    setCurrentIndex((index) => (index - 1 + queue.length) % queue.length);
    setIsPlaying(true);
  }, [queue.length]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    try {
      if (!audio.src) audio.src = audioUrl;
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [audioUrl, isPlaying]);

  const closePlayer = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setQueue([]);
    setCurrentIndex(0);
    setProgress(0);
    setDuration(0);
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
    closePlayer,
  }), [closePlayer, currentIndex, currentTrack, duration, isPlaying, nextTrack, percent, playTracks, previousTrack, progress, queue, togglePlayback]);

  return (
    <AdminMusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onEnded={nextTrack}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : (currentTrack?.durationSeconds ?? 0));
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime || 0)}
      />
      {currentTrack && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[rgba(20,17,17,0.92)] p-3 text-white shadow-2xl backdrop-blur-xl">
          <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3">
            <button
              type="button"
              onClick={togglePlayback}
              className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[#ff4d4f] text-white shadow-[0_16px_36px_-18px_rgba(255,77,79,0.95)]"
              aria-label={isPlaying ? '暂停后台播放' : '继续后台播放'}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ffb4a9]">
                <Disc3 className={cn('h-3.5 w-3.5', isPlaying && 'animate-spin [animation-duration:3s]')} />
                后台播放
              </div>
              <p className="mt-1 truncate text-sm font-black">{currentTrack.title}</p>
              <p className="mt-1 truncate text-xs text-white/55">
                {currentTrack.artist || '未知艺术家'} · 队列 {currentIndex + 1}/{queue.length}
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#ff4d4f] transition-[width] duration-200" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={previousTrack} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/68 transition-colors hover:text-white" aria-label="上一首">
                <SkipBack className="h-4 w-4" />
              </button>
              <button type="button" onClick={nextTrack} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/68 transition-colors hover:text-white" aria-label="下一首">
                <SkipForward className="h-4 w-4" />
              </button>
              <button type="button" onClick={closePlayer} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/68 transition-colors hover:text-white" aria-label="关闭播放器">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminMusicPlayerContext.Provider>
  );
}
