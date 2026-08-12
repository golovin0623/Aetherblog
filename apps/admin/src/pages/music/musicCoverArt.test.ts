import { describe, expect, it } from 'vitest';
import {
  buildResonantCoverComposition,
  hashMusicCoverSeed,
  isCurrentMusicCoverUploadRequest,
  sanitizeMusicCoverFileName,
} from './musicCoverArt';

describe('resonant music cover composition', () => {
  it('derives a stable positive seed from musical identity', () => {
    const first = hashMusicCoverSeed('杨千嬅|假如让我说下去');
    const second = hashMusicCoverSeed('杨千嬅|假如让我说下去');

    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
  });

  it('is reproducible for the same seed and varies for a different seed', () => {
    const first = buildResonantCoverComposition({
      seed: 20260811,
      width: 1200,
      height: 1200,
      particleCount: 120,
      orbitCount: 8,
      turbulence: 0.8,
    });
    const repeated = buildResonantCoverComposition({
      seed: 20260811,
      width: 1200,
      height: 1200,
      particleCount: 120,
      orbitCount: 8,
      turbulence: 0.8,
    });
    const different = buildResonantCoverComposition({
      seed: 20260812,
      width: 1200,
      height: 1200,
      particleCount: 120,
      orbitCount: 8,
      turbulence: 0.8,
    });

    expect(repeated).toEqual(first);
    expect(different).not.toEqual(first);
  });

  it('keeps every generated point inside the renderable cover bounds', () => {
    const composition = buildResonantCoverComposition({
      seed: 42,
      width: 600,
      height: 600,
      particleCount: 80,
      orbitCount: 6,
      turbulence: 1.2,
    });

    for (const stroke of composition.strokes) {
      expect(stroke.x1).toBeGreaterThanOrEqual(0);
      expect(stroke.x1).toBeLessThanOrEqual(600);
      expect(stroke.y1).toBeGreaterThanOrEqual(0);
      expect(stroke.y1).toBeLessThanOrEqual(600);
      expect(stroke.x2).toBeGreaterThanOrEqual(0);
      expect(stroke.x2).toBeLessThanOrEqual(600);
      expect(stroke.y2).toBeGreaterThanOrEqual(0);
      expect(stroke.y2).toBeLessThanOrEqual(600);
    }
  });

  it('creates a safe, meaningful PNG filename', () => {
    expect(sanitizeMusicCoverFileName('  夜 航 / Night:Flight  ')).toBe('夜-航-Night-Flight-cover.png');
    expect(sanitizeMusicCoverFileName('')).toBe('music-cover.png');
  });

  it('rejects a delayed upload result after the edited track or playlist changes', () => {
    expect(isCurrentMusicCoverUploadRequest({
      requestId: 4,
      requestOwnerKey: 'track:17',
      currentRequestId: 4,
      currentOwnerKey: 'track:17',
    })).toBe(true);
    expect(isCurrentMusicCoverUploadRequest({
      requestId: 4,
      requestOwnerKey: 'track:17',
      currentRequestId: 5,
      currentOwnerKey: 'track:18',
    })).toBe(false);
  });
});
