'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import {
  Disc3,
  Home,
  ListMusic,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
} from 'lucide-react';
import {
  formatMusicClock,
  resolveMusicCoverSrc,
  SeekBar,
  useMusicPlayer,
} from './MusicPlayerProvider';
import { MusicSkinSwitcher } from './MusicSkinSwitcher';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function MusicHallExperience() {
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
    lyrics,
    activeLyricIndex,
    skin,
    playIndex,
    playAll,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    setShuffle,
    setExpanded,
    setVolume,
  } = useMusicPlayer();

  const activeTrack = currentTrack ?? tracks[0];
  const cover = resolveMusicCoverSrc(activeTrack);
  const playlistName = player?.playlist?.name || '音乐大厅';
  const canPlay = Boolean(player?.enabled && tracks.length > 0 && activeTrack);

  const lyricsBoxRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLParagraphElement>(null);

  // 歌词跟随播放进度自动居中(与沉浸层一致)
  useEffect(() => {
    const line = activeLyricRef.current;
    const box = lyricsBoxRef.current;
    if (!line || !box) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [activeLyricIndex]);

  return (
    <main data-music-skin={skin} className="min-h-screen bg-[var(--bg-substrate)] pb-36 pt-28 text-[var(--ink-primary)]">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(145deg,color-mix(in_oklch,var(--aurora-1)_16%,transparent),transparent_34%),linear-gradient(0deg,color-mix(in_oklch,var(--aurora-4)_8%,transparent),transparent_58%)]" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <section className="surface-luminous grid min-h-[520px] grid-cols-1 overflow-hidden rounded-[2rem] lg:grid-cols-[minmax(0,1fr)_460px]">
          <div className="flex flex-col justify-between p-6 sm:p-8 lg:p-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-[var(--aurora-1)]">
                <Sparkles className="h-3.5 w-3.5" />
                Aether Music Hall
              </div>
              <h1 className="mt-6 max-w-3xl text-h1 font-black tracking-normal sm:text-display">
                音乐大厅
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--ink-secondary)] sm:text-lg">
                从媒体库映射而来的私有歌单陈列室。首页入口、个人卡片、后台播放与当前页面共享同一个播放核心，切换页面也不会打断正在播放的音乐。
              </p>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="播放队列" value={`${tracks.length}`} />
              <Metric label="播放策略" value={player?.playbackMode || 'SEQUENTIAL'} />
              <Metric label="随机" value={shuffle ? 'ON' : 'OFF'} />
              <Metric label="轮播" value={player?.carouselEnabled ? 'ON' : 'OFF'} />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => playAll({ expand: true })}
                disabled={!canPlay}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--aurora-1)] px-5 text-sm font-black text-[var(--bg-void)] shadow-[0_18px_44px_-22px_color-mix(in_oklch,var(--aurora-1)_90%,transparent)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                播放全部
              </button>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                disabled={!canPlay}
                className="inline-flex h-12 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-5 text-sm font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Disc3 className="h-4 w-4" />
                沉浸模式
              </button>
              <MusicSkinSwitcher />
              <Link
                href="/posts"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-5 text-sm font-bold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <Home className="h-4 w-4" />
                返回文章
              </Link>
            </div>
          </div>

          <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,var(--bg-substrate))] p-8 lg:border-l lg:border-t-0">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--aurora-1)_22%,transparent),transparent_62%)]" />
            <div className={cn('relative h-72 w-72 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[radial-gradient(circle,color-mix(in_oklch,black_84%,var(--aurora-1))_0_28%,color-mix(in_oklch,black_92%,var(--aurora-1))_29%_100%)] shadow-[0_28px_90px_-36px_color-mix(in_oklch,black_60%,transparent)]', isPlaying && 'music-vinyl-spin')}>
              <div className="absolute inset-[16%] rounded-full border border-[color-mix(in_oklch,white_10%,transparent)] bg-[color-mix(in_oklch,black_35%,transparent)]" />
              <div className="absolute inset-[29%] overflow-hidden rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[var(--bg-leaf)]">
                {cover ? (
                  <Image
                    src={cover}
                    alt={activeTrack?.title || '音乐封面'}
                    fill
                    sizes="12rem"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_oklch,var(--aurora-1)_30%,var(--bg-raised)),var(--bg-void))]">
                    <Disc3 className="h-16 w-16 text-[var(--ink-secondary)]" />
                  </div>
                )}
              </div>
              <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_oklch,white_82%,var(--aurora-1))]" />
            </div>
          </div>
        </section>

        {!canPlay ? (
          <section className="surface-leaf p-8 text-center">
            <ListMusic className="mx-auto h-10 w-10 text-[var(--ink-muted)]" />
            <h2 className="mt-4 text-2xl font-black">音乐大厅暂未开放</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--ink-secondary)]">
              请在后台音乐大厅启用公开播放器，并至少配置一个公开且包含可播放歌曲的歌单。
            </p>
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.7fr)]">
            <div className="surface-leaf p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">{playlistName}</p>
                  <h2 className="mt-2 text-3xl font-black tracking-normal">{activeTrack?.title}</h2>
                  <p className="mt-2 text-sm text-[var(--ink-secondary)]">{activeTrack?.artist || '未知艺术家'} · {activeTrack?.album || '未分专辑'}</p>
                </div>
                <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 py-1 text-xs font-bold text-[var(--ink-secondary)]">
                  {currentIndex + 1}/{tracks.length}
                </span>
              </div>

              <SeekBar percent={percent} progress={progress} duration={duration} onSeek={seekToPercent} size="lg" className="mt-6" />
              <div className="mt-2 flex items-center justify-between text-xs tnum text-[var(--ink-muted)]">
                <span>{formatMusicClock(progress)}</span>
                <span>{formatMusicClock(duration || activeTrack?.durationSeconds || 0)}</span>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={() => setShuffle((value) => !value)} className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors', shuffle ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]' : 'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]')} aria-label="随机播放" aria-pressed={shuffle}>
                  <Shuffle className="h-5 w-5" />
                </button>
                <button type="button" onClick={previousTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]" aria-label="上一首">
                  <SkipBack className="h-5 w-5" />
                </button>
                <button type="button" onClick={togglePlayback} className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--aurora-1)] text-[var(--bg-void)] shadow-[0_20px_44px_-20px_color-mix(in_oklch,var(--aurora-1)_85%,transparent)] transition-transform hover:scale-105" aria-label={isPlaying ? '暂停音乐' : '播放音乐'}>
                  {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
                </button>
                <button type="button" onClick={nextTrack} className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]" aria-label="下一首">
                  <SkipForward className="h-5 w-5" />
                </button>
                <label className="hidden h-12 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-4 text-[var(--ink-secondary)] sm:flex">
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

            <div className="surface-leaf p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Live Lyrics</p>
                  <h2 className="mt-1 text-xl font-black">歌词与封面动效</h2>
                </div>
                <Disc3 className={cn('h-5 w-5 text-[var(--ink-muted)]', isPlaying && 'animate-spin [animation-duration:3s]')} />
              </div>
              <div ref={lyricsBoxRef} className="mt-5 max-h-[360px] space-y-3 overflow-y-auto pr-1 scroll-smooth">
                {lyrics.length === 0 ? (
                  <p className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-4 text-sm leading-6 text-[var(--ink-secondary)]">
                    当前歌曲暂无歌词。后台维护 LRC 或纯文本歌词后，这里会自动跟随播放进度高亮。
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
            </div>

            <div className="surface-leaf p-5 sm:p-6 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Playlist</p>
                  <h2 className="mt-1 text-xl font-black">歌单队列</h2>
                </div>
                <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 py-1 text-xs text-[var(--ink-secondary)]">{tracks.length} 首</span>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tracks.map((track, index) => {
                  const itemCover = resolveMusicCoverSrc(track);
                  const active = activeTrack?.id === track.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => playIndex(index)}
                      className={cn(
                        'grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-3 text-left transition-all',
                        active
                          ? 'border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] shadow-[0_18px_54px_-40px_color-mix(in_oklch,var(--aurora-1)_90%,transparent)]'
                          : 'border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] hover:border-[color-mix(in_oklch,var(--ink-primary)_16%,transparent)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]'
                      )}
                    >
                      <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                        {itemCover ? (
                          <Image
                            src={itemCover}
                            alt={track.title}
                            fill
                            sizes="3.5rem"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <Disc3 className="h-6 w-6 text-[var(--ink-muted)]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-[var(--ink-primary)]">{track.title}</span>
                        <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{track.artist || '未知艺术家'} · {track.media?.originalName || '未加载媒体文件名'}</span>
                      </span>
                      {active && isPlaying ? (
                        <span className="flex h-7 items-end gap-0.5" aria-hidden="true">
                          <span className="music-eq-bar" />
                          <span className="music-eq-bar [animation-delay:140ms]" />
                          <span className="music-eq-bar [animation-delay:260ms]" />
                        </span>
                      ) : (
                        <Play className="h-4 w-4 text-[var(--ink-muted)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 truncate text-lg font-black text-[var(--ink-primary)]">{value}</p>
    </div>
  );
}
