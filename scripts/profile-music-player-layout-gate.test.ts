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

function profilePlayerSource() {
  const start = profileSource.indexOf('export function ProfileMusicPlayer');
  const end = profileSource.indexOf('\nfunction PlaybackFailure', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return profileSource.slice(start, end);
}

function liveTimelineLeafSource() {
  const start = profileSource.indexOf('function LiveProfileMusicTimeline');
  const end = profileSource.indexOf('\nfunction ProfileMusicTimelineSlot', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return profileSource.slice(start, end);
}

function mobileSheetSource() {
  const start = providerSource.indexOf('className="music-mobile-player-sheet');
  const end = providerSource.indexOf("\n      {surface === 'immersive' && !isMobile && (", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return providerSource.slice(start, end);
}

describe('profile music player stack layout gate', () => {
  it('subscribes to the high-frequency timeline only inside the progress leaf', () => {
    const player = profilePlayerSource();
    const liveTimeline = liveTimelineLeafSource();

    expect(profileSource.match(/useMusicPlayerTimeline\(\)/g)).toHaveLength(1);
    expect(player).not.toContain('useMusicPlayerTimeline()');
    expect(player).toContain('<ProfileMusicTimelineSlot');
    expect(liveTimeline).toContain('useMusicPlayerTimeline()');
    expect(liveTimeline).toContain('<ProfileMusicTimelineView');
  });

  it('does not subscribe an offscreen stack music card to playback time updates', () => {
    expect(profileSource).toContain('timelineActive = true');
    expect(profileSource).toContain('live={timelineActive}');
    expect(authorProfileSource).toContain('timelineActive={isCurrent}');
  });

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
    expect(stack).toContain('grid-cols-[44px_56px_44px]');
    expect(stack).toContain('gap-3');
    expect(stack).toContain('profile-music-expand-button');
    expect(stack).not.toContain('profile-music-stack-utility');
    expect(globalCss).not.toContain('@container (max-width: 17.5rem)');
  });

  it('keeps stack card playback progress singular and leaves only one quiet expand action in the header', () => {
    const stack = stackVariantSource();
    const headerIndex = stack.indexOf('profile-music-stack-header');
    const progressIndex = stack.indexOf('<ProfileMusicTimelineSlot');
    const footerIndex = stack.indexOf('profile-music-stack-footer');

    expect(stack).toContain('grid-cols-[64px_minmax(0,1fr)_44px]');
    expect(stack.match(/profile-music-expand-button/g)).toHaveLength(1);
    expect(stack).not.toContain('profile-music-stack-actions');
    expect(stack).not.toContain('stackSwitchAction');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThan(headerIndex);
    expect(footerIndex).toBeGreaterThan(progressIndex);
    expect(profileSource).toContain("layout === 'stack' ? 'profile-music-stack-progress' : 'mt-3'");
    expect(stack).not.toContain('profile-music-progress-rail');
    expect(stack).not.toContain('style={{ width: `${shownPercent}%` }}');
  });
});

describe('author profile stack radius gate', () => {
  it('mounts each logical two-card carousel panel once and repositions the adjacent panel by direction', () => {
    expect(authorProfileSource).toContain("useState<'previous' | 'next'>('next')");
    expect(authorProfileSource).toContain("{ position: 'current' as const, card: activeStackCard }");
    expect(authorProfileSource).toContain('{ position: adjacentStackPosition, card: nextStackCard }');
    expect(authorProfileSource).toContain('key={slot.card.key}');
    expect(authorProfileSource).toContain('gridColumn: resolveStackGridColumn(slot.position)');
    expect(authorProfileSource).not.toContain('key={`${slot.position}-${slot.card.key}`}');
    expect(authorProfileSource).not.toContain('const previousIndex =');
    expect(authorProfileSource).not.toContain('const nextIndex =');
  });

  it('uses an iOS-style page control instead of icon buttons for profile and music switching', () => {
    expect(authorProfileSource).toContain('profile-stack-page-control');
    expect(authorProfileSource).toContain('profile-stack-page-button');
    expect(authorProfileSource).toContain('onClick={() => goToStackCard(index)}');
    expect(authorProfileSource).toContain("aria-current={index === activeIndex ? 'page' : undefined}");
    expect(globalCss).toMatch(/\.profile-stack-page-button\s*{[\s\S]*width:\s*2\.75rem;[\s\S]*height:\s*2\.75rem;/);
    expect(globalCss).toMatch(/\.profile-stack-dot\[data-active="true"\]\s*{[\s\S]*width:\s*1\.15rem;/);
    expect(authorProfileSource).not.toContain('profile-stack-switch-button');
    expect(authorProfileSource).not.toContain('UserRound');
    expect(profileSource).not.toContain('stackSwitchAction');
    expect(authorProfileSource).toContain('useReducedMotion');
    expect(authorProfileSource).toContain('if (event.defaultPrevented) return;');
    expect(authorProfileSource).toContain("target?.closest('a,button,input,textarea,select,[role=\"slider\"]')");
  });

  it('uses the shared system radius scale for outer, stage, and panel curvature', () => {
    expect(authorProfileSource).toContain('profile-card-stack-frame');
    expect(globalCss).toContain('--profile-card-stack-radius: var(--radius-xl, 1.5rem)');
    expect(globalCss).toContain('--profile-card-stack-stage-radius: calc(var(--profile-card-stack-radius) - 0.25rem)');
    expect(globalCss).toContain('--profile-card-stack-panel-radius: var(--radius-lg, 1rem)');
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

  it('reserves enough mobile height for profile actions plus the page control', () => {
    expect(authorProfileSource).toContain('min-h-[24rem]');
    expect(authorProfileSource).toContain('lg:min-h-0');
  });

  it('moves the carousel with shared motion tokens and avoids permanent filtered layers', () => {
    expect(authorProfileSource).toContain('spring.precise');
    expect(authorProfileSource).not.toContain('stiffness: 560');
    expect(authorProfileSource).not.toContain('stiffness: 520');
    expect(authorProfileSource).not.toContain('[backdrop-filter:blur(22px)_saturate(145%)]');
    expect(globalCss).not.toMatch(/\.profile-card-stack-track\s*\{[^}]*will-change:/);
    expect(globalCss).not.toMatch(/\.profile-card-stack-panel\s*\{[^}]*will-change:/);
  });

  it('keeps page-control focus visible without turning the visual dots into large pills', () => {
    expect(globalCss).toMatch(/\.profile-stack-page-button:focus-visible\s*{[\s\S]*outline:\s*2px solid/);
    expect(globalCss).toMatch(/\.profile-stack-page-button\s*{[\s\S]*background:\s*transparent;/);
    expect(globalCss).not.toMatch(/\.profile-stack-page-control\s*{[^}]*background:/);
  });

  it('clips each sliding card as its own rounded paint surface with a visible transition gutter', () => {
    expect(globalCss).toMatch(/\.profile-card-stack-stage\s*{[\s\S]*overflow:\s*hidden;/);
    expect(globalCss).not.toContain('clip-path: inset(0 round var(--profile-card-stack-stage-radius))');
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

  it('uses restrained tokenized page dots instead of a second control material', () => {
    expect(globalCss).toContain('--profile-stack-dot:');
    expect(globalCss).toContain('--profile-stack-dot-active:');
    expect(globalCss).not.toContain('--profile-stack-control-bg:');
    expect(globalCss).not.toContain('--profile-stack-control-hover:');
    expect(globalCss).not.toContain('--profile-stack-focus-offset:');
  });

  it('describes carousel cards as slides instead of orphan tab panels', () => {
    expect(authorProfileSource.match(/role="group"/g)).toHaveLength(3);
    expect(authorProfileSource.match(/aria-roledescription="slide"/g)).toHaveLength(2);
    expect(authorProfileSource).toContain('role="group" aria-label="切换个人卡片"');
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

  it('uses a small labeled orb that opens a content-rich compact player without navigating', () => {
    expect(providerSource).toContain('data-music-playback-orb');
    expect(providerSource).toContain('data-music-compact-player');
    expect(providerSource).toContain('打开迷你播放器：');
    expect(providerSource).toContain('aria-label="进入音乐大厅"');
    expect(providerSource).toContain('aria-label="打开沉浸播放器"');
  });

  it('keeps the mobile sheet structured as a single-view playback system with artwork, seek, transport, volume, and tools', () => {
    const sheet = mobileSheetSource();

    expect(sheet).toContain('top-[max(0.5rem,env(safe-area-inset-top))]');
    expect(sheet).toContain('left-[max(0.75rem,env(safe-area-inset-left))]');
    expect(sheet).toContain('right-[max(0.75rem,env(safe-area-inset-right))]');
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
