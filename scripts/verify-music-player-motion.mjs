#!/usr/bin/env node

/**
 * Browser-rendered music-player motion and geometry gate.
 *
 * Usage:
 *   BLOG_URL=http://127.0.0.1:3000 \
 *   ADMIN_URL=http://127.0.0.1:5173/admin/ \
 *   pnpm exec node scripts/verify-music-player-motion.mjs --browser=chromium
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const FIXTURE_COVER_PATH = path.join(REPO_ROOT, '.agent/rules/assets/dark-theme-preview.png');

/** 30s 静音 PCM WAV(8kHz 单声道):任何浏览器可解码的回放 fixture。 */
function buildSilentWav(seconds = 30, sampleRate = 8000) {
  const sampleCount = seconds * sampleRate;
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

const FIXTURE_SILENT_WAV = buildSilentWav();
const DEFAULT_BLOG_URL = 'http://127.0.0.1:3000';
const DEFAULT_ADMIN_URL = 'http://127.0.0.1:5173/admin/';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(REPO_ROOT, 'output/playwright/music-player-motion', RUN_ID);

function parseArgs(argv) {
  return argv.reduce((options, argument) => {
    const [key, ...rest] = argument.split('=');
    if (key === '--browser') options.browser = rest.join('=');
    if (key === '--headed') options.headless = false;
    if (key === '--blog-url') options.blogUrl = rest.join('=');
    if (key === '--admin-url') options.adminUrl = rest.join('=');
    return options;
  }, {
    browser: 'chromium',
    blogUrl: process.env.BLOG_URL || DEFAULT_BLOG_URL,
    adminUrl: process.env.ADMIN_URL || DEFAULT_ADMIN_URL,
    headless: process.env.HEADED !== '1',
  });
}

function joinUrl(base, targetPath) {
  return `${base.replace(/\/+$/, '')}/${targetPath.replace(/^\/+/, '')}`;
}

async function assertReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  } catch (error) {
    throw new Error(`无法访问 ${url}。请先启动对应前端服务。原始错误: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function buildFixture(blogUrl) {
  const coverUrl = joinUrl(blogUrl, '/api/__music-player-fixture__/cover.png');
  const audioUrl = joinUrl(blogUrl, '/api/v1/public/media/37');
  const makeTrack = (id, title, artist, sortOrder) => ({
    id,
    mediaFileId: 37,
    title,
    artist,
    album: 'Aether Sessions',
    durationSeconds: 208,
    coverUrl,
    lyric: '[00:00.00]晨雾沿着窗边慢慢散开\n[00:03.00]旋律把远处的光带回来',
    source: 'MEDIA_LIBRARY',
    status: 'ACTIVE',
    sortOrder,
    isFeatured: id === 101,
    playCount: 12 + sortOrder,
    media: {
      id: 37,
      originalName: `${artist} - ${title}.mp3`,
      fileUrl: audioUrl,
      publicUrl: audioUrl,
      thumbnailUrl: coverUrl,
      fileSize: 8392944,
      mimeType: 'audio/mpeg',
      fileType: 'AUDIO',
      folderId: 12,
      deleted: false,
    },
    createdAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:00:00Z',
  });
  const tracks = [
    makeTrack(101, '假如让我说下去', '杨千嬅', 0),
    makeTrack(102, '海岸线', 'Aether Ensemble', 1),
    makeTrack(103, '归途', 'Midnight Studio', 2),
  ];
  const settings = {
    enabled: true,
    showOnHomePage: true,
    showOnProfileCard: true,
    featuredPlaylistId: 1,
    mediaFolderId: 12,
    playbackMode: 'SEQUENTIAL',
    carouselEnabled: true,
    carouselIntervalSeconds: 8,
    randomEnabled: false,
    skinMode: 'preset',
    skinPreset: 'aether',
  };
  const playlist = {
    id: 1,
    name: '我的歌单',
    slug: 'aether-motion-qa',
    description: '播放器动效验证夹具。',
    coverUrl,
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    displayOnHome: true,
    displayOnProfile: true,
    carouselEnabled: true,
    randomEnabled: false,
    sortOrder: 0,
    trackCount: tracks.length,
    tracks,
  };
  return { coverUrl, playlist, settings, tracks };
}

async function installBrowserState(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('aetherblog-theme', 'dark');
    window.localStorage.setItem('aetherblog-auth', JSON.stringify({
      state: { isAuthenticated: true },
      version: 0,
    }));

    Object.defineProperty(HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value() {},
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value() {
        queueMicrotask(() => this.dispatchEvent(new Event('play')));
        return Promise.resolve();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value() {
        queueMicrotask(() => this.dispatchEvent(new Event('pause')));
      },
    });
  });
}

async function installMusicMocks(page, fixture) {
  const pageResult = (list) => ({
    list,
    total: list.length,
    pageNum: 1,
    pageSize: Math.max(1, list.length),
    pages: 1,
  });
  const ok = (data) => ({ code: 200, message: 'OK', data, timestamp: Date.now() });

  await page.route('**/api/**', async (route) => {
    const requestUrl = route.request().url();
    const queryStart = requestUrl.indexOf('?');
    const requestPath = queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart);

    if (requestPath.endsWith('/__music-player-fixture__/cover.png')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: await readFile(FIXTURE_COVER_PATH),
      });
      return;
    }

    // 音频与封面同哲学:回放用本地 fixture,不依赖真实媒体库。
    // Playwright 打包的 Chromium 不带 MP3 专有解码器,直连真实 mp3 会触发
    // NotSupportedError → playbackError → 错误态自动弹出 compact,让
    // 「minimized → compact」形变捕获的起点漂移(竞态偶发)。静音 PCM WAV
    // 任何浏览器都可解码,时间轴照常推进。
    if (requestPath.includes('/api/v1/public/media/')) {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: FIXTURE_SILENT_WAV,
      });
      return;
    }

    // 重定向或缩略图等静态上传文件放行给真实 dev server(不落兜底 JSON)。
    if (requestPath.includes('/api/uploads/')) {
      await route.continue();
      return;
    }

    let data;

    if (requestPath.endsWith('/v1/public/music/player')) {
      data = ok({ ...fixture.settings, playlist: fixture.playlist, tracks: fixture.tracks });
    } else if (requestPath.endsWith('/v1/auth/me')) {
      data = ok({
        id: 1,
        username: 'motion-audit',
        nickname: 'Motion Audit',
        email: 'motion-audit@example.invalid',
        avatar: '',
        roles: ['ADMIN'],
      });
    } else if (requestPath.endsWith('/v1/admin/music/settings')) {
      data = ok(fixture.settings);
    } else if (requestPath.endsWith('/v1/admin/music/summary')) {
      data = ok({
        trackCount: fixture.tracks.length,
        activeTrackCount: fixture.tracks.length,
        playlistCount: 1,
        mappedMediaCount: fixture.tracks.length,
        availableAudioCount: fixture.tracks.length,
        settings: fixture.settings,
      });
    } else if (requestPath.endsWith('/v1/admin/music/tracks/scan')) {
      data = ok(pageResult([]));
    } else if (requestPath.endsWith('/v1/admin/music/tracks')) {
      data = ok(pageResult(fixture.tracks));
    } else if (/\/v1\/admin\/music\/playlists\/1$/.test(requestPath)) {
      data = ok(fixture.playlist);
    } else if (requestPath.endsWith('/v1/admin/music/playlists')) {
      data = ok(pageResult([fixture.playlist]));
    } else if (requestPath.endsWith('/v1/admin/media/folders/tree')) {
      data = ok([{
        id: 12,
        name: '音乐大厅',
        slug: 'music-hall',
        path: '/music-hall',
        depth: 1,
        sortOrder: 0,
        color: '#DC3D44',
        icon: 'music',
        visibility: 'PRIVATE',
        fileCount: fixture.tracks.length,
        totalSize: 25178832,
        createdAt: '2026-07-16T00:00:00Z',
        updatedAt: '2026-07-16T00:00:00Z',
        children: [],
      }]);
    } else if (requestPath.endsWith('/v1/admin/media')) {
      data = ok(pageResult([]));
    } else if (requestPath.endsWith('/v1/admin/settings')) {
      data = ok({ site_title: 'AetherBlog' });
    } else {
      data = ok({ list: [], items: [], total: 0 });
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}

async function waitForDecodedImage(page, containerSelector) {
  await page.locator(`${containerSelector} img`).first().waitFor({ state: 'visible', timeout: 12000 });
  const result = await page.locator(`${containerSelector} img`).first().evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) return { complete: false, naturalWidth: 0 };
    try {
      await image.decode();
    } catch {
      /* The explicit naturalWidth check below reports a stable failure. */
    }
    return { complete: image.complete, naturalWidth: image.naturalWidth };
  });
  if (!result.complete || result.naturalWidth <= 0) {
    throw new Error(`${containerSelector} 中的真实封面未成功解码`);
  }
}

function roundedRect(rect) {
  if (!rect) return null;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Object.fromEntries(Object.entries({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    centerX,
    centerY,
  }).map(([key, value]) => [key, Number(value.toFixed(3))]));
}

async function captureMorph(page, actionSelector, expectedDensity) {
  return page.evaluate(async ({ selector, targetDensity }) => {
    const rootSelector = '[data-music-floating-root]';
    const shellSelector = '[data-music-floating-shell]';
    const artworkSelector = '[data-music-floating-artwork]';
    const clipSelector = '[data-music-floating-artwork] .music-island-cover-image';
    const imageSelector = '[data-music-island-cover-pixels]';

    const radiusPixels = (value, width, height) => {
      const [horizontalValue, verticalValue = horizontalValue] = value
        .replace('/', ' ')
        .trim()
        .split(/\s+/);
      const toPixels = (part, dimension) => {
        const numeric = Number.parseFloat(part) || 0;
        return part.includes('%') ? numeric * dimension / 100 : numeric;
      };
      return Math.min(
        toPixels(horizontalValue, width),
        toPixels(verticalValue, height),
      );
    };
    const snapshotRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: Number(rect.left.toFixed(3)),
        top: Number(rect.top.toFixed(3)),
        right: Number(rect.right.toFixed(3)),
        bottom: Number(rect.bottom.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        centerX: Number((rect.left + rect.width / 2).toFixed(3)),
        centerY: Number((rect.top + rect.height / 2).toFixed(3)),
        borderRadius: Number(radiusPixels(
          style.borderTopLeftRadius,
          rect.width,
          rect.height,
        ).toFixed(3)),
        borderTopWidth: Number.parseFloat(style.borderTopWidth) || 0,
        borderRightWidth: Number.parseFloat(style.borderRightWidth) || 0,
        borderBottomWidth: Number.parseFloat(style.borderBottomWidth) || 0,
        borderLeftWidth: Number.parseFloat(style.borderLeftWidth) || 0,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        layoutWidth: element instanceof HTMLElement ? element.offsetWidth : undefined,
        layoutHeight: element instanceof HTMLElement ? element.offsetHeight : undefined,
        currentSrc: element instanceof HTMLImageElement ? element.currentSrc : undefined,
      };
    };
    const takeSample = (startedAt) => {
      const root = document.querySelector(rootSelector);
      const shell = document.querySelector(shellSelector);
      return {
        time: Number((performance.now() - startedAt).toFixed(2)),
        density: root?.getAttribute('data-music-floating-density') || '',
        shell: snapshotRect(shell),
        artworkButton: snapshotRect(document.querySelector(artworkSelector)),
        artworkClip: snapshotRect(document.querySelector(clipSelector)),
        artworkImage: snapshotRect(document.querySelector(imageSelector)),
        artworkNodeCount: document.querySelectorAll(artworkSelector).length,
        artworkClipNodeCount: document.querySelectorAll(clipSelector).length,
        artworkImageNodeCount: document.querySelectorAll(imageSelector).length,
      };
    };
    const rectDelta = (left, right) => {
      if (!left || !right) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(left.left - right.left),
        Math.abs(left.top - right.top),
        Math.abs(left.width - right.width),
        Math.abs(left.height - right.height),
        Math.abs(left.borderRadius - right.borderRadius),
      );
    };

    const action = document.querySelector(selector);
    if (!(action instanceof HTMLElement)) throw new Error(`找不到动效触发器: ${selector}`);

    const startedAt = performance.now();
    const samples = [takeSample(startedAt)];
    await new Promise((resolve) => requestAnimationFrame(resolve));
    action.click();

    return new Promise((resolve, reject) => {
      let motionStarted = false;
      let stableFrames = 0;

      const frame = () => {
        const sample = takeSample(startedAt);
        const first = samples[0];
        const previous = samples.at(-1);
        samples.push(sample);

        const movedFromStart = Math.max(
          rectDelta(first.shell, sample.shell),
          rectDelta(first.artworkButton, sample.artworkButton),
          rectDelta(first.artworkImage, sample.artworkImage),
        );
        if (movedFromStart > 0.25 || sample.density === targetDensity) motionStarted = true;

        const frameDelta = Math.max(
          rectDelta(previous.shell, sample.shell),
          rectDelta(previous.artworkButton, sample.artworkButton),
          rectDelta(previous.artworkImage, sample.artworkImage),
        );
        const radiusReady = Boolean(sample.shell);
        if (
          motionStarted
          && sample.density === targetDensity
          && radiusReady
          && frameDelta < 0.15
        ) stableFrames += 1;
        else stableFrames = 0;

        if (motionStarted && stableFrames >= 10) {
          resolve(samples);
          return;
        }
        if (performance.now() - startedAt > 2200) {
          reject(new Error(
            `动效未在 2200ms 内稳定到 ${targetDensity}`
            + `；终态=${sample.density || 'missing'}`
            + `，末帧变化=${Number.isFinite(frameDelta) ? frameDelta.toFixed(3) : '∞'}px`
            + `，密度序列=${Array.from(new Set(samples.map((entry) => entry.density || 'missing'))).join('>')}`,
          ));
          return;
        }
        requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    });
  }, { selector: actionSelector, targetDensity: expectedDensity });
}

async function captureAdminTransition(page, actionSelector, expectedDensity) {
  return page.evaluate(async ({ selector, targetDensity }) => {
    const selectors = {
      root: '[data-admin-music-player-root]',
      surface: '[data-admin-player-surface]',
      core: '[data-admin-player-morph-content]',
      cover: '[data-admin-player-core-cover]',
      coverClip: '.admin-player-core-cover-image',
      coverImage: '[data-admin-player-core-cover] img',
      identity: '[data-admin-player-core-identity]',
      transport: '[data-admin-player-core-transport]',
      play: '[data-admin-player-core-play]',
      progress: '[data-admin-player-core-progress]',
      previous: '[data-admin-player-core-transport] button[aria-label="上一首"]',
      next: '[data-admin-player-core-transport] button[aria-label="下一首"]',
      minimize: '[data-admin-player-core-actions] button[aria-label="最小化后台播放器"]',
      densityAction: '[data-admin-player-core-actions] .admin-player-action-density',
      restore: '[data-admin-player-mini-restore]',
      expandedDetail: '[data-admin-player-expanded-detail]',
    };
    window.__aetherAdminPlayerMotionAudit ??= {
      ids: new WeakMap(),
      nextId: 1,
    };
    const audit = window.__aetherAdminPlayerMotionAudit;
    const nodeId = (node) => {
      if (!(node instanceof Node)) return null;
      const existing = audit.ids.get(node);
      if (existing) return existing;
      const next = audit.nextId;
      audit.nextId += 1;
      audit.ids.set(node, next);
      return next;
    };
    const visibleElement = (selectorValue) => Array.from(document.querySelectorAll(selectorValue))
      .find((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
    const radiusPixels = (value, width, height) => {
      const [horizontalValue, verticalValue = horizontalValue] = value
        .replace('/', ' ')
        .trim()
        .split(/\s+/);
      const toPixels = (part, dimension) => {
        const numeric = Number.parseFloat(part) || 0;
        return part.includes('%') ? numeric * dimension / 100 : numeric;
      };
      return Math.min(
        toPixels(horizontalValue, width),
        toPixels(verticalValue, height),
      );
    };
    const snapshotPersistent = (selectorValue) => {
      const nodes = Array.from(document.querySelectorAll(selectorValue));
      const element = nodes.find((candidate) => (
        candidate instanceof HTMLElement
        && candidate.getClientRects().length > 0
      )) ?? nodes[0];
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const matrix = style.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(style.transform);
      const parsedRadius = radiusPixels(
        style.borderTopLeftRadius,
        box.width,
        box.height,
      );
      return {
        count: nodes.length,
        nodeId: nodeId(element),
        connected: element.isConnected,
        display: style.display,
        visibility: style.visibility,
        opacity: Number((Number.parseFloat(style.opacity) || 0).toFixed(4)),
        scaleX: Number(Math.hypot(matrix.a, matrix.b).toFixed(4)),
        scaleY: Number(Math.hypot(matrix.c, matrix.d).toFixed(4)),
        left: Number(box.left.toFixed(3)),
        top: Number(box.top.toFixed(3)),
        right: Number(box.right.toFixed(3)),
        bottom: Number(box.bottom.toFixed(3)),
        width: Number(box.width.toFixed(3)),
        height: Number(box.height.toFixed(3)),
        centerX: Number((box.left + box.width / 2).toFixed(3)),
        centerY: Number((box.top + box.height / 2).toFixed(3)),
        borderRadius: Number(Math.min(parsedRadius, box.width / 2, box.height / 2).toFixed(3)),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clipPath: style.clipPath,
        contain: style.contain,
        transformValue: style.transform,
        backfaceVisibility: style.backfaceVisibility,
        layoutWidth: element.offsetWidth,
        layoutHeight: element.offsetHeight,
        currentSrc: element instanceof HTMLImageElement ? element.currentSrc : undefined,
        complete: element instanceof HTMLImageElement ? element.complete : undefined,
        naturalWidth: element instanceof HTMLImageElement ? element.naturalWidth : undefined,
      };
    };
    const trackedNodes = Object.fromEntries(
      Object.entries(selectors).map(([name, selectorValue]) => [
        name,
        document.querySelector(selectorValue),
      ]),
    );
    const removedTrackedNodeIds = new Set();
    const surfaceNode = trackedNodes.surface;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removedNode of record.removedNodes) {
          for (const trackedNode of Object.values(trackedNodes)) {
            if (
              trackedNode instanceof Node
              && (
                removedNode === trackedNode
                || (removedNode instanceof Element && removedNode.contains(trackedNode))
              )
            ) {
              removedTrackedNodeIds.add(nodeId(trackedNode));
            }
          }
        }
      }
    });
    if (surfaceNode instanceof Node) {
      observer.observe(surfaceNode, { childList: true, subtree: true });
    }
    const takeSample = (startedAt) => {
      const root = snapshotPersistent(selectors.root);
      return {
        time: Number((performance.now() - startedAt).toFixed(2)),
        density: document.querySelector(selectors.root)
          ?.getAttribute('data-admin-player-density') || '',
        root,
        surface: snapshotPersistent(selectors.surface),
        core: snapshotPersistent(selectors.core),
        cover: snapshotPersistent(selectors.cover),
        coverClip: snapshotPersistent(selectors.coverClip),
        coverImage: snapshotPersistent(selectors.coverImage),
        identity: snapshotPersistent(selectors.identity),
        transport: snapshotPersistent(selectors.transport),
        play: snapshotPersistent(selectors.play),
        progress: snapshotPersistent(selectors.progress),
        previous: snapshotPersistent(selectors.previous),
        next: snapshotPersistent(selectors.next),
        minimize: snapshotPersistent(selectors.minimize),
        densityAction: snapshotPersistent(selectors.densityAction),
        restore: snapshotPersistent(selectors.restore),
        expandedDetail: snapshotPersistent(selectors.expandedDetail),
        removedTrackedNodeIds: Array.from(removedTrackedNodeIds).sort((left, right) => left - right),
      };
    };
    const rectDelta = (left, right) => {
      if (!left || !right) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(left.left - right.left),
        Math.abs(left.top - right.top),
        Math.abs(left.width - right.width),
        Math.abs(left.height - right.height),
        Math.abs(left.borderRadius - right.borderRadius),
      );
    };

    const action = visibleElement(selector);
    if (!(action instanceof HTMLElement)) throw new Error(`找不到后台播放器动效触发器: ${selector}`);
    const startedAt = performance.now();
    const samples = [takeSample(startedAt)];
    await new Promise((resolve) => requestAnimationFrame(resolve));
    action.click();

    return new Promise((resolve, reject) => {
      let motionStarted = false;
      let stableFrames = 0;
      const frame = () => {
        const sample = takeSample(startedAt);
        const first = samples[0];
        const previous = samples.at(-1);
        samples.push(sample);
        if (
          rectDelta(first.root, sample.root) > 0.25
          || rectDelta(first.surface, sample.surface) > 0.25
          || rectDelta(first.cover, sample.cover) > 0.25
          || rectDelta(first.play, sample.play) > 0.25
          || sample.density === targetDensity
        ) motionStarted = true;
        const frameDelta = Math.max(
          rectDelta(previous.root, sample.root),
          rectDelta(previous.surface, sample.surface),
          rectDelta(previous.cover, sample.cover),
          rectDelta(previous.play, sample.play),
        );
        const radiusReady = sample.surface && (
          targetDensity === 'minimized'
            ? sample.surface.borderRadius
              >= Math.min(sample.surface.width, sample.surface.height) / 2 - 0.5
            : Math.abs(sample.surface.borderRadius - 24) < 0.35
        );
        if (
          motionStarted
          && sample.density === targetDensity
          && radiusReady
          && frameDelta < 0.15
        ) stableFrames += 1;
        else stableFrames = 0;
        if (motionStarted && stableFrames >= 10) {
          observer.disconnect();
          resolve(samples);
          return;
        }
        if (performance.now() - startedAt > 2600) {
          observer.disconnect();
          reject(new Error(`后台播放器未在 2600ms 内稳定到 ${targetDensity}`));
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, { selector: actionSelector, targetDensity: expectedDensity });
}

function distance(left, right) {
  return Math.hypot(left.centerX - right.centerX, left.centerY - right.centerY);
}

function distanceToSegment(point, start, end) {
  const dx = end.centerX - start.centerX;
  const dy = end.centerY - start.centerY;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return distance(point, start);
  const projection = Math.max(0, Math.min(1, (
    (point.centerX - start.centerX) * dx + (point.centerY - start.centerY) * dy
  ) / denominator));
  return Math.hypot(
    point.centerX - (start.centerX + projection * dx),
    point.centerY - (start.centerY + projection * dy),
  );
}

function normalizedProgress(point, start, end) {
  const dx = end.centerX - start.centerX;
  const dy = end.centerY - start.centerY;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return 0;
  return (
    (point.centerX - start.centerX) * dx + (point.centerY - start.centerY) * dy
  ) / denominator;
}

function assertMorphTrace(label, samples, {
  expectedArtworkSize,
  expectedImageSize,
  expectedShellWidth,
  expectedShellHeight,
  expectedCssInset,
  expectedBorderWidth = 0,
  expectedRadius,
  expectedRasterSize = 120,
  direction,
}) {
  const failures = [];
  const valid = samples.filter((sample) => (
    sample.shell
    && sample.artworkButton
    && sample.artworkClip
    && sample.artworkImage
  ));
  if (valid.length < 12) return [`${label}: 逐帧样本不足 (${valid.length})`];

  const first = valid[0];
  const last = valid.at(-1);
  const buttonStart = first.artworkButton;
  const buttonEnd = last.artworkButton;
  const imageStart = first.artworkImage;
  const imageEnd = last.artworkImage;
  const shellWidthTravel = Math.abs(last.shell.width - first.shell.width);
  const shellHeightTravel = Math.abs(last.shell.height - first.shell.height);
  const buttonSizeTravel = Math.max(
    Math.abs(last.artworkButton.width - first.artworkButton.width),
    Math.abs(last.artworkButton.height - first.artworkButton.height),
  );
  const imageSizeTravel = Math.max(
    Math.abs(last.artworkImage.width - first.artworkImage.width),
    Math.abs(last.artworkImage.height - first.artworkImage.height),
  );
  const shellRadiusTravel = Math.abs(last.shell.borderRadius - first.shell.borderRadius);
  let previousButtonProgress = 0;
  let previousImageProgress = 0;
  let previousInset = (
    first.artworkImage.left - first.artworkButton.left - first.artworkButton.borderLeftWidth
    + first.artworkImage.top - first.artworkButton.top - first.artworkButton.borderTopWidth
  ) / 2;
  let previousShellRadius = first.shell.borderRadius;

  for (let index = 0; index < valid.length; index += 1) {
    const sample = valid[index];
    if (
      sample.artworkNodeCount !== 1
      || sample.artworkClipNodeCount !== 1
      || sample.artworkImageNodeCount !== 1
    ) {
      failures.push(`${label}: 第 ${index} 帧的封面节点数量不唯一`);
      break;
    }
    if (
      sample.artworkButton.overflowX !== 'visible'
      || sample.artworkButton.overflowY !== 'visible'
      || sample.artworkClip.overflowX !== 'clip'
      || sample.artworkClip.overflowY !== 'clip'
    ) {
      failures.push(`${label}: 第 ${index} 帧不是“外层不裁剪、内层单独裁剪”结构`);
      break;
    }
    if (
      Math.abs(sample.artworkImage.layoutWidth - expectedRasterSize) > 0.5
      || Math.abs(sample.artworkImage.layoutHeight - expectedRasterSize) > 0.5
    ) {
      failures.push(`${label}: 第 ${index} 帧封面纹理盒子没有固定为 ${expectedRasterSize}px`);
      break;
    }
    if (sample.artworkImage.currentSrc !== first.artworkImage.currentSrc) {
      failures.push(`${label}: 第 ${index} 帧重新装载了封面图片源`);
      break;
    }
    if (Math.abs(sample.shell.left - first.shell.left) > 1.25) {
      failures.push(`${label}: shell.left 在第 ${index} 帧漂移 ${(sample.shell.left - first.shell.left).toFixed(2)}px`);
      break;
    }
    if (Math.abs(sample.shell.bottom - first.shell.bottom) > 1.25) {
      failures.push(`${label}: shell.bottom 在第 ${index} 帧漂移 ${(sample.shell.bottom - first.shell.bottom).toFixed(2)}px`);
      break;
    }
    if (distanceToSegment(sample.artworkButton, buttonStart, buttonEnd) > 1.5) {
      failures.push(`${label}: 封面按钮在第 ${index} 帧偏离单一锚点轨迹`);
      break;
    }
    if (distanceToSegment(sample.artworkImage, imageStart, imageEnd) > 1.5) {
      failures.push(`${label}: 真实封面像素在第 ${index} 帧偏离单一锚点轨迹`);
      break;
    }
    if (distance(sample.artworkButton, sample.artworkImage) > 0.75) {
      failures.push(`${label}: 第 ${index} 帧真实封面与封面按钮不同心`);
      break;
    }
    if (
      Math.abs(sample.artworkClip.left - sample.artworkImage.left) > 0.75
      || Math.abs(sample.artworkClip.top - sample.artworkImage.top) > 0.75
      || Math.abs(sample.artworkClip.width - sample.artworkImage.width) > 0.75
      || Math.abs(sample.artworkClip.height - sample.artworkImage.height) > 0.75
    ) {
      failures.push(`${label}: 第 ${index} 帧裁剪框与封面像素没有保持重合`);
      break;
    }

    const leftInset = sample.artworkImage.left
      - sample.artworkButton.left
      - sample.artworkButton.borderLeftWidth;
    const rightInset = sample.artworkButton.right
      - sample.artworkImage.right
      - sample.artworkButton.borderRightWidth;
    const topInset = sample.artworkImage.top
      - sample.artworkButton.top
      - sample.artworkButton.borderTopWidth;
    const bottomInset = sample.artworkButton.bottom
      - sample.artworkImage.bottom
      - sample.artworkButton.borderBottomWidth;
    if (Math.max(
      Math.abs(leftInset - rightInset),
      Math.abs(topInset - bottomInset),
      Math.abs(leftInset - topInset),
    ) > 0.75) {
      failures.push(`${label}: 第 ${index} 帧真实封面 inset 不对称`);
      break;
    }
    const averageInset = (leftInset + rightInset + topInset + bottomInset) / 4;
    if (index > 0 && direction === 'open' && averageInset > previousInset + 0.5) {
      failures.push(`${label}: 真实封面 inset 在第 ${index} 帧反向收紧`);
      break;
    }
    if (index > 0 && direction === 'close' && averageInset < previousInset - 0.5) {
      failures.push(`${label}: 真实封面 inset 在第 ${index} 帧反向放大`);
      break;
    }
    previousInset = direction === 'open'
      ? Math.min(previousInset, averageInset)
      : Math.max(previousInset, averageInset);

    if (index > 0 && direction === 'open' && sample.shell.borderRadius > previousShellRadius + 3) {
      failures.push(`${label}: 外壳圆角在第 ${index} 帧反向增大`);
      break;
    }
    if (index > 0 && direction === 'close' && sample.shell.borderRadius < previousShellRadius - 3) {
      failures.push(`${label}: 外壳圆角在第 ${index} 帧反向减小`);
      break;
    }
    previousShellRadius = direction === 'open'
      ? Math.min(previousShellRadius, sample.shell.borderRadius)
      : Math.max(previousShellRadius, sample.shell.borderRadius);

    const buttonProgress = normalizedProgress(sample.artworkButton, buttonStart, buttonEnd);
    const imageProgress = normalizedProgress(sample.artworkImage, imageStart, imageEnd);
    if (index > 0 && buttonProgress < previousButtonProgress - 0.05) {
      failures.push(`${label}: 封面按钮在第 ${index} 帧发生反向回跳`);
      break;
    }
    if (index > 0 && imageProgress < previousImageProgress - 0.05) {
      failures.push(`${label}: 真实封面像素在第 ${index} 帧发生反向回跳`);
      break;
    }
    previousButtonProgress = Math.max(previousButtonProgress, buttonProgress);
    previousImageProgress = Math.max(previousImageProgress, imageProgress);

    if (index > 0) {
      const previous = valid[index - 1];
      const widthDelta = sample.shell.width - previous.shell.width;
      const heightDelta = sample.shell.height - previous.shell.height;
      if (direction === 'open' && (widthDelta < -2 || heightDelta < -2)) {
        failures.push(`${label}: 外壳展开时在第 ${index} 帧反向收缩`);
        break;
      }
      if (direction === 'close' && (widthDelta > 2 || heightDelta > 2)) {
        failures.push(`${label}: 外壳收起时在第 ${index} 帧反向扩大`);
        break;
      }
    }
  }

  // 反瞬移断言:形变必须真实采到中间几何。
  // 帧间「位移/时间」阈值在主线程卡顿下双向失真 —— rAF 采样饥饿时一个采样
  // 间隔可合法推进 60%+ 行程(实测 127ms 间隔 310px),rAF 攒批时又会出现
  // 1ms 时间戳携带 90ms 位移的相邻帧;无论怎么设阈值都在误报与漏报之间摇摆。
  // 唯一对卡顿稳健的不变量:无过渡的硬瞬移不会产生任何处于行程中段的采样,
  // 而真实动画无论多卡总能采到若干中间帧。行程 ≥64px 的维度要求 ≥2 个
  // 位于 5%-95% 区间的中间帧;方向单调性与终点几何由前后的独立断言覆盖。
  const intermediateSamples = (dimension, travel) => {
    if (travel < 64) return Infinity;
    const startValue = valid[0].shell[dimension];
    return valid.filter((sample) => {
      const progress = Math.abs(sample.shell[dimension] - startValue) / travel;
      return progress > 0.05 && progress < 0.95;
    }).length;
  };
  if (
    intermediateSamples('width', shellWidthTravel) < 2
    || intermediateSamples('height', shellHeightTravel) < 2
  ) {
    failures.push(`${label}: 外壳缺少中间过渡帧(疑似无动画直接瞬移到位)`);
  }

  const near = (actual, expected, tolerance, description) => {
    if (Math.abs(actual - expected) > tolerance) {
      failures.push(`${label}: ${description} ${actual}px，不是 ${expected}±${tolerance}px`);
    }
  };
  near(last.artworkButton.width, expectedArtworkSize, 1, '最终封面按钮宽度');
  near(last.artworkButton.height, expectedArtworkSize, 1, '最终封面按钮高度');
  near(last.artworkImage.width, expectedImageSize, 1, '最终真实封面宽度');
  near(last.artworkImage.height, expectedImageSize, 1, '最终真实封面高度');
  near(last.shell.width, expectedShellWidth, 1.5, '最终外壳宽度');
  near(last.shell.height, expectedShellHeight, 1.5, '最终外壳高度');
  near(last.artworkButton.borderTopWidth, expectedBorderWidth, 0.25, '封面按钮上边框');
  near(last.artworkButton.borderRightWidth, expectedBorderWidth, 0.25, '封面按钮右边框');
  near(last.artworkButton.borderBottomWidth, expectedBorderWidth, 0.25, '封面按钮下边框');
  near(last.artworkButton.borderLeftWidth, expectedBorderWidth, 0.25, '封面按钮左边框');
  near(
    last.artworkImage.left - last.artworkButton.left - last.artworkButton.borderLeftWidth,
    expectedCssInset,
    0.75,
    '最终封面左 CSS inset',
  );
  near(
    last.artworkButton.right - last.artworkImage.right - last.artworkButton.borderRightWidth,
    expectedCssInset,
    0.75,
    '最终封面右 CSS inset',
  );
  near(
    last.artworkImage.top - last.artworkButton.top - last.artworkButton.borderTopWidth,
    expectedCssInset,
    0.75,
    '最终封面上 CSS inset',
  );
  near(
    last.artworkButton.bottom - last.artworkImage.bottom - last.artworkButton.borderBottomWidth,
    expectedCssInset,
    0.75,
    '最终封面下 CSS inset',
  );
  if (expectedRadius === 'capsule') {
    if (last.shell.borderRadius < Math.min(expectedShellWidth, expectedShellHeight) / 2 - 1) {
      failures.push(`${label}: 外壳没有稳定为完整胶囊/圆形`);
    }
  } else if (typeof expectedRadius === 'number') {
    near(last.shell.borderRadius, expectedRadius, 1.5, '最终外壳圆角');
  }
  return failures;
}

function assertInversePath(label, openSamples, closeSamples) {
  const failures = [];
  const open = openSamples.filter((sample) => sample.artworkButton);
  const close = closeSamples.filter((sample) => sample.artworkButton);
  const openStart = open[0].artworkButton;
  const openEnd = open.at(-1).artworkButton;
  const closeStart = close[0].artworkButton;
  const closeEnd = close.at(-1).artworkButton;

  if (distance(openEnd, closeStart) > 1.5) failures.push(`${label}: 反向轨迹没有从正向终点开始`);
  if (distance(openStart, closeEnd) > 1.5) failures.push(`${label}: 收起终点没有回到初始位置`);
  if (Math.abs(openStart.width - closeEnd.width) > 0.75) failures.push(`${label}: 收起后的封面尺寸没有回到初始值`);

  for (const sample of close) {
    if (distanceToSegment(sample.artworkButton, openStart, openEnd) > 1.5) {
      failures.push(`${label}: 反向封面偏离正向的单一几何轨迹`);
      break;
    }
  }
  const openImageStart = open[0].artworkImage;
  const openImageEnd = open.at(-1).artworkImage;
  const closeImageStart = close[0].artworkImage;
  const closeImageEnd = close.at(-1).artworkImage;
  if (distance(openImageEnd, closeImageStart) > 1.5) failures.push(`${label}: 真实封面反向轨迹没有从正向终点开始`);
  if (distance(openImageStart, closeImageEnd) > 1.5) failures.push(`${label}: 真实封面收起终点没有回到初始位置`);
  for (const sample of close) {
    if (distanceToSegment(sample.artworkImage, openImageStart, openImageEnd) > 1.5) {
      failures.push(`${label}: 真实封面反向时偏离正向的单一几何轨迹`);
      break;
    }
  }
  return failures;
}

function assertAdminTransitionTrace(label, samples, {
  expectedDensity,
  expectedRootWidth,
  expectedRootHeight,
  expectedSurfaceWidth,
  expectedSurfaceHeight,
  expectedRadius,
  expectedCoverRasterSize,
  sizeDirection,
  allowPlayFade = false,
  expectRestoreReveal = true,
}) {
  const failures = [];
  if (samples.length < 12) return [`${label}: 逐帧样本不足 (${samples.length})`];
  const requiredNodes = [
    'root',
    'surface',
    'core',
    'cover',
    'coverClip',
    'coverImage',
    'identity',
    'transport',
    'play',
    'progress',
    'previous',
    'next',
    'minimize',
    'densityAction',
    'restore',
    'expandedDetail',
  ];
  const alwaysVisibleNodes = new Set(['root', 'surface', 'core', 'cover', 'coverClip', 'play']);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    for (const name of requiredNodes) {
      const node = sample[name];
      if (!node) {
        failures.push(`${label}: 第 ${index} 帧缺少 persistent ${name} 节点`);
        return failures;
      }
      if (node.count !== 1 || !node.connected) {
        failures.push(`${label}: 第 ${index} 帧 persistent ${name} 节点数量或连接状态异常`);
        return failures;
      }
      if (
        node.display === 'none'
        || node.visibility !== 'visible'
        || (
          alwaysVisibleNodes.has(name)
          && (node.width <= 0 || node.height <= 0)
        )
      ) {
        failures.push(`${label}: 第 ${index} 帧 persistent ${name} 出现空帧`);
        return failures;
      }
    }
    if (sample.removedTrackedNodeIds.length > 0) {
      failures.push(`${label}: transition 中卸载了 persistent 节点 ${sample.removedTrackedNodeIds.join(', ')}`);
      return failures;
    }
    if (
      sample.core.opacity < 0.98
      || sample.cover.opacity < 0.9
      || (!allowPlayFade && sample.play.opacity < 0.9)
    ) {
      failures.push(`${label}: 第 ${index} 帧核心层、封面或播放键发生了二次淡入淡出`);
      return failures;
    }
    if (!sample.coverImage.complete || sample.coverImage.naturalWidth <= 0) {
      failures.push(`${label}: 第 ${index} 帧封面图片未保持解码完成`);
      return failures;
    }
  }

  const valid = samples;
  const first = valid[0];
  const last = valid.at(-1);
  for (const name of requiredNodes) {
    if (valid.some((sample) => sample[name].nodeId !== first[name].nodeId)) {
      failures.push(`${label}: persistent ${name} 在形态变化中被替换`);
      return failures;
    }
  }
  if (valid.some((sample) => sample.coverImage.currentSrc !== first.coverImage.currentSrc)) {
    failures.push(`${label}: 封面图片源在形态变化中被替换`);
    return failures;
  }
  if (valid.some((sample) => (
    Math.abs(sample.coverImage.layoutWidth - expectedCoverRasterSize) > 0.5
    || Math.abs(sample.coverImage.layoutHeight - expectedCoverRasterSize) > 0.5
  ))) {
    failures.push(`${label}: 封面纹理盒子没有保持 ${expectedCoverRasterSize}px 的固定高分辨率`);
    return failures;
  }
  if (valid.some((sample) => (
    Math.abs(sample.root.scaleX - 1) > 0.015
    || Math.abs(sample.root.scaleY - 1) > 0.015
    || Math.abs(sample.surface.scaleX - 1) > 0.015
    || Math.abs(sample.surface.scaleY - 1) > 0.015
  ))) {
    failures.push(`${label}: 外壳发生了投影缩放，可能再次拉伸封面纹理`);
    return failures;
  }
  if (valid.some((sample) => (
    Math.abs(sample.cover.scaleX - 1) > 0.015
    || Math.abs(sample.cover.scaleY - 1) > 0.015
  ))) {
    failures.push(`${label}: 封面容器发生了二次投影缩放`);
    return failures;
  }
  if (valid.some((sample) => (
    sample.cover.overflowX !== 'visible'
    || sample.cover.overflowY !== 'visible'
    || sample.cover.clipPath !== 'none'
    || sample.coverClip.overflowX !== 'clip'
    || sample.coverClip.overflowY !== 'clip'
    || sample.coverClip.clipPath !== 'none'
    || Math.abs(
      sample.cover.borderRadius
      - sample.coverClip.borderRadius
      - Math.max(
        (sample.cover.width - sample.coverClip.width) / 2,
        (sample.cover.height - sample.coverClip.height) / 2,
      )
    ) > 0.55
  ))) {
    failures.push(`${label}: 封面存在重复圆角裁剪层或裁剪半径不同步`);
    return failures;
  }
  if (valid.some((sample) => (
    sample.coverClip.transformValue !== 'none'
    || sample.coverClip.contain !== 'none'
    || sample.coverClip.backfaceVisibility !== 'visible'
  ))) {
    failures.push(`${label}: 封面裁剪层被提升为可重分配纹理`);
    return failures;
  }
  const visibilityDeadline = valid.find((sample) => sample.time >= 90) ?? last;
  if (expectedDensity === 'minimized') {
    for (const name of ['previous', 'next', 'minimize', 'densityAction', 'progress', 'expandedDetail']) {
      if (visibilityDeadline[name].opacity > 0.05) {
        failures.push(`${label}: ${name} 没有在外壳收拢前及时退场`);
        return failures;
      }
      const deadlineIndex = valid.indexOf(visibilityDeadline);
      if (valid.slice(deadlineIndex).some((sample) => sample[name].opacity > 0.08)) {
        failures.push(`${label}: ${name} 淡出后再次闪现`);
        return failures;
      }
    }
    if (expectRestoreReveal) {
      const restoreRevealGuardTime = first.density === 'expanded' ? 170 : 105;
      const restoreRevealDeadlineTime = first.density === 'expanded' ? 340 : 260;
      const restoreRevealGuard = valid.find(
        (sample) => sample.time >= restoreRevealGuardTime,
      ) ?? last;
      if (restoreRevealGuard.restore.opacity > 0.08) {
        failures.push(`${label}: minimized 专属按钮过早出现，与退场控件发生交叉叠加`);
        return failures;
      }
      const restoreRevealDeadline = valid.find(
        (sample) => sample.time >= restoreRevealDeadlineTime,
      ) ?? last;
      if (restoreRevealDeadline.restore.opacity < 0.72) {
        failures.push(`${label}: minimized 专属按钮没有随胶囊收聚及时出现`);
        return failures;
      }
    }
  }
  if (first.density === 'minimized') {
    if (visibilityDeadline.restore.opacity > 0.18) {
      failures.push(`${label}: minimized 专属按钮没有在展开时及时退场`);
      return failures;
    }
  }
  if (first.density === 'expanded' && expectedDensity !== 'expanded') {
    if (visibilityDeadline.expandedDetail.opacity > 0.18) {
      failures.push(`${label}: 展开详情没有在收起时及时退场`);
      return failures;
    }
  }
  const rootWidthTravel = Math.abs(last.root.width - first.root.width);
  const rootHeightTravel = Math.abs(last.root.height - first.root.height);
  const surfaceWidthTravel = Math.abs(last.surface.width - first.surface.width);
  const surfaceHeightTravel = Math.abs(last.surface.height - first.surface.height);
  const radiusTravel = Math.abs(last.surface.borderRadius - first.surface.borderRadius);
  const coverCenterTravel = distance(first.cover, last.cover);
  const playCenterTravel = distance(first.play, last.play);
  let previousRadius = first.surface.borderRadius;
  let previousCoverProgress = 0;

  for (let index = 0; index < valid.length; index += 1) {
    const sample = valid[index];
    if (Math.abs(sample.root.centerX - first.root.centerX) > 1.5) {
      failures.push(`${label}: root 在第 ${index} 帧偏离水平锚点`);
      break;
    }
    if (Math.abs(sample.root.bottom - first.root.bottom) > 1.5) {
      failures.push(`${label}: root 在第 ${index} 帧偏离底部锚点`);
      break;
    }
    // minimized 的 60px surface 在 64px root 内垂直居中，终态会有意保留 2px 底部内缩。
    if (Math.abs(sample.surface.bottom - first.surface.bottom) > 3) {
      failures.push(`${label}: surface 在第 ${index} 帧偏离底部锚点`);
      break;
    }
    if (distanceToSegment(sample.surface, first.surface, last.surface) > 3) {
      failures.push(`${label}: surface 在第 ${index} 帧偏离单一几何轨迹`);
      break;
    }
    if (distanceToSegment(sample.cover, first.cover, last.cover) > 7) {
      failures.push(`${label}: persistent 封面在第 ${index} 帧偏离单一几何轨迹`);
      break;
    }
    const coverProgress = normalizedProgress(sample.cover, first.cover, last.cover);
    if (index > 0 && coverProgress < previousCoverProgress - 0.08) {
      failures.push(`${label}: persistent 封面在第 ${index} 帧反向跳动`);
      break;
    }
    previousCoverProgress = Math.max(previousCoverProgress, coverProgress);
    if (index === 0) continue;
    const previous = valid[index - 1];
    const elapsed = sample.time - previous.time;
    const meaningfulMotionAcrossGap = Math.max(
      distance(sample.cover, previous.cover),
      distance(sample.play, previous.play),
      Math.abs(sample.root.width - previous.root.width),
      Math.abs(sample.root.height - previous.root.height),
      Math.abs(sample.surface.borderRadius - previous.surface.borderRadius),
      Math.abs(sample.previous.opacity - previous.previous.opacity) * 20,
      Math.abs(sample.progress.opacity - previous.progress.opacity) * 20,
    );
    if (elapsed > 55 && meaningfulMotionAcrossGap > 2) {
      failures.push(`${label}: 第 ${index} 帧间隔 ${elapsed.toFixed(1)}ms，出现可感知卡顿`);
      break;
    }
    const rootWidthDelta = sample.root.width - previous.root.width;
    const rootHeightDelta = sample.root.height - previous.root.height;
    if (sizeDirection === 'grow' && (rootWidthDelta < -2 || rootHeightDelta < -2)) {
      failures.push(`${label}: root 在第 ${index} 帧反向收缩`);
      break;
    }
    if (sizeDirection === 'shrink' && (rootWidthDelta > 2 || rootHeightDelta > 2)) {
      failures.push(`${label}: root 在第 ${index} 帧反向放大`);
      break;
    }
    if (
      elapsed < 40
      && Math.max(Math.abs(rootWidthDelta), Math.abs(rootHeightDelta))
        > Math.max(20, rootWidthTravel * 0.35, rootHeightTravel * 0.35)
    ) {
      failures.push(`${label}: root 在第 ${index} 帧发生瞬时尺寸跳变`);
      break;
    }
    const frameFactor = Math.min(2, Math.max(1, elapsed / 16.7));
    for (const name of ['cover', 'play']) {
      const centerTravel = name === 'cover' ? coverCenterTravel : playCenterTravel;
      const nodeSizeTravel = Math.max(
        Math.abs(last[name].width - first[name].width),
        Math.abs(last[name].height - first[name].height),
      );
      const maxFrameTravel = name === 'cover'
        ? Math.max(16, centerTravel * 0.28)
        : Math.max(24, centerTravel * 0.5);
      if (distance(sample[name], previous[name]) > maxFrameTravel * frameFactor) {
        failures.push(`${label}: persistent ${name} 在第 ${index} 帧发生位置突跳`);
        break;
      }
      if (
        Math.max(
          Math.abs(sample[name].width - previous[name].width),
          Math.abs(sample[name].height - previous[name].height),
        ) > Math.max(14, nodeSizeTravel * 0.35) * frameFactor
      ) {
        failures.push(`${label}: persistent ${name} 在第 ${index} 帧发生尺寸突跳`);
        break;
      }
      if (
        index > 2
        &&
        Math.max(
          Math.abs(sample[name].scaleX - previous[name].scaleX),
          Math.abs(sample[name].scaleY - previous[name].scaleY),
        ) > 0.12 * frameFactor
      ) {
        failures.push(`${label}: persistent ${name} 在第 ${index} 帧发生缩放突跳`);
        break;
      }
    }
    if (failures.length > 0) break;
    if (
      elapsed < 40
      && Math.max(
        Math.abs(sample.surface.width - previous.surface.width),
        Math.abs(sample.surface.height - previous.surface.height),
      ) > Math.max(20, surfaceWidthTravel * 0.35, surfaceHeightTravel * 0.35)
    ) {
      failures.push(`${label}: surface 在第 ${index} 帧发生瞬时尺寸跳变`);
      break;
    }
    if (
      elapsed < 40
      && Math.abs(sample.surface.borderRadius - previous.surface.borderRadius)
        > Math.max(24, radiusTravel * 0.4)
    ) {
      failures.push(`${label}: surface 圆角在第 ${index} 帧发生瞬时跳变`);
      break;
    }
    if (expectedRadius === 'capsule' && sample.surface.borderRadius < previousRadius - 3) {
      failures.push(`${label}: surface 圆角在第 ${index} 帧反向减小`);
      break;
    }
    if (expectedRadius === 24 && first.surface.borderRadius > 24 && sample.surface.borderRadius > previousRadius + 3) {
      failures.push(`${label}: surface 圆角在第 ${index} 帧反向增大`);
      break;
    }
    previousRadius = expectedRadius === 'capsule'
      ? Math.max(previousRadius, sample.surface.borderRadius)
      : Math.min(previousRadius, sample.surface.borderRadius);
  }

  const near = (actual, expected, tolerance, description) => {
    if (expected == null) return;
    if (Math.abs(actual - expected) > tolerance) {
      failures.push(`${label}: ${description} ${actual}px，不是 ${expected}±${tolerance}px`);
    }
  };
  if (last.density !== expectedDensity) failures.push(`${label}: 终态为 ${last.density || 'unknown'}，不是 ${expectedDensity}`);
  near(last.root.width, expectedRootWidth, 1.5, '终态 root 宽度');
  near(last.root.height, expectedRootHeight, 1.5, '终态 root 高度');
  near(last.surface.width, expectedSurfaceWidth, 1.5, '终态 surface 宽度');
  near(last.surface.height, expectedSurfaceHeight, 1.5, '终态 surface 高度');
  if (
    expectedRadius === 'capsule'
    && last.surface.borderRadius < Math.min(last.surface.width, last.surface.height) / 2 - 1.5
  ) {
    failures.push(`${label}: 终态 surface 未收聚为胶囊圆角`);
  }
  if (expectedRadius === 24 && Math.abs(last.surface.borderRadius - 24) > 1.5) {
    failures.push(`${label}: 终态 surface 圆角 ${last.surface.borderRadius}px，不是 24px`);
  }
  return failures;
}

function assertAdminPersistentSequenceIdentity(traces) {
  const failures = [];
  const nodeNames = [
    'root',
    'surface',
    'core',
    'cover',
    'coverImage',
    'identity',
    'transport',
    'play',
    'progress',
    'previous',
    'next',
    'minimize',
    'densityAction',
    'restore',
    'expandedDetail',
  ];
  const firstSample = traces.find((trace) => trace.length > 0)?.[0];
  if (!firstSample) return ['后台播放器没有可比较的 persistent transition 样本'];
  for (const [traceIndex, trace] of traces.entries()) {
    for (const [sampleIndex, sample] of trace.entries()) {
      for (const name of nodeNames) {
        if (sample[name]?.nodeId !== firstSample[name]?.nodeId) {
          failures.push(`后台播放器第 ${traceIndex + 1} 段第 ${sampleIndex} 帧替换了 persistent ${name}`);
          return failures;
        }
      }
    }
  }
  return failures;
}

async function prepareFrontendPlayer(page, blogUrl) {
  await page.goto(joinUrl(blogUrl, '/music'), { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '播放歌单', exact: true }).waitFor({ state: 'visible', timeout: 12000 });
  await page.getByRole('button', { name: '播放歌单', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.locator('[data-music-floating-density="minimized"]').waitFor({ state: 'visible', timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  await waitForDecodedImage(page, '[data-music-floating-artwork]');
}

async function auditFrontendMobile(page, blogUrl, browserName) {
  await prepareFrontendPlayer(page, blogUrl);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-mobile-minimized-${browserName}.png`) });
  await page.locator('[data-music-floating-shell]').screenshot({ path: path.join(OUTPUT_DIR, `front-mobile-minimized-detail-${browserName}.png`) });
  const openTrace = await captureMorph(page, '[data-music-floating-artwork]', 'compact');
  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-mobile-compact-${browserName}.png`) });
  await page.locator('[data-music-floating-shell]').screenshot({ path: path.join(OUTPUT_DIR, `front-mobile-compact-detail-${browserName}.png`) });
  const closeTrace = await captureMorph(
    page,
    'button[aria-label^="收起为灵动音乐元"]',
    'minimized',
  );
  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-mobile-minimized-returned-${browserName}.png`) });

  await writeFile(
    path.join(OUTPUT_DIR, `front-mobile-open-trace-${browserName}.json`),
    `${JSON.stringify(openTrace, null, 2)}\n`,
  );
  await writeFile(
    path.join(OUTPUT_DIR, `front-mobile-close-trace-${browserName}.json`),
    `${JSON.stringify(closeTrace, null, 2)}\n`,
  );

  return [
    ...assertMorphTrace('前台移动 minimized → compact', openTrace, {
      expectedArtworkSize: 52,
      expectedImageSize: 52,
      expectedShellWidth: 358,
      expectedShellHeight: 136,
      expectedCssInset: 0,
      expectedRadius: 24,
      direction: 'open',
    }),
    ...assertMorphTrace('前台移动 compact → minimized', closeTrace, {
      expectedArtworkSize: 52,
      expectedImageSize: 42,
      expectedShellWidth: 52,
      expectedShellHeight: 52,
      expectedCssInset: 5,
      expectedRadius: 'capsule',
      direction: 'close',
    }),
    ...assertInversePath('前台移动 minimized ↔ compact', openTrace, closeTrace),
  ];
}

async function auditFrontendDesktop(page, blogUrl, browserName) {
  await prepareFrontendPlayer(page, blogUrl);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-desktop-minimized-${browserName}.png`) });
  const minimizedToCompact = await captureMorph(page, '[data-music-floating-artwork]', 'compact');
  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-desktop-compact-${browserName}.png`) });
  const compactToExpanded = await captureMorph(page, '[data-music-density-toggle]', 'expanded');
  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-desktop-expanded-${browserName}.png`) });
  const expandedToCompact = await captureMorph(
    page,
    'button[aria-label="收起播放器"]',
    'compact',
  );
  const compactToMinimized = await captureMorph(
    page,
    'button[aria-label^="收起为灵动音乐元"]',
    'minimized',
  );
  await page.screenshot({ path: path.join(OUTPUT_DIR, `front-desktop-minimized-returned-${browserName}.png`) });

  const densityFocusFailures = [];
  await page.locator('[data-music-floating-artwork]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-music-floating-density="compact"]');
  await page.locator('[data-music-density-toggle]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-music-floating-density="expanded"]');
  // 应用侧经 requestAnimationFrame 延后一帧交接焦点(避免形变中途抢焦点),
  // 属性翻转瞬间的一次性快照必然竞态 —— 改为限时轮询「焦点最终到位」这一真实契约。
  const waitForCompactFocus = () => page
    .waitForFunction(
      () => document.activeElement?.matches('[data-music-compact-focus-target]') ?? false,
      undefined,
      { timeout: 2000 },
    )
    .then(() => true)
    .catch(() => false);
  const expandedFocusTransferred = await waitForCompactFocus();
  if (!expandedFocusTransferred) {
    densityFocusFailures.push('前台桌面 compact → expanded 后键盘焦点未交给持久歌曲信息按钮');
  }
  await page.locator('button[aria-label="收起播放器"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-music-floating-density="compact"]');
  const compactFocusTransferred = await waitForCompactFocus();
  if (!compactFocusTransferred) {
    densityFocusFailures.push('前台桌面 expanded → compact 后键盘焦点未交给持久歌曲信息按钮');
  }
  await writeFile(
    path.join(OUTPUT_DIR, `front-desktop-density-focus-${browserName}.json`),
    `${JSON.stringify({ expandedFocusTransferred, compactFocusTransferred }, null, 2)}\n`,
  );

  const traces = {
    minimizedToCompact,
    compactToExpanded,
    expandedToCompact,
    compactToMinimized,
  };
  await writeFile(
    path.join(OUTPUT_DIR, `front-desktop-traces-${browserName}.json`),
    `${JSON.stringify(traces, null, 2)}\n`,
  );

  return [
    ...densityFocusFailures,
    ...assertMorphTrace('前台桌面 minimized → compact', minimizedToCompact, {
      expectedArtworkSize: 52,
      expectedImageSize: 52,
      expectedShellWidth: 520,
      expectedShellHeight: 152,
      expectedCssInset: 0,
      expectedRadius: 24,
      direction: 'open',
    }),
    ...assertMorphTrace('前台桌面 compact → expanded', compactToExpanded, {
      expectedArtworkSize: 120,
      expectedImageSize: 120,
      expectedShellWidth: 560,
      expectedShellHeight: 612,
      expectedCssInset: 0,
      expectedRadius: 24,
      direction: 'open',
    }),
    ...assertMorphTrace('前台桌面 expanded → compact', expandedToCompact, {
      expectedArtworkSize: 52,
      expectedImageSize: 52,
      expectedShellWidth: 520,
      expectedShellHeight: 152,
      expectedCssInset: 0,
      expectedRadius: 24,
      direction: 'close',
    }),
    ...assertMorphTrace('前台桌面 compact → minimized', compactToMinimized, {
      expectedArtworkSize: 44,
      expectedImageSize: 44,
      expectedShellWidth: 360,
      expectedShellHeight: 64,
      expectedCssInset: 0,
      expectedRadius: 24,
      direction: 'close',
    }),
    ...assertInversePath(
      '前台桌面 minimized ↔ compact',
      minimizedToCompact,
      compactToMinimized,
    ),
    ...assertInversePath(
      '前台桌面 compact ↔ expanded',
      compactToExpanded,
      expandedToCompact,
    ),
  ];
}

async function measureAdminDensity(page, density) {
  return page.evaluate((currentDensity) => {
    const radiusPixels = (value, width, height) => {
      const [horizontalValue, verticalValue = horizontalValue] = value
        .replace('/', ' ')
        .trim()
        .split(/\s+/);
      const toPixels = (part, dimension) => {
        const numeric = Number.parseFloat(part) || 0;
        return part.includes('%') ? numeric * dimension / 100 : numeric;
      };
      return Math.min(
        toPixels(horizontalValue, width),
        toPixels(verticalValue, height),
      );
    };
    const rect = (selector, root = document) => {
      const element = root.querySelector(selector);
      if (!(element instanceof Element)) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: Number(box.left.toFixed(3)),
        top: Number(box.top.toFixed(3)),
        right: Number(box.right.toFixed(3)),
        bottom: Number(box.bottom.toFixed(3)),
        width: Number(box.width.toFixed(3)),
        height: Number(box.height.toFixed(3)),
        centerX: Number((box.left + box.width / 2).toFixed(3)),
        centerY: Number((box.top + box.height / 2).toFixed(3)),
        borderRadius: Number(radiusPixels(
          style.borderTopLeftRadius,
          box.width,
          box.height,
        ).toFixed(3)),
        borderRadiusCss: style.borderRadius,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        scrollbarGutter: style.scrollbarGutter,
      };
    };

    const root = document.querySelector('[data-admin-music-player-root]');
    if (!(root instanceof HTMLElement)) return { density: currentDensity, missing: true };

    if (currentDensity === 'minimized') {
      return {
        density: currentDensity,
        missing: false,
        root: rect('[data-admin-music-player-root]'),
        surface: rect('[data-admin-player-surface]', root),
        layout: rect('[data-admin-player-minimized]', root),
        cover: rect('[data-admin-player-mini-cover]', root),
        title: rect('[data-admin-player-mini-title]', root),
        playTarget: rect('[data-admin-player-mini-play]', root),
        playVisual: rect('[data-admin-player-mini-play-visual]', root),
        restore: rect('[data-admin-player-mini-restore]', root),
        restoreIcon: rect('[data-admin-player-mini-restore] svg', root),
      };
    }

    if (currentDensity === 'expanded') {
      return {
        density: currentDensity,
        missing: false,
        root: rect('[data-admin-music-player-root]'),
        surface: rect('[data-admin-player-surface]', root),
        layout: rect('[data-admin-player-expanded-layout]', root),
        heading: rect('[data-admin-player-expanded-layout] h2', root),
        minimize: rect('[data-admin-player-expanded-layout] button[aria-label="最小化后台播放器"]', root),
        minimizeIcon: rect('[data-admin-player-expanded-layout] button[aria-label="最小化后台播放器"] svg', root),
        densityToggle: rect('[data-admin-player-expanded-layout] [data-admin-player-density-toggle]', root),
        densityToggleIcon: rect('[data-admin-player-expanded-layout] [data-admin-player-density-toggle] svg', root),
        close: rect('[data-admin-player-expanded-layout] button[aria-label="关闭后台播放器"]', root),
        closeIcon: rect('[data-admin-player-expanded-layout] button[aria-label="关闭后台播放器"] svg', root),
        artwork: rect('[data-admin-player-expanded-layout] [role="group"][aria-label="左右滑动切换歌曲"]', root),
        lyrics: rect('[data-admin-player-expanded-layout] [aria-label="歌词"]', root),
        seek: rect('[data-admin-player-expanded-layout] [role="slider"][aria-label="调整播放进度"]', root),
        transport: rect('[data-admin-player-expanded-layout] [data-admin-player-transport]', root),
        playTarget: rect('[data-admin-player-expanded-layout] [data-admin-player-transport] button[aria-label*="后台播放"]', root),
      };
    }

    return {
      density: currentDensity,
      missing: false,
      root: rect('[data-admin-music-player-root]'),
      surface: rect('[data-admin-player-surface]', root),
      layout: rect('[data-admin-player-compact-layout]', root),
      identity: rect('[data-admin-player-compact-identity]', root),
      cover: rect('[data-admin-player-compact-cover]', root),
      playTarget: rect('[data-admin-player-compact-transport] button[aria-label*="后台播放"]', root),
      transport: rect('[data-admin-player-compact-transport]', root),
      actions: rect('[data-admin-player-compact-actions] button[aria-label="最小化后台播放器"]', root),
      actionIcon: rect('[data-admin-player-compact-actions] button[aria-label="最小化后台播放器"] svg', root),
      progress: rect('[data-admin-player-compact-progress]', root),
      progressTrack: rect('[data-admin-player-compact-progress] [role="slider"] > span', root),
    };
  }, density);
}

async function measureAdminActionHover(page, selector) {
  const control = page.locator(selector);
  await control.hover();
  await page.waitForTimeout(160);
  const result = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(40);
  return result;
}

function assertAdminMetrics(minimized, compact, expanded, actionHover) {
  const failures = [];
  const near = (actual, expected, tolerance, label) => {
    if (Math.abs(actual - expected) > tolerance) failures.push(`${label}: ${actual}px，期望 ${expected}±${tolerance}px`);
  };
  const overlaps = (left, right, gap = 0) => (
    left.right + gap > right.left
    && right.right + gap > left.left
    && left.bottom + gap > right.top
    && right.bottom + gap > left.top
  );
  const transparentColor = (color) => color === 'transparent'
    || color === 'rgba(0, 0, 0, 0)'
    || color === 'rgba(0,0,0,0)';

  for (const [density, hoverState] of Object.entries(actionHover)) {
    if (!transparentColor(hoverState.backgroundColor)) {
      failures.push(`后台 ${density} 右上角按钮 hover 不应增加圆形底色 (${hoverState.backgroundColor})`);
    }
    if (hoverState.boxShadow !== 'none') {
      failures.push(`后台 ${density} 右上角按钮 hover 不应增加阴影 (${hoverState.boxShadow})`);
    }
  }

  if (
    minimized.missing
    || !minimized.root
    || !minimized.surface
    || !minimized.layout
    || !minimized.cover
    || !minimized.title
    || !minimized.playTarget
    || !minimized.playVisual
    || !minimized.restore
    || !minimized.restoreIcon
  ) {
    failures.push('后台 minimized 缺少可测量节点');
  } else {
    near(minimized.root.width, 360, 1, '后台 minimized 根宽');
    near(minimized.root.height, 64, 1, '后台 minimized 根高');
    near(minimized.surface.width, 352, 1, '后台 minimized 可见胶囊宽');
    near(minimized.surface.height, 60, 1, '后台 minimized 可见胶囊高');
    near(minimized.layout.height, 58, 1, '后台 minimized 胶囊内容高');
    near(minimized.cover.width, 44, 1, '后台 minimized 封面宽');
    near(minimized.cover.height, 44, 1, '后台 minimized 封面高');
    near(minimized.playTarget.width, 44, 1, '后台 minimized 播放触控宽');
    near(minimized.playTarget.height, 44, 1, '后台 minimized 播放触控高');
    near(minimized.playVisual.width, 32, 1, '后台 minimized 播放视觉宽');
    near(minimized.playVisual.height, 32, 1, '后台 minimized 播放视觉高');
    near(minimized.restore.width, 44, 1, '后台 minimized 列表触控宽');
    near(minimized.restore.height, 44, 1, '后台 minimized 列表触控高');
    near(minimized.restoreIcon.width, 18, 0.75, '后台 minimized 列表图标宽');
    near(minimized.restoreIcon.height, 18, 0.75, '后台 minimized 列表图标高');
    near(minimized.surface.left - minimized.root.left, 4, 1, '后台 minimized 胶囊左外边距');
    near(minimized.root.right - minimized.surface.right, 4, 1, '后台 minimized 胶囊右外边距');
    near(minimized.cover.left - minimized.surface.left, 9, 1, '后台 minimized 封面左内缩');
    near(minimized.cover.top - minimized.surface.top, 8, 1, '后台 minimized 封面上内缩');
    near(minimized.surface.bottom - minimized.cover.bottom, 8, 1, '后台 minimized 封面下内缩');
    if (
      minimized.cover.left < minimized.surface.left - 0.5
      || minimized.cover.top < minimized.surface.top - 0.5
      || minimized.cover.right > minimized.surface.right + 0.5
      || minimized.cover.bottom > minimized.surface.bottom + 0.5
    ) {
      failures.push('后台 minimized 封面没有完整包含在可见胶囊内');
    }
    if (Math.abs(minimized.cover.centerY - minimized.surface.centerY) > 1.5) {
      failures.push('后台 minimized 封面没有在胶囊垂直中心');
    }
    if (Math.abs(minimized.playVisual.centerY - minimized.surface.centerY) > 1.5) {
      failures.push('后台 minimized 播放圆环没有在胶囊垂直中心');
    }
    if (!transparentColor(minimized.playVisual.backgroundColor)) {
      failures.push(`后台 minimized 播放圆环不是透明底 (${minimized.playVisual.backgroundColor})`);
    }
    if (Number.parseFloat(minimized.playVisual.borderWidth) < 1) {
      failures.push('后台 minimized 播放圆环缺少轻量描边');
    }
    if (minimized.title.left - minimized.cover.right < 9.5) {
      failures.push('后台 minimized 封面与标题间距不足 10px');
    }
    if (minimized.playTarget.left - minimized.title.right < 7) {
      failures.push('后台 minimized 标题与播放按钮间距不足 8px');
    }
    if (minimized.restore.left - minimized.playTarget.right < 7) {
      failures.push('后台 minimized 播放与列表按钮间距不足 8px');
    }
    if (minimized.surface.right - minimized.restore.right < 7) {
      failures.push('后台 minimized 右侧留白不足 8px');
    }
    if (minimized.title.width < 120) {
      failures.push(`后台 minimized 标题可读宽度不足 (${minimized.title.width}px)`);
    }
    if (Number.parseFloat(minimized.surface.borderRadius) < 29) {
      failures.push(`后台 minimized 胶囊圆角不足 (${minimized.surface.borderRadius})`);
    }
    if (Number.parseFloat(minimized.surface.borderWidth) < 1) {
      failures.push('后台 minimized 胶囊缺少表面描边');
    }
    if (overlaps(minimized.cover, minimized.title)) failures.push('后台 minimized 封面与标题重叠');
    if (overlaps(minimized.title, minimized.playTarget)) failures.push('后台 minimized 标题与播放按钮重叠');
    if (overlaps(minimized.playTarget, minimized.restore)) failures.push('后台 minimized 播放与列表按钮重叠');
  }

  if (
    compact.missing
    || !compact.surface
    || !compact.layout
    || !compact.identity
    || !compact.cover
    || !compact.playTarget
    || !compact.transport
    || !compact.actions
    || !compact.actionIcon
    || !compact.progress
    || !compact.progressTrack
  ) {
    failures.push('后台 compact 缺少可测量节点');
  } else {
    near(compact.surface.width, 520, 1, '后台 compact 宽');
    near(compact.surface.height, 136, 1, '后台 compact 高');
    near(compact.layout.height, 134, 1, '后台 compact 内容高');
    near(compact.actionIcon.width, 14, 0.75, '后台 compact 右上角图标宽');
    near(compact.actionIcon.height, 14, 0.75, '后台 compact 右上角图标高');
    if (Math.abs(compact.cover.centerY - compact.identity.centerY) > 1.5) {
      failures.push(`后台 compact 封面与文字没有共用水平中心线 (${compact.cover.centerY.toFixed(2)} / ${compact.identity.centerY.toFixed(2)})`);
    }
    const leftInset = compact.progress.left - compact.surface.left;
    const bottomInset = compact.surface.bottom - compact.progress.bottom;
    if (leftInset < 23) failures.push('后台 compact 进度条左侧留白不足 24px');
    if (compact.progressTrack.width < 220 || compact.progressTrack.width > 340) {
      failures.push(`后台 compact 进度条没有收敛到信息区宽度 (${compact.progressTrack.width}px)`);
    }
    if (bottomInset < 11) failures.push('后台 compact 进度条底部留白不足 12px');
    if (compact.identity.right > compact.transport.left - 12) {
      failures.push('后台 compact 歌曲信息挤入中央运输控制区');
    }
    if (compact.progress.right > compact.transport.left - 12) {
      failures.push('后台 compact 进度条没有在右侧播放组之前收束');
    }
    if (compact.surface.right - compact.transport.right < 7) {
      failures.push('后台 compact 播放组右侧留白不足 8px');
    }
    if (compact.surface.right - compact.actions.right < 7) {
      failures.push('后台 compact 右上角操作区留白不足 8px');
    }
    if (Number.parseFloat(compact.surface.borderWidth) < 1) {
      failures.push('后台 compact 缺少表面描边');
    }
    if (Number.parseFloat(compact.surface.borderRadius) < 23) {
      failures.push(`后台 compact 圆角不足 (${compact.surface.borderRadius})`);
    }
    if (overlaps(compact.identity, compact.transport)) failures.push('后台 compact 歌曲信息与中央播放区重叠');
    if (overlaps(compact.transport, compact.actions)) failures.push('后台 compact 中央播放区与操作区重叠');
    if (compact.playTarget.centerY <= compact.cover.centerY + 29.5) {
      failures.push('后台 compact 播放组没有相对封面和文字下沉');
    }
  }

  if (
    expanded.missing
    || !expanded.root
    || !expanded.surface
    || !expanded.layout
    || !expanded.heading
    || !expanded.minimize
    || !expanded.minimizeIcon
    || !expanded.densityToggle
    || !expanded.densityToggleIcon
    || !expanded.close
    || !expanded.closeIcon
    || !expanded.artwork
    || !expanded.lyrics
    || !expanded.seek
    || !expanded.transport
    || !expanded.playTarget
  ) {
    failures.push('后台 expanded 缺少可测量节点');
  } else {
    near(expanded.surface.width, 520, 1, '后台 expanded 宽');
    near(expanded.minimizeIcon.width, 18, 0.75, '后台 expanded 最小化图标宽');
    near(expanded.densityToggleIcon.width, 18, 0.75, '后台 expanded 密度图标宽');
    near(expanded.closeIcon.width, 18, 0.75, '后台 expanded 关闭图标宽');
    if (!String(expanded.layout.scrollbarGutter).includes('both-edges')) {
      failures.push(`后台 expanded 未使用双侧稳定滚动槽 (${expanded.layout.scrollbarGutter || 'none'})`);
    }
    if (Number.parseFloat(expanded.surface.borderWidth) < 1) failures.push('后台 expanded 缺少表面描边');
    if (Number.parseFloat(expanded.surface.borderRadius) < 23) failures.push(`后台 expanded 圆角不足 (${expanded.surface.borderRadius})`);
    if (expanded.heading.right > expanded.minimize.left - 7) failures.push('后台 expanded 标题与顶部操作区间距不足 8px');
    if (!(
      expanded.close.centerX < expanded.densityToggle.centerX
      && expanded.densityToggle.centerX < expanded.minimize.centerX
    )) {
      failures.push('后台 expanded 操作按钮改变了紧凑态的相对顺序');
    }
    if (overlaps(expanded.minimize, expanded.densityToggle)) failures.push('后台 expanded 顶部最小化与密度按钮重叠');
    if (overlaps(expanded.densityToggle, expanded.close)) failures.push('后台 expanded 顶部密度与关闭按钮重叠');
    if (expanded.artwork.right > expanded.lyrics.left - 11) failures.push('后台 expanded 封面与歌词间距不足 12px');
    if (Math.abs(expanded.artwork.top - expanded.lyrics.top) > 2) failures.push('后台 expanded 封面与歌词顶部未对齐');
    const leftInset = expanded.artwork.left - expanded.surface.left;
    const rightInset = expanded.surface.right - expanded.lyrics.right;
    if (leftInset < 23 || rightInset < 23) failures.push('后台 expanded 主内容左右留白不足 24px');
    if (Math.abs(leftInset - rightInset) > 2) failures.push(`后台 expanded 主内容左右留白不对称 (${leftInset.toFixed(2)}px / ${rightInset.toFixed(2)}px)`);
    if (expanded.seek.top - Math.max(expanded.artwork.bottom, expanded.lyrics.bottom) < 7) failures.push('后台 expanded 主内容与进度区间距不足 8px');
    if (expanded.transport.top < expanded.seek.bottom) failures.push('后台 expanded 进度区与播放控制区重叠');
    if (Math.abs(expanded.playTarget.centerX - expanded.surface.centerX) > 1.5) failures.push('后台 expanded 主播放按钮未水平居中');
    if (expanded.surface.bottom - expanded.transport.bottom < 23) failures.push('后台 expanded 底部留白不足 24px');
  }
  return failures;
}

async function auditAdmin(page, adminUrl, browserName) {
  await page.goto(joinUrl(adminUrl, '/music'), { waitUntil: 'domcontentloaded' });
  const playTrack = page.getByRole('button', { name: '播放 假如让我说下去', exact: true });
  await playTrack.waitFor({ state: 'visible', timeout: 12000 });
  await playTrack.click();
  await page.locator('[data-admin-player-compact-layout]').waitFor({ state: 'visible', timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  await waitForDecodedImage(page, '[data-admin-player-compact-cover]');
  await page.waitForTimeout(700);

  const compact = await measureAdminDensity(page, 'compact');
  const compactActionHover = await measureAdminActionHover(
    page,
    '[data-admin-player-compact-actions] button[aria-label="最小化后台播放器"]',
  );
  await page.screenshot({ path: path.join(OUTPUT_DIR, `admin-compact-${browserName}.png`) });
  await page.locator('[data-admin-music-player-root]').screenshot({ path: path.join(OUTPUT_DIR, `admin-compact-detail-${browserName}.png`) });

  const minimizeTrace = await captureAdminTransition(
    page,
    '[data-admin-player-compact-actions] button[aria-label="最小化后台播放器"]',
    'minimized',
  );
  await waitForDecodedImage(page, '[data-admin-player-mini-cover]');
  const minimized = await measureAdminDensity(page, 'minimized');
  await page.screenshot({ path: path.join(OUTPUT_DIR, `admin-minimized-${browserName}.png`) });
  await page.locator('[data-admin-music-player-root]').screenshot({ path: path.join(OUTPUT_DIR, `admin-minimized-detail-${browserName}.png`) });

  const restoreTrace = await captureAdminTransition(
    page,
    '[data-admin-player-mini-restore]',
    'compact',
  );
  const expandTrace = await captureAdminTransition(
    page,
    '[data-admin-player-compact-actions] [data-admin-player-density-toggle]',
    'expanded',
  );
  await waitForDecodedImage(page, '[data-admin-player-expanded-layout] [role="group"][aria-label="左右滑动切换歌曲"]');
  const expanded = await measureAdminDensity(page, 'expanded');
  const expandedActionHover = await measureAdminActionHover(
    page,
    '[data-admin-player-expanded-layout] button[aria-label="最小化后台播放器"]',
  );
  await page.screenshot({ path: path.join(OUTPUT_DIR, `admin-expanded-${browserName}.png`) });
  await page.locator('[data-admin-music-player-root]').screenshot({ path: path.join(OUTPUT_DIR, `admin-expanded-detail-${browserName}.png`) });
  const collapseTrace = await captureAdminTransition(
    page,
    '[data-admin-player-expanded-layout] [data-admin-player-density-toggle]',
    'compact',
  );
  const reexpandTrace = await captureAdminTransition(
    page,
    '[data-admin-player-compact-layout] [data-admin-player-density-toggle]',
    'expanded',
  );
  const expandedMinimizeTrace = await captureAdminTransition(
    page,
    '[data-admin-player-expanded-layout] button[aria-label="最小化后台播放器"]',
    'minimized',
  );

  const actionHover = {
    compact: compactActionHover,
    expanded: expandedActionHover,
  };
  const metrics = { minimized, compact, expanded, actionHover };
  await writeFile(
    path.join(OUTPUT_DIR, `admin-metrics-${browserName}.json`),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  await writeFile(
    path.join(OUTPUT_DIR, `admin-transition-traces-${browserName}.json`),
    `${JSON.stringify({
      minimizeTrace,
      restoreTrace,
      expandTrace,
      collapseTrace,
      reexpandTrace,
      expandedMinimizeTrace,
    }, null, 2)}\n`,
  );
  const allTraces = [
    minimizeTrace,
    restoreTrace,
    expandTrace,
    collapseTrace,
    reexpandTrace,
    expandedMinimizeTrace,
  ];
  return [
    ...assertAdminMetrics(minimized, compact, expanded, actionHover),
    ...assertAdminPersistentSequenceIdentity(allTraces),
    ...assertAdminTransitionTrace('后台 compact → minimized', minimizeTrace, {
      expectedDensity: 'minimized',
      expectedRootWidth: 360,
      expectedRootHeight: 64,
      expectedSurfaceWidth: 352,
      expectedSurfaceHeight: 60,
      expectedRadius: 'capsule',
      expectedCoverRasterSize: 120,
      sizeDirection: 'shrink',
    }),
    ...assertAdminTransitionTrace('后台 minimized → compact', restoreTrace, {
      expectedDensity: 'compact',
      expectedRootWidth: 520,
      expectedRootHeight: 136,
      expectedSurfaceWidth: 520,
      expectedSurfaceHeight: 136,
      expectedRadius: 24,
      expectedCoverRasterSize: 120,
      sizeDirection: 'grow',
    }),
    ...assertAdminTransitionTrace('后台 compact → expanded', expandTrace, {
      expectedDensity: 'expanded',
      expectedRootWidth: 520,
      expectedRootHeight: 380,
      expectedSurfaceWidth: 520,
      expectedSurfaceHeight: 380,
      expectedRadius: 24,
      expectedCoverRasterSize: 120,
      sizeDirection: 'grow',
    }),
    ...assertAdminTransitionTrace('后台 expanded → compact', collapseTrace, {
      expectedDensity: 'compact',
      expectedRootWidth: 520,
      expectedRootHeight: 136,
      expectedSurfaceWidth: 520,
      expectedSurfaceHeight: 136,
      expectedRadius: 24,
      expectedCoverRasterSize: 120,
      sizeDirection: 'shrink',
    }),
    ...assertAdminTransitionTrace('后台 compact → expanded（二次）', reexpandTrace, {
      expectedDensity: 'expanded',
      expectedRootWidth: 520,
      expectedRootHeight: 380,
      expectedSurfaceWidth: 520,
      expectedSurfaceHeight: 380,
      expectedRadius: 24,
      expectedCoverRasterSize: 120,
      sizeDirection: 'grow',
    }),
    ...assertAdminTransitionTrace('后台 expanded → minimized', expandedMinimizeTrace, {
      expectedDensity: 'minimized',
      expectedRootWidth: 360,
      expectedRootHeight: 64,
      expectedSurfaceWidth: 352,
      expectedSurfaceHeight: 60,
      expectedRadius: 'capsule',
      expectedCoverRasterSize: 120,
      sizeDirection: 'shrink',
    }),
  ];
}

async function auditAdminMobile(page, adminUrl, browserName) {
  await page.goto(joinUrl(adminUrl, '/music'), { waitUntil: 'domcontentloaded' });
  const playTrack = page.getByRole('button', { name: '播放 假如让我说下去', exact: true });
  await playTrack.waitFor({ state: 'visible', timeout: 12000 });
  await playTrack.click();
  await page.locator('[data-admin-player-compact-layout]').waitFor({ state: 'visible', timeout: 12000 });
  const minimizeTrace = await captureAdminTransition(
    page,
    '[data-admin-player-compact-mobile-controls] button[aria-label="最小化后台播放器"]',
    'minimized',
  );
  await page.locator('[data-admin-player-mobile-orb]').waitFor({ state: 'visible', timeout: 12000 });

  const metrics = await page.evaluate(() => {
    const radiusPixels = (value, width, height) => {
      const [horizontalValue, verticalValue = horizontalValue] = value
        .replace('/', ' ')
        .trim()
        .split(/\s+/);
      const toPixels = (part, dimension) => {
        const numeric = Number.parseFloat(part) || 0;
        return part.includes('%') ? numeric * dimension / 100 : numeric;
      };
      return Math.min(
        toPixels(horizontalValue, width),
        toPixels(verticalValue, height),
      );
    };
    const measure = (selector, root = document) => {
      const element = root.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: Number(box.left.toFixed(3)),
        top: Number(box.top.toFixed(3)),
        right: Number(box.right.toFixed(3)),
        bottom: Number(box.bottom.toFixed(3)),
        width: Number(box.width.toFixed(3)),
        height: Number(box.height.toFixed(3)),
        borderRadius: Number(radiusPixels(
          style.borderTopLeftRadius,
          box.width,
          box.height,
        ).toFixed(3)),
        borderRadiusCss: style.borderRadius,
        borderWidth: style.borderWidth,
        overflow: style.overflow,
      };
    };

    const root = document.querySelector('[data-admin-music-player-root]');
    if (!(root instanceof HTMLElement)) return { missing: true };
    return {
      missing: false,
      root: measure('[data-admin-music-player-root]'),
      surface: measure('[data-admin-player-surface]', root),
      layout: measure('[data-admin-player-minimized]', root),
      orb: measure('[data-admin-player-mobile-orb]', root),
    };
  });

  await page.screenshot({ path: path.join(OUTPUT_DIR, `admin-mobile-minimized-${browserName}.png`) });
  await page.locator('[data-admin-music-player-root]').screenshot({
    path: path.join(OUTPUT_DIR, `admin-mobile-minimized-detail-${browserName}.png`),
  });
  await writeFile(
    path.join(OUTPUT_DIR, `admin-mobile-metrics-${browserName}.json`),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  const restoreTrace = await captureAdminTransition(
    page,
    '[data-admin-player-minimized-trigger]',
    'compact',
  );

  const failures = [];
  const near = (actual, expected, tolerance, label) => {
    if (Math.abs(actual - expected) > tolerance) {
      failures.push(`${label}: ${actual}px，期望 ${expected}±${tolerance}px`);
    }
  };
  if (metrics.missing || !metrics.root || !metrics.surface || !metrics.layout || !metrics.orb) {
    return ['后台移动 minimized 缺少可测量节点'];
  }

  near(metrics.root.width, 52, 0.75, '后台移动 minimized 根宽');
  near(metrics.root.height, 52, 0.75, '后台移动 minimized 根高');
  near(metrics.surface.width, 52, 0.75, '后台移动 minimized 表面宽');
  near(metrics.surface.height, 52, 0.75, '后台移动 minimized 表面高');
  near(metrics.layout.width, 52, 0.75, '后台移动 minimized 内容宽');
  near(metrics.layout.height, 52, 0.75, '后台移动 minimized 内容高');
  near(metrics.orb.width, 52, 0.75, '后台移动 minimized 小球宽');
  near(metrics.orb.height, 52, 0.75, '后台移动 minimized 小球高');

  if (
    metrics.orb.left < metrics.surface.left - 0.5
    || metrics.orb.top < metrics.surface.top - 0.5
    || metrics.orb.right > metrics.surface.right + 0.5
    || metrics.orb.bottom > metrics.surface.bottom + 0.5
  ) {
    failures.push('后台移动 minimized 小球没有完整包含在 52px 表面内');
  }
  if (Number.parseFloat(metrics.surface.borderWidth) !== 0) {
    failures.push(`后台移动 minimized 表面边框占用了小球空间 (${metrics.surface.borderWidth})`);
  }
  if (Number.parseFloat(metrics.surface.borderRadius) < 25) {
    failures.push(`后台移动 minimized 表面没有保持正圆 (${metrics.surface.borderRadius})`);
  }
  if (metrics.surface.overflow !== 'hidden') {
    failures.push(`后台移动 minimized 表面没有裁切到正圆边界 (${metrics.surface.overflow})`);
  }
  return [
    ...failures,
    ...assertAdminPersistentSequenceIdentity([minimizeTrace, restoreTrace]),
    ...assertAdminTransitionTrace('后台移动 compact → minimized', minimizeTrace, {
      expectedDensity: 'minimized',
      expectedRootWidth: 52,
      expectedRootHeight: 52,
      expectedSurfaceWidth: 52,
      expectedSurfaceHeight: 52,
      expectedRadius: 'capsule',
      expectedCoverRasterSize: 96,
      sizeDirection: 'shrink',
      allowPlayFade: true,
      expectRestoreReveal: false,
    }),
    ...assertAdminTransitionTrace('后台移动 minimized → compact', restoreTrace, {
      expectedDensity: 'compact',
      expectedRootWidth: 366,
      expectedRootHeight: 184,
      expectedSurfaceWidth: 366,
      expectedSurfaceHeight: 184,
      expectedRadius: 24,
      expectedCoverRasterSize: 96,
      sizeDirection: 'grow',
      allowPlayFade: true,
    }),
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!['chromium', 'webkit'].includes(options.browser)) {
    throw new Error(`不支持的浏览器 ${options.browser}；只能使用 chromium 或 webkit`);
  }
  const browserType = options.browser === 'webkit' ? webkit : chromium;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await assertReachable(options.blogUrl);
  await assertReachable(options.adminUrl);

  const executablePath = options.browser === 'chromium'
    ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    : undefined;
  const browser = await browserType.launch({
    headless: options.headless,
    ...(executablePath ? { executablePath } : {}),
  });
  const fixture = buildFixture(options.blogUrl);
  const failures = [];
  const browserVersion = browser.version();

  try {
    const frontDesktopContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const frontDesktopPage = await frontDesktopContext.newPage();
    await installBrowserState(frontDesktopPage);
    await installMusicMocks(frontDesktopPage, fixture);
    try {
      failures.push(...await auditFrontendDesktop(
        frontDesktopPage,
        options.blogUrl,
        options.browser,
      ));
    } finally {
      await frontDesktopContext.close();
    }

    const frontMobileContext = await browser.newContext(options.browser === 'webkit'
      ? { ...devices['iPhone 13'], reducedMotion: 'no-preference' }
      : {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          reducedMotion: 'no-preference',
        });
    const frontMobilePage = await frontMobileContext.newPage();
    await installBrowserState(frontMobilePage);
    await installMusicMocks(frontMobilePage, fixture);
    try {
      failures.push(...await auditFrontendMobile(
        frontMobilePage,
        options.blogUrl,
        options.browser,
      ));
    } finally {
      await frontMobileContext.close();
    }

    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const adminPage = await adminContext.newPage();
    await installBrowserState(adminPage);
    await installMusicMocks(adminPage, fixture);
    try {
      failures.push(...await auditAdmin(adminPage, options.adminUrl, options.browser));
    } catch (error) {
      // 后台审计崩溃降级为失败项:不让 admin 页结构漂移遮蔽前台段的断言汇总
      failures.push(`后台桌面审计中断: ${error.message.split('\n')[0]}`);
    } finally {
      await adminContext.close();
    }

    const adminMobileContext = await browser.newContext(options.browser === 'webkit'
      ? { ...devices['iPhone 13'], reducedMotion: 'no-preference' }
      : {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          reducedMotion: 'no-preference',
        });
    const adminMobilePage = await adminMobileContext.newPage();
    await installBrowserState(adminMobilePage);
    await installMusicMocks(adminMobilePage, fixture);
    try {
      failures.push(...await auditAdminMobile(
        adminMobilePage,
        options.adminUrl,
        options.browser,
      ));
    } catch (error) {
      failures.push(`后台移动审计中断: ${error.message.split('\n')[0]}`);
    } finally {
      await adminMobileContext.close();
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    runId: RUN_ID,
    createdAt: new Date().toISOString(),
    browser: options.browser,
    browserVersion,
    blogUrl: options.blogUrl,
    adminUrl: options.adminUrl,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    frontDesktopViewport: '1280x720',
    frontMobileViewport: options.browser === 'webkit' ? 'iPhone 13' : '390x844 touch mobile',
    adminViewport: '1440x900',
    adminMobileViewport: options.browser === 'webkit' ? 'iPhone 13' : '390x844 touch mobile',
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
  await writeFile(
    path.join(OUTPUT_DIR, `manifest-${options.browser}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (failures.length > 0) {
    console.error('\nMusic-player browser verification failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Music-player motion and geometry verification passed in ${options.browser}.`);
  console.log(`Evidence: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
