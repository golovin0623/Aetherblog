import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const hallSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/MusicHallExperience.tsx'),
  'utf8'
);
const profileSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/ProfileMusicPlayer.tsx'),
  'utf8'
);
const authorProfileSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/AuthorProfileCard.tsx'),
  'utf8'
);
const servicesSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/lib/services.ts'),
  'utf8'
);
const floatingThemeSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/FloatingThemeToggle.tsx'),
  'utf8'
);

describe('public music hall product-quality gates', () => {
  it('treats the hall as a playlist content page instead of a marketing hero with an embedded player', () => {
    expect(hallSource).toContain('data-music-library-hero');
    expect(hallSource).toContain('data-music-track-list');
    expect(hallSource).toContain('data-music-play-actions');
    expect(hallSource).toContain('pt-20');
    expect(hallSource).toContain('sm:pt-28');
    expect(hallSource).toContain('playlistName');
    expect(hallSource).not.toContain('data-mobile-music-hero');
    expect(hallSource).not.toContain('min-h-[156px]');
    expect(hallSource).not.toContain('playAll({ expand: true })');
    expect(hallSource).not.toContain('沉浸模式');
    expect(hallSource).not.toContain('歌词与封面动效');
  });

  it('normalizes and prioritizes playlist artwork instead of shrinking track art into a CSS record', () => {
    expect(servicesSource).toContain('coverMediaFileId?: number;');
    expect(servicesSource).toContain('coverUrl?: string;');
    expect(servicesSource).toContain('normalizeMusicPlaylist');
    expect(servicesSource).toContain('coverUrl: toOptionalText(raw.coverUrl ?? raw.cover_url)');
    expect(hallSource).toContain('sanitizeImageUrl(player?.playlist?.coverUrl, trackCover)');
    expect(hallSource).not.toContain('resolveMusicCoverSrc(undefined, player.playlist.coverUrl)');
    expect(hallSource).not.toContain('music-vinyl-spin');
    expect(hallSource).not.toContain('inset-[29%]');
  });

  it('speaks to visitors in empty and error states instead of exposing admin setup', () => {
    expect(hallSource).toContain('检查网络后重新载入');
    expect(hallSource).toContain('先去看看文章');
    expect(hallSource).not.toContain('后台音乐大厅');
    expect(hallSource).not.toContain('启用公开播放器');
  });

  it('keeps only play and shuffle as prominent hall actions and leaves browsing in place', () => {
    expect(hallSource).toContain('aria-label="播放歌单"');
    expect(hallSource).toContain('aria-label="随机播放歌单"');
    expect(hallSource).toContain('onClick={() => playAll()}');
    expect(hallSource).toContain('onClick={() => playShuffled()}');
    expect(hallSource).toContain('focus-visible:ring-offset-[var(--bg-substrate)]');
    expect(hallSource).toContain('min-h-11');
    expect(hallSource).toContain('music-pill-button');
    expect(hallSource).not.toContain('返回文章');
  });

  it('matches Apple-like playlist action geometry with soft rectangles instead of long capsules', () => {
    expect(hallSource).toContain('min-h-12');
    expect(hallSource).toContain('sm:min-w-28');
    expect(hallSource).toContain('rounded-[var(--music-radius-control)]');
    expect(hallSource).toContain('bg-[var(--ink-primary)]');
    expect(hallSource).toContain('bg-[var(--music-control-fill)]');
    expect(hallSource).not.toContain('sm:min-w-40');
    expect(hallSource).not.toContain('min-h-[52px]');
    expect(hallSource).not.toContain('hover:scale-[1.015]');
  });

  it('uses the shared artwork radius scale for hero and track covers', () => {
    expect(hallSource).toContain('rounded-[var(--music-radius-artwork-lg)]');
    expect(hallSource).toContain('rounded-[var(--music-radius-artwork-sm)]');
    expect(hallSource).not.toContain('rounded-[1.35rem]');
    expect(hallSource).not.toContain('rounded-[0.65rem]');
  });

  it('toggles the current queue item without restarting it', () => {
    expect(hallSource).toContain('const active = hasPlaybackSession && currentTrack?.id === track.id');
    expect(hallSource).toContain('else if (playbackError)');
    expect(hallSource).toContain('void retryPlayback()');
    expect(hallSource).toContain('aria-current={active ? \'true\' : undefined}');
    expect(hallSource).toContain('playbackError\n                          ? `重新尝试 ${presentation.title}`');
    expect(hallSource).toContain('`取消载入 ${presentation.title}`');
    expect(hallSource).toContain('`暂停 ${presentation.title}`');
    expect(hallSource).toContain('`继续播放 ${presentation.title}`');
  });

  it('does not stack the global theme floater on top of music controls', () => {
    expect(floatingThemeSource).toContain('useMusicPlayer');
    expect(floatingThemeSource).toContain('if (!mounted || !pathname) return null;');
    expect(floatingThemeSource).toContain("pathname.startsWith('/music')");
    expect(floatingThemeSource).toContain('hasPlaybackSession');
  });
});

describe('profile music card product-quality gates', () => {
  it('distinguishes loading, load failure, disabled, and playback failure states', () => {
    expect(profileSource).toContain('isPlayerLoading');
    expect(profileSource).toContain('playerLoadError');
    expect(profileSource).toContain('playbackError');
    expect(profileSource).toContain('retryPlayer');
    expect(profileSource).toContain('retryPlayback');
    expect(profileSource).toContain('role="status"');
    expect(profileSource).toContain('role="alert"');
  });

  it('keeps card controls at the 44px touch-target floor', () => {
    expect(profileSource).not.toMatch(/\bh-(?:9|10)\b/);
    expect(profileSource).not.toMatch(/\bw-(?:9|10)\b/);
    expect(profileSource).toContain('min-h-11');
  });

  it('uses square artwork and the shared transport language instead of the legacy vinyl control', () => {
    expect(profileSource).toContain('ProfileMusicArtwork');
    expect(profileSource).toContain('rounded-[var(--music-radius-artwork-sm)]');
    expect(profileSource).toContain('music-icon-button');
    expect(profileSource).toContain('music-primary-play-button');
    expect(profileSource).toContain('<SkipBack');
    expect(profileSource).toContain('<SkipForward');
    expect(profileSource).not.toContain('profile-music-cover-orb');
    expect(profileSource).not.toContain('profile-music-cover-core');
    expect(profileSource).not.toContain('music-vinyl-spin');
    expect(profileSource).toContain("stackBuffering ? '取消载入'");
    expect(profileSource).toContain("isCurrentTrack && isBuffering ? '取消载入'");
  });

  it('turns a failed profile transport action into a real retry instead of a generic toggle', () => {
    expect(profileSource).toContain('if (playbackError)');
    expect(profileSource).toContain('await retryPlayback();');
    expect(profileSource).toContain("stackFailed ? '重新尝试播放'");
    expect(profileSource).toContain("isCurrentTrack && playbackError ? '重新尝试播放'");
    expect(profileSource).not.toContain('stackFailed ? <RefreshCw');
    expect(profileSource).not.toContain('isCurrentTrack && playbackError ? <RefreshCw');
  });

  it('offers a clearly named path from both card variants to the full queue', () => {
    expect(profileSource.match(/href="\/music"/g)).toHaveLength(2);
    expect(profileSource.match(/浏览歌单/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(profileSource).toContain('展开播放器');
  });

  it('keeps the injected profile empty state visitor-facing', () => {
    expect(authorProfileSource).toContain('歌单还在准备中');
    expect(authorProfileSource).toContain('稍后再回来听听');
    expect(authorProfileSource).not.toContain('后台启用公开播放器');
  });
});
