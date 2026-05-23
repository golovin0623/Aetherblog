#!/usr/bin/env node

/**
 * Rendered theme-switch stability audit.
 *
 * Usage:
 *   npx --yes --package playwright node scripts/verify-theme-stability.mjs
 *
 * Defaults:
 *   --blog-url=http://127.0.0.1:3000
 *   --admin-url=http://127.0.0.1:5173/admin
 */

import { chromium } from 'playwright';

const DEFAULT_BLOG_URL = 'http://127.0.0.1:3000';
const DEFAULT_ADMIN_URL = 'http://127.0.0.1:5173/admin';

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    const [key, ...rest] = arg.split('=');
    if (key === '--blog-url') acc.blogUrl = rest.join('=');
    if (key === '--admin-url') acc.adminUrl = rest.join('=');
    if (key === '--headed') acc.headless = false;
    return acc;
  }, {
    blogUrl: process.env.BLOG_URL || DEFAULT_BLOG_URL,
    adminUrl: process.env.ADMIN_URL || DEFAULT_ADMIN_URL,
    headless: process.env.HEADED !== '1',
  });
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function assertReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(`无法访问 ${url}。请先启动对应前端服务。原始错误: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function installAdminMocks(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const ok = (data = {}) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 200, message: 'ok', data }),
    });

    if (path.endsWith('/api/v1/auth/me')) {
      return ok({
        id: 1,
        username: 'theme-audit',
        nickname: 'Theme Audit',
        avatar: '',
        email: 'theme-audit@example.invalid',
        roles: ['ADMIN'],
      });
    }

    if (path.endsWith('/api/v1/admin/settings')) {
      return ok({
        site_title: 'AetherBlog',
        theme_visual_color_mode: 'preset',
        theme_primary_color_light: '',
        theme_primary_color_dark: '',
        theme_visual_color_light: '',
        theme_visual_color_dark: '',
      });
    }

    if (path.endsWith('/api/v1/admin/stats/dashboard')) {
      return ok({
        stats: {
          posts: 12,
          categories: 4,
          tags: 18,
          comments: 32,
          views: 1200,
          visitors: 420,
          totalWords: 88000,
          aiTokens: 16000,
          aiCost: 1.23,
        },
        topPosts: [
          { id: 1, title: 'Theme audit sample', viewCount: 128 },
        ],
        visitorTrend: [
          { date: '2026-05-21', pv: 120, uv: 80 },
          { date: '2026-05-22', pv: 160, uv: 96 },
          { date: '2026-05-23', pv: 180, uv: 110 },
        ],
        archiveStats: [],
        deviceStats: [
          { name: '桌面端', value: 70 },
          { name: '移动端', value: 30 },
        ],
        trends: {
          posts: 0,
          categories: 0,
          views: 0,
          visitors: 0,
          comments: 0,
          words: 0,
          postsThisMonth: 0,
        },
      });
    }

    if (path.endsWith('/api/v1/admin/stats/ai-dashboard')) {
      return ok({
        rangeDays: 30,
        overview: {
          totalCalls: 0,
          successCalls: 0,
          errorCalls: 0,
          successRate: 0,
          cacheHitRate: 0,
          totalTokens: 0,
          totalCost: 0,
          avgTokensPerCall: 0,
          avgCostPerCall: 0,
          avgLatencyMs: 0,
        },
        trend: [],
        modelDistribution: [],
        taskDistribution: [],
        records: { list: [], pageNum: 1, pageSize: 10, total: 0, pages: 0 },
      });
    }

    if (path.includes('/api/v1/admin/stats/') || path.includes('/api/v1/admin/analytics')) {
      return ok({
        list: [],
        items: [],
      });
    }

    if (path.endsWith('/api/v1/admin/activities/recent')) {
      return ok([]);
    }

    if (path.endsWith('/api/v1/admin/system/containers')) {
      return ok({
        containers: [],
        totalContainers: 0,
        runningContainers: 0,
        totalMemoryUsed: 0,
        totalMemoryLimit: 0,
        avgCpuPercent: 0,
        dockerAvailable: false,
      });
    }

    if (path.endsWith('/api/v1/admin/system/overview')) {
      return ok({
        metrics: {
          cpuUsage: 0,
          cpuCores: 8,
          cpuModel: 'Theme Audit CPU',
          cpuFrequency: 0,
          memoryUsed: 0,
          memoryTotal: 1,
          memoryPercent: 0,
          diskUsed: 0,
          diskTotal: 1,
          diskPercent: 0,
          networkIn: 0,
          networkOut: 0,
          networkInSpeed: 0,
          networkOutSpeed: 0,
          networkInRate: '0 B/s',
          networkOutRate: '0 B/s',
          networkPercent: 0,
          networkMaxSpeed: 0,
          uptime: 0,
          osName: 'theme-audit',
          osArch: 'arm64',
        },
        storage: {
          uploads: { name: 'uploads', size: 0, fileCount: 0, formatted: '0 B' },
          database: { name: 'database', size: 0, fileCount: 0, formatted: '0 B' },
          logs: { name: 'logs', size: 0, fileCount: 0, formatted: '0 B' },
          redis: { name: 'redis', size: 0, fileCount: 0, formatted: '0 B' },
          totalSize: 1,
          usedSize: 0,
          usedPercent: 0,
        },
        services: [],
      });
    }

    if (path.endsWith('/api/v1/admin/system/history')) {
      return ok({ cpu: [], memory: [], disk: [], network: [], totalPoints: 0 });
    }

    if (path.endsWith('/api/v1/admin/system/log-level')) {
      return ok({ backend: 'info', aiService: 'info' });
    }

    if (path.includes('/api/v1/admin/system/logs')) {
      return ok({ lines: [] });
    }

    if (path.includes('/api/v1/admin/system/')) {
      return ok([]);
    }

    if (path.includes('/api/v1/admin/ai') || path.includes('/api/v1/admin/providers')) {
      return ok({ list: [], items: [], providers: [], models: [] });
    }

    return ok({ list: [], items: [], total: 0 });
  });
}

async function seedThemeAndAuth(page, theme = 'dark') {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem('aetherblog-theme', nextTheme);
    window.localStorage.setItem('aetherblog-auth', JSON.stringify({
      state: { isAuthenticated: true },
      version: 0,
    }));
  }, theme);
}

async function findVisibleLocator(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }
  throw new Error(`找不到可见元素: ${label} (${selectors.join(', ')})`);
}

async function measure(page, targets) {
  return page.evaluate((items) => {
    return items.map((item) => {
      const el = document.querySelector(item.selector);
      if (!el) {
        return { ...item, missing: true };
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        ...item,
        missing: false,
        left: Number(rect.left.toFixed(3)),
        top: Number(rect.top.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        display: style.display,
        visibility: style.visibility,
      };
    });
  }, targets);
}

async function checkThemeTransitionIsolation(page, scenario) {
  if (!scenario.isolationSelectors?.length) return [];

  return page.evaluate((selectors) => {
    const root = document.documentElement;
    const previous = root.dataset.themeTransition;
    root.dataset.themeTransition = 'to-dark';

    try {
      return selectors.flatMap(({ label, selector }) => {
        return Array.from(document.querySelectorAll(selector))
          .slice(0, 8)
          .map((el, index) => ({
            label,
            index,
            selector,
            value: window.getComputedStyle(el).viewTransitionName,
          }))
          .filter((item) => item.value && item.value !== 'none');
      });
    } finally {
      if (previous) {
        root.dataset.themeTransition = previous;
      } else {
        delete root.dataset.themeTransition;
      }
    }
  }, scenario.isolationSelectors);
}

async function checkThemeToggleLayer(page, scenario) {
  if (!scenario.themeToggleViewTransitionName) return [];

  return page.evaluate((expectedName) => {
    return Array.from(document.querySelectorAll('[data-theme-toggle]'))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) > 0;

        return {
          index,
          visible,
          value: style.viewTransitionName,
        };
      })
      .filter((item) => item.visible && item.value !== expectedName)
      .map((item) => (
        `移动端主题按钮未隔离为 ${expectedName} 图层 (actual=${item.value || 'none'}, index=${item.index})`
      ));
  }, scenario.themeToggleViewTransitionName);
}

async function checkMobileSafeAreaGuard(page, scenario) {
  if (!scenario.requireMobileSafeAreaGuard) return [];

  return page.evaluate(() => {
    const failures = [];
    const header = document.querySelector('header');
    if (!header) {
      failures.push('缺少移动端标题栏 header');
    } else {
      const rect = header.getBoundingClientRect();
      const style = window.getComputedStyle(header);
      if (Math.abs(rect.top) > 0.5) {
        failures.push(`移动端标题栏没有从视口顶部铺底色 (top=${rect.top.toFixed(2)}px)`);
      }
      if (style.position !== 'fixed') {
        failures.push(`移动端标题栏不是 fixed 定位 (position=${style.position})`);
      }
    }

    const guardStyle = window.getComputedStyle(document.body, '::before');
    if (guardStyle.content === 'none') {
      failures.push('缺少移动端 safe-area 顶部伪元素遮罩');
    }
    if (guardStyle.position !== 'fixed' || guardStyle.top !== '0px') {
      failures.push(`移动端 safe-area 遮罩定位异常 (position=${guardStyle.position}, top=${guardStyle.top})`);
    }
    if (guardStyle.backgroundColor === 'rgba(0, 0, 0, 0)') {
      failures.push('移动端 safe-area 遮罩背景透明');
    }

    return failures;
  });
}

function compareGeometry(name, before, current, stage, tolerancePx = 1.25) {
  const failures = [];
  for (const base of before) {
    const actual = current.find((item) => item.label === base.label);
    if (!actual || actual.missing) {
      failures.push(`${name} ${stage}: ${base.label} 消失`);
      continue;
    }
    for (const key of ['left', 'top', 'width', 'height']) {
      const delta = Math.abs(actual[key] - base[key]);
      if (delta > tolerancePx) {
        failures.push(`${name} ${stage}: ${base.label}.${key} 变化 ${delta.toFixed(2)}px`);
      }
    }
  }
  return failures;
}

async function auditScenario(page, scenario) {
  await page.setViewportSize(scenario.viewport);
  await scenario.beforeGoto?.(page);
  await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
  await scenario.afterGoto?.(page);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await findVisibleLocator(page, scenario.ready, `${scenario.name} ready`);

  const toggle = await findVisibleLocator(page, [
    '[data-theme-toggle]',
    'button[aria-label*="切换到亮色"]',
    'button[aria-label*="切换到暗色"]',
    'button[aria-label*="切换亮色"]',
    'button[aria-label*="切换暗色"]',
  ], `${scenario.name} theme toggle`);

  const before = await measure(page, scenario.targets);
  const missing = before.filter((item) => item.missing);
  if (missing.length) {
    throw new Error(`${scenario.name}: 缺少稳定性目标 ${missing.map((item) => item.label).join(', ')}`);
  }

  const isolationLeaks = await checkThemeTransitionIsolation(page, scenario);
  const toggleLayerFailures = await checkThemeToggleLayer(page, scenario);
  const safeAreaGuardFailures = await checkMobileSafeAreaGuard(page, scenario);

  const box = await toggle.boundingBox();
  if (!box) throw new Error(`${scenario.name}: 主题按钮没有可测量区域`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(110);
  const during = await measure(page, scenario.targets);
  await page.waitForTimeout(620);
  const after = await measure(page, scenario.targets);

  const rootState = await page.evaluate(() => ({
    className: document.documentElement.className,
    transition: document.documentElement.dataset.themeTransition || '',
    storageTheme: window.localStorage.getItem('aetherblog-theme') || '',
  }));

  const failures = [
    ...isolationLeaks.map((item) => (
      `${scenario.name}: 主题切换期间 ${item.label} 仍保留 view-transition-name=${item.value} (${item.selector} #${item.index})`
    )),
    ...toggleLayerFailures.map((failure) => `${scenario.name}: ${failure}`),
    ...safeAreaGuardFailures.map((failure) => `${scenario.name}: ${failure}`),
    ...compareGeometry(scenario.name, before, during, '切换中'),
    ...compareGeometry(scenario.name, before, after, '切换后'),
  ];

  if (rootState.transition) {
    failures.push(`${scenario.name}: data-theme-transition 未清理 (${rootState.transition})`);
  }

  if (!/\b(light|dark)\b/.test(rootState.className) || !['light', 'dark'].includes(rootState.storageTheme)) {
    failures.push(`${scenario.name}: 主题状态未落地 class=${rootState.className} storage=${rootState.storageTheme}`);
  }

  return failures;
}

function buildScenarios({ blogUrl, adminUrl }) {
  const desktop = { width: 1440, height: 920 };
  const mobile = { width: 390, height: 844 };

  return [
    {
      name: 'blog-home-desktop',
      url: joinUrl(blogUrl, '/'),
      viewport: desktop,
      ready: ['header', 'main'],
      targets: [
        { label: 'blog header', selector: 'header' },
        { label: 'blog hero title', selector: '#main-content h1, h1' },
        { label: 'blog theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'blog-home-book-mobile',
      url: joinUrl(blogUrl, '/'),
      viewport: mobile,
      afterGoto: async (page) => {
        await page.evaluate(() => window.scrollTo(0, Math.floor(window.innerHeight * 0.72)));
        await page.waitForTimeout(250);
      },
      ready: ['[data-theme-book-page]', '[data-theme-toggle]'],
      themeToggleViewTransitionName: 'mobile-theme-toggle',
      requireMobileSafeAreaGuard: true,
      targets: [
        { label: 'blog mobile header', selector: 'header' },
        { label: 'home book page', selector: '[data-theme-book-page]' },
        { label: 'home mobile theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'blog-posts-desktop',
      url: joinUrl(blogUrl, '/posts'),
      viewport: desktop,
      ready: ['header', 'main h2', 'article'],
      isolationSelectors: [
        { label: 'post card', selector: 'article[style*="view-transition-name"], [style*="post-"]' },
      ],
      targets: [
        { label: 'blog header', selector: 'header' },
        { label: 'posts list title', selector: 'main h2' },
        { label: 'first post card', selector: 'article' },
        { label: 'blog theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'blog-posts-mobile',
      url: joinUrl(blogUrl, '/posts'),
      viewport: mobile,
      ready: ['header', 'main', 'article'],
      themeToggleViewTransitionName: 'mobile-theme-toggle',
      requireMobileSafeAreaGuard: true,
      isolationSelectors: [
        { label: 'post card', selector: 'article[style*="view-transition-name"], [style*="post-"]' },
      ],
      targets: [
        { label: 'blog mobile header', selector: 'header' },
        { label: 'posts featured title', selector: 'main h1, main h2' },
        { label: 'first mobile post card', selector: 'article' },
        { label: 'posts mobile theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'blog-agent-login-mobile',
      url: joinUrl(blogUrl, '/agent/login'),
      viewport: mobile,
      ready: ['main h1', 'form, [role="status"]'],
      themeToggleViewTransitionName: 'mobile-theme-toggle',
      requireMobileSafeAreaGuard: true,
      targets: [
        { label: 'agent login title', selector: 'main h1, [role="status"]' },
        { label: 'agent login panel', selector: 'form, [role="status"]' },
        { label: 'agent mobile theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'admin-login-desktop',
      url: joinUrl(adminUrl, '/login'),
      viewport: desktop,
      beforeGoto: installAdminMocks,
      ready: ['.auth-codex-page', '.codex-submit-btn'],
      targets: [
        { label: 'admin login title', selector: '.auth-codex-page h1' },
        { label: 'admin login submit', selector: '.codex-submit-btn' },
        { label: 'admin login theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
    {
      name: 'admin-dashboard-desktop',
      url: joinUrl(adminUrl, '/dashboard'),
      viewport: desktop,
      beforeGoto: async (page) => {
        await installAdminMocks(page);
        await seedThemeAndAuth(page, 'dark');
      },
      ready: ['aside, nav', '[data-theme-toggle], button[aria-label*="切换"]'],
      targets: [
        { label: 'admin sidebar', selector: 'aside, nav' },
        { label: 'admin theme toggle', selector: '[data-theme-toggle]' },
        { label: 'admin main area', selector: 'main, .dashboard-page' },
      ],
    },
    {
      name: 'admin-aetherhub-mobile',
      url: joinUrl(adminUrl, '/aetherhub'),
      viewport: mobile,
      beforeGoto: async (page) => {
        await installAdminMocks(page);
        await seedThemeAndAuth(page, 'dark');
      },
      ready: ['.aetherhub-workspace'],
      targets: [
        { label: 'aetherhub workspace', selector: '.aetherhub-workspace' },
        { label: 'aetherhub header', selector: '.aetherhub-workspace header' },
        { label: 'aetherhub theme toggle', selector: '[data-theme-toggle]' },
      ],
    },
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await assertReachable(options.blogUrl);
  await assertReachable(options.adminUrl);

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: options.headless,
    ...(executablePath ? { executablePath } : {}),
  });

  const failures = [];
  try {
    for (const scenario of buildScenarios(options)) {
      const context = await browser.newContext({
        viewport: scenario.viewport,
        deviceScaleFactor: scenario.viewport.width < 640 ? 3 : 1,
      });
      const page = await context.newPage();
      try {
        const scenarioFailures = await auditScenario(page, scenario);
        if (scenarioFailures.length) {
          failures.push(...scenarioFailures);
          console.log(`FAIL ${scenario.name}`);
        } else {
          console.log(`PASS ${scenario.name}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error('\nTheme stability failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('\nTheme stability audit passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
