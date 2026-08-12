import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  MusicLibrarySummary,
  MusicTagSummary,
  MusicTrack,
} from '@aetherblog/types';
import {
  analyzeLyricContent,
  buildTrackCurationState,
  deriveMusicOverviewCounts,
  inferMusicLyricFormat,
  normalizeLyricContent,
  shiftLyricTimestamps,
} from './musicCuration';

describe('music lyric analysis and correction', () => {
  it('distinguishes metadata, valid timestamps, plain text, and malformed timestamps', () => {
    const result = analyzeLyricContent([
      '[ar: Aether]',
      '[00:01.20]First line',
      '[00:04.00][00:05.50]Repeated line',
      'Plain translation',
      '[00:72.00]Invalid minute second',
    ].join('\n'));

    expect(result).toEqual({
      format: 'LRC',
      timedLineCount: 3,
      plainLineCount: 1,
      invalidTimestampLineCount: 1,
      metadataLineCount: 1,
      firstTimestampMs: 1200,
      lastTimestampMs: 5500,
    });
  });

  it('infers plain lyrics when no valid timeline exists', () => {
    expect(inferMusicLyricFormat('First line\nSecond line')).toBe('PLAIN');
    expect(inferMusicLyricFormat('[00:01.00]First line')).toBe('LRC');
  });

  it('normalizes line endings, timestamp precision, and metadata spacing', () => {
    expect(normalizeLyricContent('  [ar:  Aether ]\r\n[1:2.5]  Hello  \r\n')).toBe(
      '[ar:Aether]\n[01:02.50]Hello'
    );
  });

  it('shifts every valid timestamp, clamps before zero, and preserves non-timestamp text', () => {
    const source = [
      '[offset:0]',
      '[00:00.20]Opening',
      '[00:01.00][00:02.50]Echo',
      'Translation',
    ].join('\n');

    expect(shiftLyricTimestamps(source, -500)).toBe([
      '[offset:0]',
      '[00:00.00]Opening',
      '[00:00.50][00:02.00]Echo',
      'Translation',
    ].join('\n'));
  });
});

describe('track curation readiness', () => {
  it('uses the lightweight canonical tag summary returned with music tracks', () => {
    expectTypeOf<NonNullable<MusicTrack['tags']>[number]>()
      .toEqualTypeOf<MusicTagSummary>();
  });

  it('reports a complete track when metadata, artwork, tags, lyrics, playlist and publication are ready', () => {
    const track = {
      title: 'Night Flight',
      artist: 'Aether',
      album: 'Signals',
      coverMediaFileId: 8,
      lyric: '[00:01.00]Hello',
      lyricAsset: { id: 5, status: 'READY' },
      tags: [{ id: 1, name: '夜航', color: '#7868e6' }],
      playlistCount: 2,
      status: 'ACTIVE',
    } as unknown as MusicTrack;

    const state = buildTrackCurationState(track);

    expect(state.score).toBe(100);
    expect(state.missing).toEqual([]);
    expect(state.steps.every((step) => step.complete)).toBe(true);
  });

  it('names actionable gaps instead of treating an imported audio file as curated', () => {
    const track = {
      title: 'untitled.mp3',
      artist: '',
      album: '',
      media: { originalName: 'untitled.mp3' },
      tags: [],
      playlistCount: 0,
      status: 'HIDDEN',
    } as unknown as MusicTrack;

    const state = buildTrackCurationState(track);

    expect(state.score).toBe(0);
    expect(state.missing).toEqual(['metadata', 'artwork', 'tags', 'lyrics', 'playlist', 'publication']);
  });
});

describe('music overview fallback counts', () => {
  const tracks = [
    {
      id: 1,
      isFavorite: true,
      tags: [],
      lyric: undefined,
      coverMediaFileId: undefined,
      coverUrl: undefined,
      media: {},
    },
    {
      id: 2,
      isFavorite: false,
      tags: [{ id: 7, name: '夜航', slug: 'night-flight', color: '#7868e6', category: 'CUSTOM', usageCount: 1 }],
      lyric: '[00:01.00]Legacy lyric',
      coverMediaFileId: 8,
      media: {},
    },
    {
      id: 3,
      isFavorite: true,
      tags: [],
      lyricAsset: { id: 9, status: 'DRAFT' },
      coverUrl: '/api/v1/public/media/9',
      media: {},
    },
    {
      id: 4,
      isFavorite: false,
      tags: [],
      lyric: '   ',
      media: { thumbnailUrl: '/uploads/thumb.webp' },
    },
  ] as unknown as MusicTrack[];

  it('derives actionable counts from loaded tracks while summary is unavailable', () => {
    expect(deriveMusicOverviewCounts(tracks)).toEqual({
      trackCount: 4,
      missingLyrics: 2,
      missingCovers: 1,
      taggedTracks: 1,
      untaggedTracks: 3,
      favoriteTracks: 2,
    });
  });

  it('prefers each available summary count without zeroing fields absent from the summary payload', () => {
    const summary = {
      trackCount: 12,
      missingLyricCount: 5,
      taggedTrackCount: 9,
    } as MusicLibrarySummary;

    expect(deriveMusicOverviewCounts(tracks, summary)).toEqual({
      trackCount: 12,
      missingLyrics: 5,
      missingCovers: 1,
      taggedTracks: 9,
      untaggedTracks: 3,
      favoriteTracks: 2,
    });
  });
});
