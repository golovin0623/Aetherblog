import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const profileSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/ProfileMusicPlayer.tsx'),
  'utf8'
);
const authorProfileSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/AuthorProfileCard.tsx'),
  'utf8'
);
const providerSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/MusicPlayerProvider.tsx'),
  'utf8'
);
const servicesSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/lib/services.ts'),
  'utf8'
);
const globalCss = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/globals.css'),
  'utf8'
);

function stackVariantSource() {
  const start = profileSource.indexOf('if (isStack) {');
  const end = profileSource.indexOf('\n  return (\n    <div\n      data-music-skin={skin}', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return profileSource.slice(start, end);
}

function mobileSheetSource() {
  const start = providerSource.indexOf('className="music-mobile-player-sheet');
  const end = providerSource.indexOf('\n        <div\n          data-music-skin={skin}', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return providerSource.slice(start, end);
}

describe('profile music player stack layout gate', () => {
  it('keeps the narrow card expand action icon-only to prevent right-edge text squeeze', () => {
    const stack = stackVariantSource();

    expect(stack).toContain('profile-music-expand-button');
    expect(stack).toContain('aria-label="打开音乐播放器"');
    expect(stack).not.toMatch(/>\s*播放器\s*<\/button>/);
  });

  it('keeps stack controls in stable fixed-size footer groups', () => {
    const stack = stackVariantSource();

    expect(stack).toContain('profile-music-stack-footer');
    expect(stack).toContain('profile-music-play-cluster');
    expect(stack).toContain('profile-music-expand-button');
  });

  it('keeps stack card playback rail tied to real progress instead of a decorative-only bar', () => {
    const stack = stackVariantSource();

    expect(stack).toContain('profile-music-progress-rail');
    expect(stack).toContain('style={{ width: `${shownPercent}%` }}');
    expect(stack).toContain('profile-music-stack-actions');
  });
});

describe('author profile stack radius gate', () => {
  it('uses one shared profile stack radius instead of nested hard-coded card radii', () => {
    expect(authorProfileSource).toContain('profile-card-stack-frame');
    expect(globalCss).toContain('--profile-card-stack-radius');
    expect(globalCss).toContain('--profile-card-stack-panel-radius');
    expect(profileSource).toContain('profile-music-stack-shell');
    expect(profileSource).toContain('rounded-[var(--profile-card-stack-panel-radius,1.75rem)]');

    expect(authorProfileSource).not.toContain('!rounded-3xl');
    expect(authorProfileSource).not.toContain('rounded-[1.75rem]');
    expect(profileSource).not.toContain('rounded-[1.35rem]');
    expect(globalCss).not.toContain('border-radius: 1.95rem');
  });

  it('clips each sliding card as its own rounded paint surface with a visible transition gutter', () => {
    expect(globalCss).toMatch(/\.profile-card-stack-stage\s*{[\s\S]*clip-path:\s*inset\(0 round var\(--profile-card-stack-panel-radius\)\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-slot\s*{[\s\S]*padding-inline:\s*var\(--profile-card-stack-slide-gutter\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\s*{[\s\S]*overflow:\s*hidden;/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\s*{[\s\S]*border-radius:\s*var\(--profile-card-stack-panel-radius\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel::before\s*{[\s\S]*border-radius:\s*inherit;/);
  });

  it('keeps light theme card boundaries visible instead of letting white corners disappear', () => {
    expect(globalCss).toContain('--profile-stack-stage-bg');
    expect(globalCss).toContain('--profile-stack-stage-border');
    expect(globalCss).toContain('--profile-stack-panel-border: color-mix(in oklch, var(--text-primary) 14%, transparent);');
    expect(globalCss).toContain('0 0 0 1px color-mix(in oklch, var(--text-primary) 5%, transparent)');
  });

  it('lets the music card share the outer panel surface instead of drawing a second rounded frame', () => {
    expect(authorProfileSource).toContain('data-card-panel="music"');
    expect(authorProfileSource).toContain('className="profile-card-stack-panel h-full border p-0');
    expect(globalCss).toMatch(/\.profile-card-stack-panel\[data-card-panel="music"\]\s*{[\s\S]*display:\s*flex;/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\[data-card-panel="music"\] \.profile-music-stack-shell\s*{[\s\S]*background:\s*transparent;/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\[data-card-panel="music"\] \.profile-music-stack-shell\s*{[\s\S]*box-shadow:\s*none;/);
  });
});

describe('mobile music player experience gate', () => {
  it('normalizes public music API track fields before the UI reads duration and media URLs', () => {
    expect(servicesSource).toContain('normalizeMusicTrack');
    expect(servicesSource).toContain("raw.durationSeconds ?? raw.duration_seconds");
    expect(servicesSource).toContain("raw.mediaFileId ?? raw.media_file_id");
    expect(servicesSource).toContain("publicUrl: toOptionalText(raw.publicUrl ?? raw.public_url)");
    expect(servicesSource).toContain("media: normalizeMusicMedia(raw.media)");
  });

  it('uses an effective duration fallback for visible progress and seeking', () => {
    expect(providerSource).toContain('effectiveDuration');
    expect(providerSource).toContain('effectiveProgress');
    expect(providerSource).toContain('effectivePercent');
    expect(providerSource).toMatch(/const targetDuration = effectiveDuration;/);
    expect(providerSource).not.toContain('if (!audio || duration <= 0) return;');
  });

  it('treats backend unknown-artist placeholders as empty display text', () => {
    expect(profileSource).toContain("next && next !== '未知艺术家' ? next : ''");
    expect(providerSource).toContain("next && next !== '未知艺术家' ? next : ''");
    expect(providerSource).not.toContain("currentTrack.artist || '未知艺术家'");
    expect(providerSource).not.toContain("track.artist || '未知艺术家'");
  });

  it('clips the floating liquid orb to a circular paint surface to avoid mobile Safari square glow artifacts', () => {
    expect(providerSource).toContain('music-floating-orb-button relative grid h-[3.75rem] w-[3.75rem]');
    expect(globalCss).toMatch(/\.music-floating-orb-button\s*{[\s\S]*overflow:\s*hidden;/);
    expect(globalCss).toMatch(/\.music-floating-orb-button\s*{[\s\S]*clip-path:\s*circle\(50%\);/);
    expect(globalCss).toMatch(/-webkit-mask-image:\s*radial-gradient\(circle,\s*#000 98%,\s*transparent 100%\)/);
  });

  it('keeps the mobile sheet structured as a polished playback system with dedicated stage, seek, controls, and actions', () => {
    const sheet = mobileSheetSource();

    expect(sheet).toContain('max-h-[66vh]');
    expect(sheet).toContain('overflow-y-auto');
    expect(sheet).toContain('music-mobile-player-stage');
    expect(sheet).toContain('music-mobile-player-seek');
    expect(sheet).toContain('music-mobile-player-controls');
    expect(sheet).toContain('music-mobile-player-actions');
    expect(sheet).toContain('size="md"');
    expect(sheet).toContain('duration={duration}');
  });

  it('keeps floating mobile sheet controls focus rings clean over dynamic backgrounds', () => {
    const sheet = mobileSheetSource();

    expect(sheet).toContain('focus-visible:ring-offset-2 focus-visible:ring-offset-transparent');
  });
});
