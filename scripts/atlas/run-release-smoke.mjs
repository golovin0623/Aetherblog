#!/usr/bin/env node
// Atlas R5 browser smoke runner.
//
// This script logs in through the admin UI, seeds the minimum Atlas data needed
// for deep links, visits the release-smoke matrix through the gateway, and emits
// a JSON report consumable by release-smoke-gate.mjs.
//
// Usage:
//   ATLAS_SMOKE_PASSWORD=... node scripts/atlas/run-release-smoke.mjs
//   ATLAS_SMOKE_BASE_URL=http://localhost:7899 ATLAS_SMOKE_USERNAME=admin ATLAS_SMOKE_PASSWORD=... \
//     npx --yes --package playwright node scripts/atlas/run-release-smoke.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const REQUIRED_CHECKS = [
  { id: 'admin-login', surface: 'Admin', path: '/admin/login' },
  { id: 'atlas-dashboard', surface: 'Atlas', path: '/admin/atlas' },
  { id: 'atlas-reader-note', surface: 'Atlas Reader', path: '/admin/atlas/reader/note/<noteId>' },
  { id: 'atlas-reader-pdf', surface: 'Atlas PDF Reader', path: '/admin/atlas/reader/pdf/<carrierId>' },
  { id: 'atlas-reader-web', surface: 'Atlas Web Reader', path: '/admin/atlas/reader/web/<carrierId>' },
  { id: 'atlas-kp-list', surface: 'Atlas KP', path: '/admin/atlas/kps' },
  { id: 'atlas-kp-detail', surface: 'Atlas KP', path: '/admin/atlas/kp/<kpId>' },
  { id: 'atlas-kp-archive', surface: 'Atlas KP Lifecycle', path: '/admin/atlas/kp/<lifecycleKpId>' },
  { id: 'atlas-kp-restore', surface: 'Atlas KP Lifecycle', path: '/admin/atlas/kp/<lifecycleKpId>' },
  { id: 'atlas-kp-delete', surface: 'Atlas KP Lifecycle', path: '/admin/atlas/kp/<lifecycleKpId>' },
  { id: 'atlas-graph', surface: 'Atlas Graph', path: '/admin/atlas/graph' },
  { id: 'atlas-suggestions', surface: 'Atlas Suggestions', path: '/admin/atlas/suggestions' },
  { id: 'notes-editor', surface: 'Notes', path: '/admin/notes/<noteId>/edit' },
  { id: 'knowledge-base', surface: 'KnowledgeBase', path: '/admin/intelligence/knowledge' },
  { id: 'aetherhub', surface: 'AetherHub', path: '/admin/aetherhub' },
  { id: 'blog-home', surface: 'Blog', path: '/' },
];

const args = parseArgs(argv.slice(2));

if (!args.password) {
  console.error('missing smoke password; set ATLAS_SMOKE_PASSWORD or pass --password <value>');
  exit(2);
}

const runAt = new Date().toISOString();
const report = {
  gatewayUrl: args.baseUrl,
  runAt,
  checks: [],
  metrics: {},
  seeded: {},
};

const runtimeErrors = [];
let browser;
const { chromium } = await loadPlaywright();

try {
  browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({
    baseURL: args.baseUrl,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(args.timeoutMs);
  page.setDefaultNavigationTimeout(args.timeoutMs);
  await installRuntimeObservers(page, runtimeErrors);

  await loginViaUI(page);
  pass('admin-login', '/admin/login', 'Logged in through admin UI and reached an authenticated admin route.');

  const seeded = await seedAtlasData(page);
  report.seeded = summarizeSeeded(seeded);

  const dashboard = await visit(page, 'atlas-dashboard', '/admin/atlas', ['Aether Atlas', '图谱健康']);
  report.metrics.lcpMs = await measureRouteLCP(page, '/admin/atlas', ['Aether Atlas', '图谱健康']);
  dashboard.evidence += ` warm_lcp_ms=${report.metrics.lcpMs}`;

  await visit(page, 'atlas-reader-note', `/admin/atlas/reader/note/${seeded.note.id}`, [seeded.note.title, '标注']);
  await visit(page, 'atlas-reader-pdf', `/admin/atlas/reader/pdf/${seeded.pdfCarrier.id}`, ['PDF 标注', seeded.pdf.anchorText]);
  await visit(page, 'atlas-reader-web', `/admin/atlas/reader/web/${seeded.webCarrier.id}`, ['Web 标注', seeded.web.anchorText]);
  await visit(page, 'atlas-kp-list', '/admin/atlas/kps', ['Knowledge Points', seeded.kp.title]);
  await visit(page, 'atlas-kp-detail', `/admin/atlas/kp/${seeded.kp.id}`, [seeded.kp.title, '知识点']);
  await exerciseKPLifecycle(page, seeded.lifecycleKp);
  await visit(page, 'atlas-graph', '/admin/atlas/graph', ['Aether Graph']);
  report.metrics.graphFps = await measureAnimationFrameFPS(page);
  await visit(page, 'atlas-suggestions', '/admin/atlas/suggestions', ['AI 建议 Inbox', seeded.suggestion.proposedTitle]);
  await visit(page, 'notes-editor', `/admin/notes/${seeded.note.id}/edit`, [seeded.note.title]);
  await visit(page, 'knowledge-base', '/admin/intelligence/knowledge', ['知识库']);
  await visit(page, 'aetherhub', '/admin/aetherhub', ['灵境', 'AetherHub']);
  await visit(page, 'blog-home', '/', ['AetherBlog', '最新发布', '浏览文章']);

  writeReport();
  printSummary();
  if (report.checks.some((check) => check.status !== 'passed')) process.exitCode = 1;
} catch (error) {
  if (report.checks.length === 0 || !report.checks.some((check) => check.status === 'failed')) {
    report.checks.push({
      id: 'runner',
      surface: 'Smoke Runner',
      path: '',
      status: 'failed',
      evidence: '',
      notes: error instanceof Error ? error.message : String(error),
    });
  }
  writeReport();
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    console.error('missing playwright package; run with `npx --yes --package playwright node scripts/atlas/run-release-smoke.mjs` or install Playwright in this workspace');
    console.error(error instanceof Error ? error.message : String(error));
    exit(2);
  }
}

async function loginViaUI(page) {
  await gotoPath(page, '/admin/login');
  await page.locator('#username').fill(args.username);
  await page.locator('#password').fill(args.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: args.timeoutMs }),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), null, { timeout: args.timeoutMs });
  if (page.url().includes('/login')) {
    throw new Error('login did not leave /admin/login');
  }
}

async function seedAtlasData(page) {
  const stamp = compactTimestamp();
  const anchorText = `Atlas smoke anchor ${stamp}`;
  const noteTitle = `Atlas smoke note ${stamp}`;
  const noteBody = [
    `# ${noteTitle}`,
    '',
    `${anchorText} connects annotations, knowledge points, graph relations, and AetherHub context.`,
    '',
    'This note is created by the release smoke runner and can be safely ignored after validation.',
  ].join('\n');
  const start = noteBody.indexOf(anchorText);
  const end = start + anchorText.length;

  const note = await api(page, 'POST', '/api/v1/admin/notes', {
    title: noteTitle,
    contentMarkdown: noteBody,
    summary: 'Atlas release smoke fixture',
    tagNames: ['atlas-smoke'],
    sourceType: 'manual',
  });

  const carrier = await api(page, 'POST', '/api/v1/admin/atlas/carriers/markdown', { noteId: note.id });
  const annotation = await api(page, 'POST', '/api/v1/admin/atlas/annotations', {
    carrierId: carrier.id,
    selectors: [
      {
        type: 'TextQuoteSelector',
        exact: anchorText,
        prefix: noteBody.slice(Math.max(0, start - 30), start),
        suffix: noteBody.slice(end, Math.min(noteBody.length, end + 30)),
      },
      { type: 'TextPositionSelector', start, end },
      { type: 'CssSelector', value: 'article' },
    ],
    bodyType: 'highlight',
    bodyText: 'Release smoke anchored highlight',
    bodyMeta: { source: 'run-release-smoke' },
    anchorState: 'anchored',
    anchorScore: 1,
  });

  const kp = await api(page, 'POST', '/api/v1/admin/atlas/knowledge-points', {
    title: `Atlas Smoke KP ${stamp}`,
    bodyMarkdown: `Evidence-backed KP for ${anchorText}.`,
    type: 'concept',
    status: 'seed',
    provenance: 'user',
    confidence: 0.91,
    evidenceAnnotationIds: [annotation.id],
  });
  const relatedKp = await api(page, 'POST', '/api/v1/admin/atlas/knowledge-points', {
    title: `Atlas Smoke Related KP ${stamp}`,
    bodyMarkdown: 'Second KP used to verify graph relation rendering.',
    type: 'claim',
    status: 'seed',
    provenance: 'user',
    confidence: 0.82,
    evidenceAnnotationIds: [annotation.id],
  });
  const lifecycleKp = await api(page, 'POST', '/api/v1/admin/atlas/knowledge-points', {
    title: `Atlas Smoke Lifecycle KP ${stamp}`,
    bodyMarkdown: 'Temporary KP used to verify browser archive, restore, and delete actions.',
    type: 'method',
    status: 'growing',
    provenance: 'user',
    confidence: 0.88,
    evidenceAnnotationIds: [annotation.id],
  });
  const relation = await api(page, 'POST', '/api/v1/admin/atlas/relations', {
    fromKpId: kp.id,
    toKpId: relatedKp.id,
    type: 'supports',
    strength: 0.8,
    bodyMarkdown: 'Release smoke relation evidence.',
    provenance: 'user',
    evidenceAnnotationIds: [annotation.id],
  });
  const suggestion = await api(page, 'POST', '/api/v1/admin/atlas/suggestions', {
    kind: 'kp',
    carrierId: carrier.id,
    annotationId: annotation.id,
    proposedTitle: `Atlas Smoke Suggestion ${stamp}`,
    proposedBody: 'Pending suggestion created by browser release smoke.',
    proposedKpType: 'claim',
    proposedConfidence: 0.77,
    rationale: 'Smoke runner verifies suggestion inbox visibility.',
    modelId: 'smoke-runner',
    tokensIn: 12,
    tokensOut: 8,
    costUsd: 0,
  });

  const pdfAnchorText = `Atlas PDF smoke anchor ${stamp}`;
  const pdfBuffer = buildSinglePagePDF(pdfAnchorText);
  const media = await uploadPDF(page, `atlas-smoke-${stamp}.pdf`, pdfBuffer);
  const pdfCarrier = await api(page, 'POST', '/api/v1/admin/atlas/carriers/pdf', { mediaFileId: media.id });
  const textLayer = await api(page, 'GET', `/api/v1/admin/atlas/carriers/${pdfCarrier.id}/text-layer`);
  if (!String(textLayer.text || '').includes('Atlas PDF smoke anchor')) {
    throw new Error(`PDF text layer did not include expected smoke anchor; carrier=${pdfCarrier.id}`);
  }

  const webAnchorText = `Atlas Web smoke anchor ${stamp}`;
  const webCarrier = await api(page, 'POST', '/api/v1/admin/atlas/carriers/web', {
    sourceUrl: `https://example.com/atlas-smoke/${stamp}#section`,
    title: `Atlas Web Smoke ${stamp}`,
    contentMarkdown: [
      `# Atlas Web Smoke ${stamp}`,
      '',
      `${webAnchorText} connects clipped web pages to Atlas annotations and AI suggestions.`,
      '',
      'This web snapshot is created by the release smoke runner.',
    ].join('\n'),
    author: 'Atlas smoke runner',
    language: 'en',
  });
  const webTextLayer = await api(page, 'GET', `/api/v1/admin/atlas/carriers/${webCarrier.id}/text-layer`);
  if (!String(webTextLayer.text || '').includes(webAnchorText)) {
    throw new Error(`Web text layer did not include expected smoke anchor; carrier=${webCarrier.id}`);
  }

  return {
    note,
    carrier,
    annotation,
    kp,
    relatedKp,
    relation,
    suggestion,
    lifecycleKp,
    pdf: { media, anchorText: pdfAnchorText, textLayer },
    pdfCarrier,
    web: { anchorText: webAnchorText, textLayer: webTextLayer },
    webCarrier,
  };
}

async function exerciseKPLifecycle(page, lifecycleKp) {
  const detailPath = `/admin/atlas/kp/${lifecycleKp.id}`;
  await gotoPath(page, detailPath);
  await waitForAnyText(page, [lifecycleKp.title, '归档']);

  await page.getByRole('button', { name: /归档/ }).click();
  await page.getByRole('button', { name: /恢复/ }).waitFor({ state: 'visible', timeout: args.timeoutMs });
  await waitForAnyText(page, ['已归档']);
  const archived = await api(page, 'GET', `/api/v1/admin/atlas/knowledge-points/${lifecycleKp.id}`);
  if (!archived.archived || archived.status !== 'archived') {
    throw new Error(`KP archive mismatch: archived=${archived.archived} status=${archived.status}`);
  }
  pass('atlas-kp-archive', detailPath, `kp=${lifecycleKp.id}; archived=${archived.archived}; status=${archived.status}`);

  await page.getByRole('button', { name: /恢复/ }).click();
  await page.getByRole('button', { name: /归档/ }).waitFor({ state: 'visible', timeout: args.timeoutMs });
  const restored = await api(page, 'GET', `/api/v1/admin/atlas/knowledge-points/${lifecycleKp.id}`);
  if (restored.archived || restored.status === 'archived') {
    throw new Error(`KP restore mismatch: archived=${restored.archived} status=${restored.status}`);
  }
  pass('atlas-kp-restore', detailPath, `kp=${lifecycleKp.id}; archived=${restored.archived}; status=${restored.status}`);

  await page.getByRole('button', { name: /^删除$/ }).click();
  await waitForAnyText(page, ['删除知识点', lifecycleKp.title]);
  await page.getByRole('button', { name: /^删除$/ }).last().click();
  await page.waitForURL((url) => url.pathname.endsWith('/admin/atlas/kps'), { timeout: args.timeoutMs });
  await waitForAnyText(page, ['Knowledge Points']);
  const deleted = await rawApi(page, 'GET', `/api/v1/admin/atlas/knowledge-points/${lifecycleKp.id}`);
  if (deleted.ok && deleted.json?.code === 200) {
    throw new Error(`KP delete mismatch: GET still returned code=200 for ${lifecycleKp.id}`);
  }
  pass('atlas-kp-delete', detailPath, `kp=${lifecycleKp.id}; redirected=${pathOf(page.url())}; get_status=${deleted.status}; code=${deleted.json?.code ?? 'n/a'}`);
}

async function visit(page, id, actualPath, expectedTexts) {
  let lastError;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const errorsBefore = runtimeErrors.length;
    try {
      await gotoPath(page, actualPath);
      const matched = await waitForAnyText(page, expectedTexts);
      if (new URL(page.url()).pathname.endsWith('/login')) {
        throw new Error(`redirected to login while visiting ${actualPath}`);
      }
      const newErrors = runtimeErrors.slice(errorsBefore);
      if (newErrors.length) {
        throw new Error(newErrors.join('; '));
      }
      const retryEvidence = attempt > 1 ? `; attempt=${attempt}` : '';
      return pass(id, actualPath, `url=${pathOf(page.url())}; matched="${matched}"${retryEvidence}`);
    } catch (error) {
      lastError = await describeVisitError(page, error);
      if (attempt < maxAttempts) {
        await page.waitForTimeout(1000);
      }
    }
  }
  fail(id, actualPath, lastError);
  return null;
}

async function gotoPath(page, actualPath) {
  await page.goto(actualPath, { waitUntil: 'commit' });
  await page.locator('body').waitFor({ state: 'attached', timeout: args.timeoutMs });
}

function pass(id, actualPath, evidence) {
  const required = requiredCheck(id);
  const check = {
    ...required,
    path: actualPath || required.path,
    status: 'passed',
    evidence,
    notes: '',
  };
  report.checks.push(check);
  return check;
}

function fail(id, actualPath, error) {
  const required = requiredCheck(id);
  report.checks.push({
    ...required,
    path: actualPath || required.path,
    status: 'failed',
    evidence: '',
    notes: error instanceof Error ? error.message : String(error),
  });
}

function requiredCheck(id) {
  const check = REQUIRED_CHECKS.find((item) => item.id === id);
  if (!check) return { id, surface: id, path: '' };
  return check;
}

async function waitForAnyText(page, expectedTexts, timeoutMs = args.timeoutMs) {
  const texts = Array.isArray(expectedTexts) ? expectedTexts.filter(Boolean) : [expectedTexts].filter(Boolean);
  await page.waitForFunction((needles) => {
    const body = document.body?.innerText || '';
    return needles.some((needle) => body.includes(needle));
  }, texts, { timeout: timeoutMs });
  const body = await page.locator('body').innerText({ timeout: timeoutMs });
  return texts.find((needle) => body.includes(needle)) || texts[0] || '';
}

async function describeVisitError(page, error) {
  const message = error instanceof Error ? error.message : String(error);
  let currentUrl = 'n/a';
  let bodySnippet = '';
  try {
    currentUrl = page.url();
    const body = await page.locator('body').innerText({ timeout: 1000 });
    bodySnippet = body.replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch {
    bodySnippet = 'unavailable';
  }
  return new Error(`${message}; current_url=${currentUrl}; body="${bodySnippet}"`);
}

async function api(page, method, path, data) {
  const result = await rawApi(page, method, path, data);
  if (!result.ok || result.json?.code !== 200) {
    throw new Error(`${method} ${path} failed HTTP ${result.status} code=${result.json?.code ?? 'n/a'} message=${result.json?.message ?? result.text.slice(0, 160)}`);
  }
  return result.json.data;
}

async function rawApi(page, method, path, data) {
  const url = joinUrl(args.baseUrl, path);
  const options = data === undefined ? {} : { data };
  const response = await page.request.fetch(url, { method, ...options });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned non-JSON HTTP ${response.status()}: ${text.slice(0, 160)}`);
  }
  return {
    ok: response.ok(),
    status: response.status(),
    text,
    json,
  };
}

async function uploadPDF(page, filename, buffer) {
  const response = await page.request.post(joinUrl(args.baseUrl, '/api/v1/admin/media/upload'), {
    multipart: {
      file: {
        name: filename,
        mimeType: 'application/pdf',
        buffer,
      },
    },
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok() || json.code !== 200) {
    throw new Error(`PDF upload failed HTTP ${response.status()} code=${json.code ?? 'n/a'} message=${json.message ?? text.slice(0, 160)}`);
  }
  return json.data;
}

async function installRuntimeObservers(page, runtimeErrorsTarget) {
  page.on('pageerror', (error) => {
    runtimeErrorsTarget.push(`pageerror: ${error.message}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 500 && (url.includes('/api/') || url.includes('/admin/'))) {
      runtimeErrorsTarget.push(`HTTP ${response.status()} ${pathOf(url)}`);
    }
  });
  await page.addInitScript(() => {
    window.__atlasSmokeLcp = 0;
    try {
      const observer = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__atlasSmokeLcp = last.startTime;
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      window.__atlasSmokeLcp = 0;
    }
  });
}

async function readLCP(page) {
  const value = await page.evaluate(() => {
    const entries = performance.getEntriesByType('largest-contentful-paint');
    const last = entries[entries.length - 1];
    return last?.startTime || window.__atlasSmokeLcp || 0;
  });
  return Math.round(Number(value) || 0);
}

async function measureRouteLCP(page, actualPath, expectedTexts) {
  let lastError;
  const timeoutMs = Math.min(args.timeoutMs, 20000);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await gotoPath(page, actualPath);
      await waitForAnyText(page, expectedTexts, timeoutMs);
      await page.waitForTimeout(250);
      return readLCP(page);
    } catch (error) {
      lastError = await describeVisitError(page, error);
      if (attempt < 3) {
        await page.waitForTimeout(1000);
      }
    }
  }
  throw lastError;
}

async function measureAnimationFrameFPS(page) {
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    const tick = (now) => {
      frames += 1;
      if (now - started >= 1000) {
        resolve((frames * 1000) / Math.max(1, now - started));
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }));
  return Number(Number(fps).toFixed(1));
}

function buildSinglePagePDF(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream\nendobj\n`,
  ];
  const chunks = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(chunks.join(''), 'binary'));
    chunks.push(object);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'binary');
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'binary');
}

function summarizeSeeded(seeded) {
  return {
    noteId: seeded.note.id,
    markdownCarrierId: seeded.carrier.id,
    annotationId: seeded.annotation.id,
    kpId: seeded.kp.id,
    relatedKpId: seeded.relatedKp.id,
    lifecycleKpId: seeded.lifecycleKp.id,
    relationId: seeded.relation.id,
    suggestionId: seeded.suggestion.id,
    pdfMediaId: seeded.pdf.media.id,
    pdfCarrierId: seeded.pdfCarrier.id,
    pdfPageCount: seeded.pdf.textLayer.pageCount,
    webCarrierId: seeded.webCarrier.id,
    webCharCount: seeded.web.textLayer.charCount,
  };
}

function writeReport() {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
}

function printSummary() {
  const passed = report.checks.filter((check) => check.status === 'passed').length;
  const failed = report.checks.filter((check) => check.status !== 'passed').length;
  console.log(`Atlas release smoke: passed=${passed} failed=${failed} report=${args.out}`);
  console.log(`metrics: lcp_ms=${report.metrics.lcpMs ?? 'n/a'} graph_fps=${report.metrics.graphFps ?? 'n/a'}`);
}

function parseArgs(raw) {
  const parsed = {
    baseUrl: process.env.ATLAS_SMOKE_BASE_URL || 'http://localhost:7899',
    username: process.env.ATLAS_SMOKE_USERNAME || 'admin',
    password: process.env.ATLAS_SMOKE_PASSWORD || '',
    out: process.env.ATLAS_SMOKE_REPORT || 'output/playwright/atlas-release-smoke-report.json',
    headless: process.env.HEADED !== '1',
    timeoutMs: Number(process.env.ATLAS_SMOKE_TIMEOUT_MS || 60000),
  };

  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    const [key, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = inlineValue ?? raw[i + 1];
    if (key === '--base-url') {
      parsed.baseUrl = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--username') {
      parsed.username = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--password') {
      parsed.password = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--out') {
      parsed.out = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--timeout-ms') {
      parsed.timeoutMs = Number(value);
      if (inlineValue === undefined) i += 1;
    } else if (arg === '--headed') {
      parsed.headless = false;
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${parsed.timeoutMs}`);
  }
  return parsed;
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function pathOf(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.pathname}${url.search}`;
}
