'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Disc3,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
} from 'lucide-react';
import { stagger, variants } from '@aetherblog/ui';
import {
  formatMusicClock,
  NowPlayingGlyph,
  resolveMusicCoverSrc,
  SeekBar,
  useMusicPlayer,
  useMusicPlayerTimeline,
} from './MusicPlayerProvider';
import { MusicSkinSwitcher } from './MusicSkinSwitcher';
import { resolveMusicTrackPresentation } from './musicPlayerState';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

/* 正在播放光带 —— 订阅高频 timeline context,与整页低频渲染隔离 */
function HallNowPlayingStrip({
  title,
  artist,
  onSeek,
  onOpenDeck,
}: {
  title: string;
  artist: string;
  onSeek: (percent: number) => void;
  onOpenDeck: () => void;
}) {
  const { progress, duration, percent } = useMusicPlayerTimeline();
  return (
    <div
      role="group"
      aria-label="正在播放"
      className="mt-6 max-w-xl rounded-[var(--music-radius-detail)] bg-[var(--music-control-fill)] px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--music-stroke)]"
    >
      <div className="flex items-center gap-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
          {artist && <span className="text-[var(--ink-muted)]"> · {artist}</span>}
        </p>
        <button
          type="button"
          onClick={onOpenDeck}
          className="music-control-button music-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
          aria-label="打开播放台"
          title="打开播放台"
        >
          <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      <SeekBar percent={percent} progress={progress} duration={duration} onSeek={onSeek} size="sm" className="-my-1.5" />
      <div className="flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
        <span>{formatMusicClock(progress)}</span>
        <span>{formatMusicClock(duration)}</span>
      </div>
    </div>
  );
}

/* 骨架屏 —— 与最终布局同构(设计红线:禁 spinner) */
function HallSkeleton() {
  return (
    <section role="status" aria-live="polite" className="pb-7">
      <span className="sr-only">正在准备音乐大厅,载入今天的歌单…</span>
      <div className="border-b border-[var(--music-stroke)] pb-7 min-[769px]:grid min-[769px]:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] min-[769px]:items-end min-[769px]:gap-10 min-[769px]:pb-9">
        <div className="music-skeleton mx-auto aspect-square w-[min(58vw,14rem)] !rounded-[var(--music-radius-artwork-lg)] min-[769px]:mx-0 min-[769px]:w-full" />
        <div className="mt-6 min-[769px]:mt-0">
          <div className="music-skeleton h-3 w-16" />
          <div className="music-skeleton mt-4 h-10 w-2/3" />
          <div className="music-skeleton mt-4 h-4 w-1/2" />
          <div className="music-skeleton mt-3 h-3 w-24" />
          <div className="mt-6 flex gap-3">
            <div className="music-skeleton h-12 w-28" />
            <div className="music-skeleton h-12 w-28" />
          </div>
        </div>
      </div>
      <div className="mt-8 space-y-0 border-t border-[var(--music-stroke)]">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-[var(--music-stroke)] py-3.5">
            <div className="music-skeleton h-3 w-6" />
            <div className="music-skeleton h-11 w-11 !rounded-[var(--music-radius-artwork-sm)]" />
            <div className="min-w-0 flex-1">
              <div className="music-skeleton h-3.5 w-1/3" />
              <div className="music-skeleton mt-2 h-3 w-1/4" />
            </div>
            <div className="music-skeleton h-3 w-10" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function MusicHallExperience() {
  const {
    player,
    isPlayerLoading,
    playerLoadError,
    retryPlayer,
    tracks,
    currentTrack,
    isPlaying,
    isBuffering,
    playbackError,
    hasPlaybackSession,
    skin,
    playIndex,
    playAll,
    playShuffled,
    togglePlayback,
    retryPlayback,
    seekToPercent,
    setExpanded,
  } = useMusicPlayer();

  const firstTrack = tracks[0];
  const trackCover = resolveMusicCoverSrc(firstTrack);
  const playlistCover = sanitizeImageUrl(player?.playlist?.coverUrl, trackCover);
  const playlistName = player?.playlist?.name || '音乐大厅';
  const playlistDescription = player?.playlist?.description?.trim() || '私人收藏，持续更新。';
  const canPlay = Boolean(player?.enabled && tracks.length > 0 && firstTrack);
  const totalDuration = tracks.reduce((sum, track) => sum + (track.durationSeconds || 0), 0);
  const playlistMeta = `${tracks.length} 首${totalDuration > 0 ? ` · ${formatMusicClock(totalDuration)}` : ''}`;

  const currentPresentation = resolveMusicTrackPresentation(currentTrack ?? {});
  const currentCover = resolveMusicCoverSrc(currentTrack);
  // 房间的光源:播放中跟随当前曲目封面,否则用歌单封面
  const ambientCover = (hasPlaybackSession && currentCover) || playlistCover;
  const featuredEntries = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.isFeatured);

  return (
    <main
      data-music-skin={skin}
      className="relative isolate min-h-screen overflow-x-clip bg-[var(--bg-substrate)] pb-44 pt-20 text-[var(--ink-primary)] sm:pt-28"
    >
      <div className="music-hall-ambient" aria-hidden="true">
        {ambientCover && (
          // eslint-disable-next-line @next/next/no-img-element -- 纯装饰氛围光,高斯化渲染,无需优化管线
          <img src={ambientCover} alt="" draggable={false} />
        )}
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-7 lg:px-8">
        {isPlayerLoading ? (
          <HallSkeleton />
        ) : playerLoadError ? (
          <section className="flex min-h-[55vh] items-center justify-center text-center" role="alert">
            <div>
              <AlertCircle className="mx-auto h-9 w-9 text-[var(--signal-danger)]" />
              <h1 className="mt-5 text-2xl font-black">暂时无法载入音乐</h1>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">连接没有成功。检查网络后重新载入。</p>
              <button
                type="button"
                onClick={retryPlayer}
                className="music-control-button music-pill-button mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--ink-primary)] px-5 text-sm text-[var(--bg-void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]"
              >
                <RefreshCw className="h-4 w-4" />
                重新载入
              </button>
            </div>
          </section>
        ) : !canPlay ? (
          <section className="flex min-h-[55vh] items-center justify-center text-center">
            <div>
              <ListMusic className="mx-auto h-10 w-10 text-[var(--ink-muted)]" />
              <h1 className="mt-5 text-2xl font-black">歌单还在准备中</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--ink-secondary)]">
                这里暂时没有可播放的音乐。可以先去看看文章，稍后再回来。
              </p>
              <Link
                href="/posts"
                className="music-control-button music-pill-button mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--music-control-fill)] px-5 text-sm text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)]"
              >
                先去看看文章
              </Link>
            </div>
          </section>
        ) : (
          <>
            <motion.section
              data-music-library-hero
              variants={variants.fadeUp}
              initial="initial"
              animate="animate"
              className="border-b border-[var(--music-stroke)] pb-8 min-[769px]:grid min-[769px]:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] min-[769px]:items-end min-[769px]:gap-10 min-[769px]:pb-10"
            >
              <div
                className={cn(
                  'music-hall-hero-art mx-auto min-[769px]:mx-0',
                  playlistCover ? 'w-[min(58vw,14rem)] min-[769px]:w-full' : 'w-32 min-[769px]:w-48'
                )}
              >
                <div
                  className={cn(
                    'music-hall-hero-art-frame relative aspect-square overflow-hidden rounded-[var(--music-radius-artwork-lg)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,var(--bg-raised))]',
                  )}
                >
                  {playlistCover ? (
                    <Image
                      src={playlistCover}
                      alt={`${playlistName}封面`}
                      fill
                      priority
                      sizes="(max-width: 768px) 58vw, 17rem"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--ink-muted)]">
                      <Disc3 className="h-9 w-9" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">暂无封面</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-7 min-w-0 min-[769px]:mt-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      data-eyebrow
                      className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--aurora-1)]"
                    >
                      <span className="inline-block h-1 w-1 rounded-full bg-[var(--aurora-1)] shadow-[0_0_8px_var(--aurora-1)]" aria-hidden="true" />
                      {hasPlaybackSession ? '正在播放' : '歌单'}
                    </p>
                    <h1 className="mt-2.5 break-words text-[length:var(--music-fs-hall-title)] font-black leading-[1.08] tracking-[-0.02em]">
                      {playlistName}
                    </h1>
                  </div>
                  <MusicSkinSwitcher iconOnly className="shrink-0 min-[769px]:hidden" />
                </div>
                <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--ink-secondary)] sm:text-base">
                  {playlistDescription}
                </p>
                <p className="mt-2.5 text-xs tnum font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{playlistMeta}</p>

                <div data-music-play-actions className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={() => playAll()}
                    disabled={!canPlay}
                    aria-label="播放歌单"
                    className="music-control-button music-hall-cta-primary inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-[var(--music-radius-control)] bg-[var(--ink-primary)] px-4 text-[15px] font-semibold text-[var(--bg-void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-28 sm:px-[18px]"
                  >
                    <Play className="h-[18px] w-[18px] translate-x-px fill-current" strokeWidth={1.6} />
                    播放
                  </button>
                  <button
                    type="button"
                    onClick={() => playShuffled()}
                    disabled={!canPlay}
                    aria-label="随机播放歌单"
                    className="music-control-button inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-[var(--music-radius-control)] bg-[var(--music-control-fill)] px-4 text-[15px] font-semibold text-[var(--ink-primary)] shadow-[inset_0_0_0_0.5px_var(--music-stroke)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-28 sm:px-[18px]"
                  >
                    <Shuffle className="h-[18px] w-[18px]" strokeWidth={1.8} />
                    随机播放
                  </button>
                  <MusicSkinSwitcher iconOnly className="hidden shrink-0 min-[769px]:block" />
                </div>

                {playbackError && (
                  <div role="alert" className="mt-4 flex max-w-xl items-center gap-2.5 rounded-[var(--music-radius-detail)] bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 py-1.5 text-sm text-[var(--signal-danger)] min-[769px]:w-fit">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{playbackError}</span>
                    <button
                      type="button"
                      onClick={() => void retryPlayback()}
                      className="music-control-button music-pill-button min-h-11 shrink-0 bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 font-semibold text-[var(--signal-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                    >
                      重新尝试
                    </button>
                  </div>
                )}

                {hasPlaybackSession && !playbackError && currentTrack && (
                  <HallNowPlayingStrip
                    title={currentPresentation.title}
                    artist={currentPresentation.artist}
                    onSeek={seekToPercent}
                    onOpenDeck={() => setExpanded(true)}
                  />
                )}
              </div>
            </motion.section>

            {featuredEntries.length > 0 && (
              <section aria-label="主打歌曲" className="pt-9">
                <div className="flex items-end justify-between gap-4 pb-4">
                  <div>
                    <p data-eyebrow className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">主打</p>
                    <h2 className="mt-1.5 text-xl font-black">精选放送</h2>
                  </div>
                </div>
                <motion.div
                  variants={{ animate: { transition: stagger(40) } }}
                  initial="initial"
                  animate="animate"
                  className="music-featured-rail -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-3 sm:-mx-7 sm:px-7 lg:-mx-8 lg:px-8"
                >
                  {featuredEntries.map(({ track, index }) => {
                    const cardCover = resolveMusicCoverSrc(track);
                    const cardActive = hasPlaybackSession && currentTrack?.id === track.id;
                    const cardPresentation = resolveMusicTrackPresentation(track);
                    return (
                      <motion.button
                        key={track.id}
                        type="button"
                        variants={variants.fadeUp}
                        onClick={() => {
                          if (!cardActive) {
                            playIndex(index);
                          } else if (playbackError) {
                            void retryPlayback();
                          } else {
                            void togglePlayback();
                          }
                        }}
                        aria-label={cardActive ? (isPlaying ? `暂停 ${cardPresentation.title}` : `继续播放 ${cardPresentation.title}`) : `播放 ${cardPresentation.title}`}
                        className="music-featured-card group w-44 shrink-0 snap-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] sm:w-48"
                      >
                        <span className="music-featured-card-art relative block aspect-square">
                          {cardCover ? (
                            <Image src={cardCover} alt="" fill sizes="12rem" className="object-cover" unoptimized />
                          ) : (
                            <span className="grid h-full w-full place-items-center bg-[color-mix(in_oklch,var(--ink-primary)_5%,var(--bg-raised))] text-[var(--ink-muted)]">
                              <Disc3 className="h-8 w-8" />
                            </span>
                          )}
                          <span className="music-featured-card-scrim" aria-hidden="true" />
                          <span
                            className={cn(
                              'absolute bottom-2.5 right-2.5 grid h-11 w-11 place-items-center rounded-full bg-[color-mix(in_oklch,var(--bg-void)_58%,transparent)] text-white backdrop-blur-sm transition-opacity duration-200',
                              cardActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                            )}
                            aria-hidden="true"
                          >
                            {cardActive && isBuffering ? (
                              <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={1.8} />
                            ) : cardActive && isPlaying ? (
                              <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} />
                            ) : (
                              <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />
                            )}
                          </span>
                        </span>
                        <span className="block px-3.5 pb-3.5 pt-3">
                          <span className={cn('block truncate text-sm font-bold', cardActive ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>
                            {cardPresentation.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">
                            {cardPresentation.artist || track.album || playlistName}
                          </span>
                        </span>
                      </motion.button>
                    );
                  })}
                </motion.div>
              </section>
            )}

            <section id="playlist" data-music-track-list className="pt-8 sm:pt-10">
              <div className="flex items-end justify-between gap-4 pb-3">
                <div>
                  <p data-eyebrow className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">播放列表</p>
                  <h2 className="mt-1.5 text-xl font-black">歌曲</h2>
                </div>
                <span className="text-xs tnum text-[var(--ink-muted)]">{playlistMeta}</span>
              </div>

              <div
                data-eyebrow
                aria-hidden="true"
                className="hidden border-b border-[var(--music-stroke)] pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)] sm:grid sm:grid-cols-[2rem_44px_minmax(0,1fr)_minmax(0,9rem)_4.5rem] sm:items-center sm:gap-4 sm:px-2"
              >
                <span className="text-center">#</span>
                <span />
                <span>标题</span>
                <span>专辑</span>
                <span className="text-right">时长</span>
              </div>

              <motion.div
                variants={{ animate: { transition: stagger(30) } }}
                initial="initial"
                animate="animate"
                className="border-t border-[var(--music-stroke)] sm:border-t-0"
              >
                {tracks.map((track, index) => {
                  const itemCover = resolveMusicCoverSrc(track, '', 'thumbnail');
                  const active = hasPlaybackSession && currentTrack?.id === track.id;
                  const presentation = resolveMusicTrackPresentation(track);
                  const artistLine = presentation.artist || playlistName;
                  const albumLine = track.album || '—';
                  const durationLabel = formatMusicClock(track.durationSeconds || 0);
                  return (
                    <motion.button
                      key={track.id}
                      type="button"
                      variants={variants.fadeUp}
                      onClick={() => {
                        if (!active) {
                          playIndex(index);
                        } else if (playbackError) {
                          void retryPlayback();
                        } else {
                          void togglePlayback();
                        }
                      }}
                      aria-current={active ? 'true' : undefined}
                      aria-label={active
                        ? playbackError
                          ? `重新尝试 ${presentation.title}`
                          : isBuffering
                            ? `取消载入 ${presentation.title}`
                            : isPlaying
                              ? `暂停 ${presentation.title}`
                              : `继续播放 ${presentation.title}`
                        : `播放 ${presentation.title}`}
                      className="music-hall-row group grid min-h-[64px] w-full grid-cols-[1.75rem_44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--music-stroke)] px-2 py-2.5 text-left transition-colors hover:bg-[var(--music-control-fill)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] sm:grid-cols-[2rem_44px_minmax(0,1fr)_minmax(0,9rem)_4.5rem] sm:gap-4"
                    >
                      <span className="grid place-items-center text-xs tnum text-[var(--ink-muted)]">
                        {active && isPlaying ? (
                          <NowPlayingGlyph />
                        ) : (
                          <>
                            <span className="group-hover:hidden">{String(index + 1).padStart(2, '0')}</span>
                            <Play className="hidden h-4 w-4 translate-x-px fill-current text-[var(--ink-primary)] group-hover:block" strokeWidth={1.6} aria-hidden="true" />
                          </>
                        )}
                      </span>
                      <span className="music-hall-row-thumb relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[var(--music-radius-artwork-sm)] bg-[color-mix(in_oklch,var(--ink-primary)_6%,var(--bg-raised))]">
                        {itemCover ? (
                          <Image
                            src={itemCover}
                            alt=""
                            fill
                            sizes="44px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <Disc3 className="h-5 w-5 text-[var(--ink-muted)]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block truncate text-sm font-bold', active ? 'text-[var(--aurora-1)]' : 'text-[var(--ink-primary)]')}>
                          {presentation.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{artistLine}</span>
                      </span>
                      <span className="hidden min-w-0 truncate text-xs text-[var(--ink-muted)] sm:block">{albumLine}</span>
                      <span className="flex items-center justify-end gap-2 text-xs tnum text-[var(--ink-muted)]">
                        {active && isBuffering ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-[var(--aurora-1)]" />
                        ) : active && isPlaying ? (
                          <Pause className="h-4 w-4 text-[var(--aurora-1)]" />
                        ) : null}
                        <span>{durationLabel}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </motion.div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
