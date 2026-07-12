'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  Disc3,
  ListMusic,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
} from 'lucide-react';
import {
  formatMusicClock,
  NowPlayingGlyph,
  resolveMusicCoverSrc,
  useMusicPlayer,
} from './MusicPlayerProvider';
import { MusicSkinSwitcher } from './MusicSkinSwitcher';
import { resolveMusicTrackPresentation } from './musicPlayerState';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
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
  } = useMusicPlayer();

  const firstTrack = tracks[0];
  const trackCover = resolveMusicCoverSrc(firstTrack);
  const playlistCover = sanitizeImageUrl(player?.playlist?.coverUrl, trackCover);
  const playlistName = player?.playlist?.name || '音乐大厅';
  const playlistDescription = player?.playlist?.description?.trim() || '私人收藏，持续更新。';
  const canPlay = Boolean(player?.enabled && tracks.length > 0 && firstTrack);
  const totalDuration = tracks.reduce((sum, track) => sum + (track.durationSeconds || 0), 0);
  const playlistMeta = `${tracks.length} 首${totalDuration > 0 ? ` · ${formatMusicClock(totalDuration)}` : ''}`;

  return (
    <main
      data-music-skin={skin}
      className="min-h-screen bg-[var(--bg-substrate)] pb-36 pt-20 text-[var(--ink-primary)] sm:pt-28"
    >
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_4%,color-mix(in_oklch,var(--aurora-1)_10%,transparent),transparent_30%),linear-gradient(180deg,transparent_54%,color-mix(in_oklch,var(--aurora-4)_5%,transparent))]"
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-7 lg:px-8">
        {isPlayerLoading ? (
          <section className="flex min-h-[55vh] items-center justify-center text-center" role="status" aria-live="polite">
            <div>
              <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[var(--aurora-1)]" />
              <h1 className="mt-5 text-2xl font-black">正在准备音乐大厅</h1>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">正在载入今天的歌单…</p>
            </div>
          </section>
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
            <section
              data-music-library-hero
              className="border-b border-[var(--music-stroke)] pb-7 min-[769px]:grid min-[769px]:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] min-[769px]:items-end min-[769px]:gap-10 min-[769px]:pb-9"
            >
              <div
                className={cn(
                  'relative mx-auto aspect-square overflow-hidden rounded-[var(--music-radius-artwork-lg)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,var(--bg-raised))] shadow-[var(--music-shadow-artwork)] min-[769px]:mx-0',
                  playlistCover
                    ? 'w-[min(58vw,14rem)] min-[769px]:w-full'
                    : 'w-32 shadow-[inset_0_0_0_0.5px_var(--music-stroke)] min-[769px]:w-48'
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

              <div className="mt-6 min-w-0 min-[769px]:mt-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--aurora-1)]">歌单</p>
                    <h1 className="mt-1 break-words text-[2rem] font-black leading-[1.12] tracking-[-0.02em] sm:text-4xl">
                      {playlistName}
                    </h1>
                  </div>
                  <MusicSkinSwitcher iconOnly className="shrink-0 min-[769px]:hidden" />
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-secondary)] sm:text-base">
                  {playlistDescription}
                </p>
                <p className="mt-2 text-xs font-semibold text-[var(--ink-muted)]">{playlistMeta}</p>

                <div data-music-play-actions className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={() => playAll()}
                    disabled={!canPlay}
                    aria-label="播放歌单"
                    className="music-control-button inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-[var(--music-radius-control)] bg-[var(--ink-primary)] px-4 text-[15px] font-semibold text-[var(--bg-void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-28 sm:px-[18px]"
                  >
                    <Play className="h-[18px] w-[18px] translate-x-px fill-current" strokeWidth={1.6} />
                    播放
                  </button>
                  <button
                    type="button"
                    onClick={() => playShuffled()}
                    disabled={!canPlay}
                    aria-label="随机播放歌单"
                    className="music-control-button inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-[var(--music-radius-control)] bg-[var(--music-control-fill)] px-4 text-[15px] font-semibold text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-substrate)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-28 sm:px-[18px]"
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
              </div>
            </section>

            <section id="playlist" data-music-track-list className="pt-6 sm:pt-8">
              <div className="flex items-end justify-between gap-4 pb-2">
                <div>
                  <p className="text-xs font-semibold text-[var(--ink-muted)]">播放列表</p>
                  <h2 className="mt-1 text-xl font-black">歌曲</h2>
                </div>
                <span className="text-xs tnum text-[var(--ink-muted)]">{playlistMeta}</span>
              </div>

              <div className="border-t border-[var(--music-stroke)]">
                {tracks.map((track, index) => {
                  const itemCover = resolveMusicCoverSrc(track);
                  const active = hasPlaybackSession && currentTrack?.id === track.id;
                  const presentation = resolveMusicTrackPresentation(track);
                  const subtitle = [presentation.artist, track.album].filter(Boolean).join(' · ') || playlistName;
                  const durationLabel = formatMusicClock(track.durationSeconds || 0);
                  return (
                    <button
                      key={track.id}
                      type="button"
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
                      className="group grid min-h-[72px] w-full grid-cols-[1.25rem_44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--music-stroke)] py-3 text-left transition-colors hover:bg-[var(--music-control-fill)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]"
                    >
                      <span className="text-center text-xs tnum text-[var(--ink-muted)]">
                        {active && isPlaying ? <NowPlayingGlyph /> : index + 1}
                      </span>
                      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[var(--music-radius-artwork-sm)] bg-[color-mix(in_oklch,var(--ink-primary)_6%,var(--bg-raised))]">
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
                        <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{subtitle}</span>
                      </span>
                      <span className="flex min-w-11 items-center justify-end gap-2 text-xs tnum text-[var(--ink-muted)]">
                        <span className="hidden sm:inline">{durationLabel}</span>
                        {active && isBuffering ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-[var(--aurora-1)]" />
                        ) : active && isPlaying ? (
                          <Pause className="h-4 w-4 text-[var(--aurora-1)]" />
                        ) : (
                          <Play className="h-4 w-4 translate-x-px fill-current opacity-55 transition-opacity group-hover:opacity-100" strokeWidth={1.6} />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
