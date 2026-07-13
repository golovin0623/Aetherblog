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
  const end = providerSource.indexOf('\n        <div\n          ref={desktopDialogRef}', start);

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

  it('keeps stack transport centered with equal previous/play/next spacing', () => {
    const stack = stackVariantSource();

    expect(stack).toContain('profile-music-stack-footer');
    expect(stack).toContain('profile-music-stack-transport');
    expect(stack).toContain('grid-cols-[44px_52px_44px]');
    expect(stack).toContain('gap-2.5');
    expect(stack).toContain('profile-music-expand-button');
    expect(stack).not.toContain('profile-music-stack-utility');
    expect(globalCss).toContain('@container (max-width: 17.5rem)');
  });

  it('keeps a touch-sized profile return action in every stack loading and empty state', () => {
    expect(profileSource.match(/isStack && stackSwitchAction/g)).toHaveLength(3);
    expect(profileSource.match(/absolute right-2 top-2 z-\[2\]/g)).toHaveLength(3);
  });

  it('keeps stack card playback progress singular and moves utility actions into the header', () => {
    const stack = stackVariantSource();
    const headerIndex = stack.indexOf('profile-music-stack-header');
    const progressIndex = stack.indexOf('profile-music-stack-progress');
    const footerIndex = stack.indexOf('profile-music-stack-footer');

    expect(stack).toContain('profile-music-stack-actions');
    expect(stack).toContain('grid-cols-[52px_minmax(0,1fr)_auto]');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThan(headerIndex);
    expect(footerIndex).toBeGreaterThan(progressIndex);
    expect(stack).not.toContain('profile-music-progress-rail');
    expect(stack).not.toContain('style={{ width: `${shownPercent}%` }}');
  });
});

describe('author profile stack radius gate', () => {
  it('offers an explicit touch-sized control for switching between profile and music', () => {
    expect(authorProfileSource).toContain('profile-stack-switch-button');
    expect(authorProfileSource).toContain('aria-label={`切换到${nextStackCard.label}`}');
    expect(authorProfileSource).toContain('h-11 w-11');
    expect(authorProfileSource).toContain('useReducedMotion');
    expect(authorProfileSource).toContain('if (event.defaultPrevented) return;');
    expect(authorProfileSource).toContain("target?.closest('a,button,input,textarea,select,[role=\"slider\"]')");
    expect(authorProfileSource).toContain("activeCard === 'profile'");
    expect(authorProfileSource).toContain('stackSwitchAction={renderStackSwitchButton()}');
    expect(profileSource).toContain('{stackSwitchAction}');
  });

  it('uses the shared system radius scale for outer, stage, and panel curvature', () => {
    expect(authorProfileSource).toContain('profile-card-stack-frame');
    expect(globalCss).toContain('--profile-card-stack-radius: var(--radius-xl, 1.5rem)');
    expect(globalCss).toContain('--profile-card-stack-stage-radius: var(--radius-lg, 1rem)');
    expect(globalCss).toContain('--profile-card-stack-panel-radius: var(--radius-md, 0.75rem)');
    expect(globalCss).toMatch(/\.profile-card-stack-stage\s*{[\s\S]*border-radius:\s*var\(--profile-card-stack-stage-radius\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\s*{[\s\S]*border-radius:\s*var\(--profile-card-stack-panel-radius\);/);
    expect(profileSource).toContain('profile-music-stack-shell');
    expect(profileSource).toContain('rounded-[var(--profile-card-stack-panel-radius)]');

    expect(authorProfileSource).not.toContain('!rounded-3xl');
    expect(authorProfileSource).not.toContain('rounded-[1.75rem]');
    expect(profileSource).not.toContain('rounded-[1.35rem]');
    expect(globalCss).not.toContain('border-radius: 1.95rem');
    expect(globalCss).not.toContain('--profile-card-stack-stage-radius: max(');
  });

  it('moves the carousel with shared motion tokens and avoids permanent filtered layers', () => {
    expect(authorProfileSource).toContain('spring.precise');
    expect(authorProfileSource).not.toContain('stiffness: 560');
    expect(authorProfileSource).not.toContain('stiffness: 520');
    expect(authorProfileSource).not.toContain('[backdrop-filter:blur(22px)_saturate(145%)]');
    expect(globalCss).not.toMatch(/\.profile-card-stack-track\s*\{[^}]*will-change:/);
    expect(globalCss).not.toMatch(/\.profile-card-stack-panel\s*\{[^}]*will-change:/);
  });

  it('uses a transparent focus-ring offset only when the switch floats over dynamic content', () => {
    expect(authorProfileSource).toContain("focus-visible:ring-offset-transparent' : 'focus-visible:ring-offset-[var(--profile-stack-focus-offset)]'");
  });

  it('clips each sliding card as its own rounded paint surface with a visible transition gutter', () => {
    expect(globalCss).toMatch(/\.profile-card-stack-stage\s*{[\s\S]*clip-path:\s*inset\(0 round var\(--profile-card-stack-stage-radius\)\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-slot\s*{[\s\S]*padding:\s*var\(--profile-card-stack-slide-gutter\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\s*{[\s\S]*overflow:\s*hidden;/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel\s*{[\s\S]*border-radius:\s*var\(--profile-card-stack-panel-radius\);/);
    expect(globalCss).toMatch(/\.profile-card-stack-panel::before\s*{[\s\S]*border-radius:\s*inherit;/);
  });

  it('lets the panel own the visible boundary while the stage remains a clean clipping surface', () => {
    expect(globalCss).toContain('--profile-stack-stage-bg');
    expect(globalCss).toContain('--profile-stack-stage-border');
    expect(globalCss).toContain('--profile-stack-panel-border: color-mix(in oklch, var(--text-primary) 14%, transparent);');
    expect(globalCss).toContain('0 0 0 1px color-mix(in oklch, var(--text-primary) 5%, transparent)');
    expect(globalCss).not.toMatch(/\.profile-card-stack-stage\s*{[\s\S]*box-shadow:\s*inset 0 0 0 1px var\(--profile-stack-stage-border\);/);
  });

  it('uses real color tokens for the stack switch material and focus offset', () => {
    expect(globalCss).toContain('--profile-stack-control-bg:');
    expect(globalCss).toContain('--profile-stack-control-hover:');
    expect(globalCss).toContain('--profile-stack-focus-offset:');
    expect(authorProfileSource).toContain('bg-[var(--profile-stack-control-bg)]');
    expect(authorProfileSource).toContain('hover:bg-[var(--profile-stack-control-hover)]');
    expect(authorProfileSource).toContain('focus-visible:ring-offset-[var(--profile-stack-focus-offset)]');
    expect(authorProfileSource).not.toContain('color-mix(in_oklch,var(--profile-stack-panel-bg)');
    expect(authorProfileSource).not.toContain('ring-offset-[var(--profile-stack-stage-bg)]');
  });

  it('describes carousel cards as slides instead of orphan tab panels', () => {
    expect(authorProfileSource.match(/role="group"/g)).toHaveLength(2);
    expect(authorProfileSource.match(/aria-roledescription="slide"/g)).toHaveLength(2);
    expect(authorProfileSource).not.toContain("role={isCurrent ? 'tabpanel' : undefined}");
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
    expect(profileSource).toContain('resolveMusicTrackPresentation(displayTrack)');
    expect(providerSource).toContain("next && next !== '未知艺术家' ? next : ''");
    expect(providerSource).not.toContain("currentTrack.artist || '未知艺术家'");
    expect(providerSource).not.toContain("track.artist || '未知艺术家'");
  });

  it('uses a content-rich mobile MiniPlayer rather than an icon-only orb', () => {
    expect(providerSource).toContain('data-music-mini-player');
    expect(providerSource).toContain('grid-cols-[40px_minmax(0,1fr)_44px_44px]');
    expect(providerSource).toContain('music-mini-player');
    expect(providerSource).toContain('h-14');
    expect(providerSource).toContain('aria-label="打开音乐播放器"');
    expect(providerSource).not.toContain('music-floating-orb-button');
  });

  it('keeps the mobile sheet structured as a single-view playback system with artwork, seek, transport, volume, and tools', () => {
    const sheet = mobileSheetSource();

    expect(sheet).toContain('h-[100dvh]');
    expect(sheet).toContain('overflow-y-auto');
    expect(sheet).toContain('overscroll-contain');
    expect(sheet).toContain('data-now-playing-artwork');
    expect(sheet).toContain('music-mobile-player-seek');
    expect(sheet).toContain('music-mobile-player-transport');
    expect(sheet).toContain('music-mobile-player-volume');
    expect(sheet).toContain('music-mobile-player-tools');
    expect(sheet).not.toContain('music-mobile-player-stage');
    expect(sheet).not.toContain('music-mobile-player-actions');
    expect(sheet).toContain('size="md"');
    expect(sheet).toContain('duration={duration}');
  });

  it('keeps floating mobile sheet controls focus rings clean over dynamic backgrounds', () => {
    const sheet = mobileSheetSource();

    expect(sheet).toContain('focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]');
  });
});
