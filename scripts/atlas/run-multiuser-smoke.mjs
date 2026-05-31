#!/usr/bin/env node
// Atlas multi-user browser smoke runner.
//
// The runner uses the gateway and real browser sessions to prove that a
// non-admin role with explicit Atlas read/write permissions can use Atlas while
// still being scoped to its own author data. It restores the role permissions it
// changes after the run.
//
// Usage:
//   ATLAS_SMOKE_PASSWORD=... node scripts/atlas/run-multiuser-smoke.mjs
//   ATLAS_SMOKE_BASE_URL=http://localhost:7899 ATLAS_SMOKE_PASSWORD=... \
//     npx --yes --package playwright node scripts/atlas/run-multiuser-smoke.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const REQUIRED_CHECKS = [
  { id: 'admin-login', surface: 'Admin', path: '/admin/login' },
  { id: 'role-permission-setup', surface: 'Access Control', path: '/api/v1/admin/roles/<roleId>/permissions' },
  { id: 'author-a-login', surface: 'Non-admin Author A', path: '/admin/login' },
  { id: 'author-b-login', surface: 'Non-admin Author B', path: '/admin/login' },
  { id: 'author-a-dashboard', surface: 'Non-admin Author A', path: '/admin/atlas' },
  { id: 'author-b-dashboard', surface: 'Non-admin Author B', path: '/admin/atlas' },
  { id: 'author-a-create-reader-note', surface: 'Non-admin Reader', path: '/api/v1/admin/atlas/carriers/markdown/source' },
  { id: 'author-b-create-reader-note', surface: 'Non-admin Reader', path: '/api/v1/admin/atlas/carriers/markdown/source' },
  { id: 'author-a-reader-note', surface: 'Non-admin Reader', path: '/admin/atlas/reader/note/<noteAId>' },
  { id: 'author-b-reader-note', surface: 'Non-admin Reader', path: '/admin/atlas/reader/note/<noteBId>' },
  { id: 'author-b-reader-note-denied', surface: 'Non-admin Reader Isolation', path: '/api/v1/admin/atlas/carriers/markdown/<noteAId>/source' },
  { id: 'author-a-create-kp', surface: 'Non-admin Author A', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-create-kp', surface: 'Non-admin Author B', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-cannot-see-author-a', surface: 'Non-admin Isolation', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-author-switch-denied', surface: 'Non-admin Isolation', path: '/api/v1/admin/atlas/knowledge-points?authorId=<authorAId>' },
  { id: 'admin-scope-all-sees-both', surface: 'Admin Scope', path: '/api/v1/admin/atlas/knowledge-points?scope=all' },
  { id: 'admin-author-filter-isolates', surface: 'Admin Scope', path: '/api/v1/admin/atlas/knowledge-points?authorId=<authorAId>' },
];

const args = parseArgs(argv.slice(2));

if (!args.adminPassword) {
  console.error('missing admin smoke password; set ATLAS_SMOKE_PASSWORD or pass --admin-password <value>');
  exit(2);
}

const runAt = new Date().toISOString();
const stamp = compactTimestamp();
const authorPassword = args.authorPassword || `AtlasSmoke${stamp.slice(-6)}Aa`;
const report = {
  gatewayUrl: args.baseUrl,
  runAt,
  actors: {
    admin: { username: args.adminUsername },
    authorA: {},
    authorB: {},
  },
  seeded: {},
  checks: [],
};

let browser;
let adminContext;
let authorAContext;
let authorBContext;
let originalRolePermissions;
let roleID;

const { chromium } = await loadPlaywright();

try {
  browser = await chromium.launch({ headless: args.headless });
  adminContext = await newContext(browser);
  const adminPage = await adminContext.newPage();
  await installRuntimeObservers(adminPage);
  await loginViaUI(adminPage, args.adminUsername, args.adminPassword);
  pass('admin-login', '/admin/login', `admin=${args.adminUsername}`);

  const permissionSetup = await grantAtlasPermissions(adminPage, args.roleCode);
  originalRolePermissions = permissionSetup.originalPermissionCodes;
  roleID = permissionSetup.role.id;
  pass(
    'role-permission-setup',
    `/api/v1/admin/roles/${roleID}/permissions`,
    `role=${args.roleCode}; ensured=content.atlas.read,content.atlas.write`
  );

  const authorA = await ensureSmokeUser(adminPage, `atlas_author_a_${stamp}`, authorPassword, args.roleCode);
  const authorB = await ensureSmokeUser(adminPage, `atlas_author_b_${stamp}`, authorPassword, args.roleCode);
  report.actors.authorA = { id: authorA.id, username: authorA.username, role: args.roleCode };
  report.actors.authorB = { id: authorB.id, username: authorB.username, role: args.roleCode };

  authorAContext = await newContext(browser);
  const authorAPage = await authorAContext.newPage();
  await installRuntimeObservers(authorAPage);
  await loginViaUI(authorAPage, authorA.username, authorPassword);
  pass('author-a-login', '/admin/login', `author=${authorA.username}; id=${authorA.id}`);

  authorBContext = await newContext(browser);
  const authorBPage = await authorBContext.newPage();
  await installRuntimeObservers(authorBPage);
  await loginViaUI(authorBPage, authorB.username, authorPassword);
  pass('author-b-login', '/admin/login', `author=${authorB.username}; id=${authorB.id}`);

  await visit(authorAPage, 'author-a-dashboard', '/admin/atlas', ['Aether Atlas', '知识图集']);
  await visit(authorBPage, 'author-b-dashboard', '/admin/atlas', ['Aether Atlas', '知识图集']);

  const noteTitleA = `Atlas Reader A ${stamp}`;
  const noteTitleB = `Atlas Reader B ${stamp}`;
  const noteAnchorA = `Reader anchor A ${stamp}`;
  const noteAnchorB = `Reader anchor B ${stamp}`;
  const noteA = await api(authorAPage, 'POST', '/api/v1/admin/atlas/carriers/markdown/source', {
    title: noteTitleA,
    contentMarkdown: `# ${noteTitleA}\n\n${noteAnchorA} scoped markdown source for ${authorA.username}.\n\n- 标注入口`,
  });
  pass('author-a-create-reader-note', '/api/v1/admin/atlas/carriers/markdown/source', `note=${noteA.id}; title="${noteA.title}"`);

  const noteB = await api(authorBPage, 'POST', '/api/v1/admin/atlas/carriers/markdown/source', {
    title: noteTitleB,
    contentMarkdown: `# ${noteTitleB}\n\n${noteAnchorB} scoped markdown source for ${authorB.username}.\n\n- 标注入口`,
  });
  pass('author-b-create-reader-note', '/api/v1/admin/atlas/carriers/markdown/source', `note=${noteB.id}; title="${noteB.title}"`);

  await visit(authorAPage, 'author-a-reader-note', `/admin/atlas/reader/note/${noteA.id}`, [noteAnchorA]);
  await visit(authorBPage, 'author-b-reader-note', `/admin/atlas/reader/note/${noteB.id}`, [noteAnchorB]);

  const readerDenied = await rawApi(authorBPage, 'GET', `/api/v1/admin/atlas/carriers/markdown/${noteA.id}/source`);
  if (readerDenied.ok || readerDenied.status !== 403) {
    throw new Error(`author B reader source access returned HTTP ${readerDenied.status}, expected 403`);
  }
  pass(
    'author-b-reader-note-denied',
    `/api/v1/admin/atlas/carriers/markdown/${noteA.id}/source`,
    `http_status=${readerDenied.status}; code=${readerDenied.json?.code ?? 'n/a'}`
  );

  const titleA = `Atlas multi-user A ${stamp}`;
  const titleB = `Atlas multi-user B ${stamp}`;
  const kpA = await api(authorAPage, 'POST', '/api/v1/admin/atlas/knowledge-points', {
    title: titleA,
    bodyMarkdown: `Created by ${authorA.username} during multi-user smoke.`,
    type: 'concept',
    status: 'seed',
    provenance: 'user',
    confidence: 0.91,
  });
  pass('author-a-create-kp', '/api/v1/admin/atlas/knowledge-points', `kp=${kpA.id}; author_id=${kpA.authorId}; title="${kpA.title}"`);

  const kpB = await api(authorBPage, 'POST', '/api/v1/admin/atlas/knowledge-points', {
    title: titleB,
    bodyMarkdown: `Created by ${authorB.username} during multi-user smoke.`,
    type: 'claim',
    status: 'seed',
    provenance: 'user',
    confidence: 0.89,
  });
  pass('author-b-create-kp', '/api/v1/admin/atlas/knowledge-points', `kp=${kpB.id}; author_id=${kpB.authorId}; title="${kpB.title}"`);
  report.seeded = { authorANoteId: noteA.id, authorBNoteId: noteB.id, authorAKpId: kpA.id, authorBKpId: kpB.id };

  const authorBSearchA = await api(authorBPage, 'GET', `/api/v1/admin/atlas/knowledge-points?keyword=${encodeURIComponent(titleA)}&limit=20`);
  if (authorBSearchA.some((kp) => kp.id === kpA.id || kp.title === titleA)) {
    throw new Error(`author B saw author A KP ${kpA.id}`);
  }
  pass('author-b-cannot-see-author-a', '/api/v1/admin/atlas/knowledge-points', `author_b_results_for_author_a_title=${authorBSearchA.length}`);

  const switchResponse = await rawApi(
    authorBPage,
    'GET',
    `/api/v1/admin/atlas/knowledge-points?authorId=${authorA.id}&keyword=${encodeURIComponent(titleA)}`
  );
  if (switchResponse.ok || switchResponse.status !== 403) {
    throw new Error(`author B authorId switch returned HTTP ${switchResponse.status}, expected 403`);
  }
  pass(
    'author-b-author-switch-denied',
    `/api/v1/admin/atlas/knowledge-points?authorId=${authorA.id}`,
    `http_status=${switchResponse.status}; code=${switchResponse.json?.code ?? 'n/a'}`
  );

  const adminAll = await api(adminPage, 'GET', `/api/v1/admin/atlas/knowledge-points?scope=all&keyword=${encodeURIComponent(`Atlas multi-user`)}&limit=50`);
  const hasA = adminAll.some((kp) => kp.id === kpA.id);
  const hasB = adminAll.some((kp) => kp.id === kpB.id);
  if (!hasA || !hasB) {
    throw new Error(`admin scope=all did not include both KPs; hasA=${hasA} hasB=${hasB}`);
  }
  pass('admin-scope-all-sees-both', '/api/v1/admin/atlas/knowledge-points?scope=all', `kp_ids=${kpA.id},${kpB.id}`);

  const adminAuthorA = await api(
    adminPage,
    'GET',
    `/api/v1/admin/atlas/knowledge-points?authorId=${authorA.id}&keyword=${encodeURIComponent(`Atlas multi-user`)}&limit=50`
  );
  const adminAuthorAHasA = adminAuthorA.some((kp) => kp.id === kpA.id);
  const adminAuthorAHasB = adminAuthorA.some((kp) => kp.id === kpB.id);
  if (!adminAuthorAHasA || adminAuthorAHasB) {
    throw new Error(`admin authorId filter mismatch; hasA=${adminAuthorAHasA} hasB=${adminAuthorAHasB}`);
  }
  pass('admin-author-filter-isolates', `/api/v1/admin/atlas/knowledge-points?authorId=${authorA.id}`, `only_author_a=true; kp_id=${kpA.id}`);

  await authorAContext.close();
  authorAContext = null;
  await authorBContext.close();
  authorBContext = null;
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
  if (adminContext && originalRolePermissions && roleID) {
    try {
      const restorePage = await adminContext.newPage();
      const restore = await rawApi(restorePage, 'PUT', `/api/v1/admin/roles/${roleID}/permissions`, {
        permissionCodes: originalRolePermissions,
      });
      await restorePage.close();
      if (!restore.ok || restore.json?.code !== 200) {
        throw new Error(`HTTP ${restore.status} code=${restore.json?.code ?? 'n/a'}`);
      }
    } catch (error) {
      console.error(`warning: failed to restore ${args.roleCode} role permissions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await authorAContext?.close();
  await authorBContext?.close();
  await adminContext?.close();
  await browser?.close();
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    console.error('missing playwright package; run with `npx --yes --package playwright node scripts/atlas/run-multiuser-smoke.mjs` or install Playwright in this workspace');
    console.error(error instanceof Error ? error.message : String(error));
    exit(2);
  }
}

async function newContext(browserInstance) {
  return browserInstance.newContext({
    baseURL: args.baseUrl,
    viewport: { width: 1440, height: 1000 },
  });
}

async function loginViaUI(page, username, password) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await gotoPath(page, '/admin/login');
      await page.locator('#username').waitFor({ state: 'visible', timeout: args.timeoutMs });
      await page.locator('#username').fill(username);
      await page.locator('#password').fill(password);
      await Promise.all([
        page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: args.timeoutMs }),
        page.locator('button[type="submit"]').click(),
      ]);
      await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), null, { timeout: args.timeoutMs });
      if (page.url().includes('/login')) {
        throw new Error(`login did not leave /admin/login for ${username}`);
      }
      return;
    } catch (error) {
      lastError = await describeVisitError(page, error);
      if (attempt < 2) await page.waitForTimeout(1000);
    }
  }
  throw lastError;
}

async function grantAtlasPermissions(page, roleCode) {
  const roles = await api(page, 'GET', '/api/v1/admin/roles');
  const role = roles.find((item) => item.code === roleCode);
  if (!role) throw new Error(`role not found: ${roleCode}`);

  const originalPermissionCodes = role.permissions.map((permission) => permission.code);
  const nextPermissionCodes = Array.from(new Set([...originalPermissionCodes, 'content.atlas.read', 'content.atlas.write']));
  await api(page, 'PUT', `/api/v1/admin/roles/${role.id}/permissions`, {
    permissionCodes: nextPermissionCodes,
  });
  return { role, originalPermissionCodes };
}

async function ensureSmokeUser(page, username, password, roleCode) {
  const users = await api(page, 'GET', `/api/v1/admin/users?search=${encodeURIComponent(username)}&pageNum=1&pageSize=20`);
  const existing = Array.isArray(users.list) ? users.list.find((user) => user.username === username) : null;
  if (existing) {
    await api(page, 'PUT', `/api/v1/admin/users/${existing.id}/roles`, { roleCodes: [roleCode] });
    await api(page, 'POST', `/api/v1/admin/users/${existing.id}/reset-password`, {
      password,
      mustChangePassword: false,
    });
    return existing;
  }
  return api(page, 'POST', '/api/v1/admin/users', {
    username,
    email: `${username}@aetherblog.local`,
    password,
    nickname: username,
    roleCodes: [roleCode],
    status: 'ACTIVE',
    mustChangePassword: false,
  });
}

async function visit(page, id, actualPath, expectedTexts) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await gotoPath(page, actualPath);
      const matched = await waitForAnyText(page, expectedTexts);
      if (new URL(page.url()).pathname.endsWith('/login')) {
        throw new Error(`redirected to login while visiting ${actualPath}`);
      }
      const retryEvidence = attempt > 1 ? `; attempt=${attempt}` : '';
      return pass(id, actualPath, `url=${pathOf(page.url())}; matched="${matched}"${retryEvidence}`);
    } catch (error) {
      lastError = await describeVisitError(page, error);
      if (attempt < 2) await page.waitForTimeout(1000);
    }
  }
  fail(id, actualPath, lastError);
  return null;
}

async function gotoPath(page, actualPath) {
  await page.goto(actualPath, { waitUntil: 'commit' });
  await page.locator('body').waitFor({ state: 'attached', timeout: args.timeoutMs });
}

async function waitForAnyText(page, expectedTexts) {
  const texts = Array.isArray(expectedTexts) ? expectedTexts.filter(Boolean) : [expectedTexts].filter(Boolean);
  await page.waitForFunction((needles) => {
    const body = document.body?.innerText || '';
    return needles.some((needle) => body.includes(needle));
  }, texts, { timeout: args.timeoutMs });
  const body = await page.locator('body').innerText({ timeout: args.timeoutMs });
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
    json = null;
  }
  return {
    ok: response.ok(),
    status: response.status(),
    text,
    json,
  };
}

async function installRuntimeObservers(page) {
  page.on('pageerror', (error) => {
    console.error(`pageerror: ${error.message}`);
  });
}

function writeReport() {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
}

function printSummary() {
  const passed = report.checks.filter((check) => check.status === 'passed').length;
  const failed = report.checks.filter((check) => check.status !== 'passed').length;
  console.log(`Atlas multi-user smoke: passed=${passed} failed=${failed} report=${args.out}`);
  console.log(`actors: author_a=${report.actors.authorA.username ?? 'n/a'} author_b=${report.actors.authorB.username ?? 'n/a'}`);
}

function parseArgs(raw) {
  const parsed = {
    baseUrl: process.env.ATLAS_SMOKE_BASE_URL || 'http://localhost:7899',
    adminUsername: process.env.ATLAS_SMOKE_USERNAME || 'admin',
    adminPassword: process.env.ATLAS_SMOKE_PASSWORD || '',
    authorPassword: process.env.ATLAS_MULTIUSER_PASSWORD || '',
    roleCode: process.env.ATLAS_MULTIUSER_ROLE || 'AUTHOR',
    out: process.env.ATLAS_MULTIUSER_REPORT || 'output/playwright/atlas-multiuser-smoke-report.json',
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
    } else if (key === '--admin-username') {
      parsed.adminUsername = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--admin-password') {
      parsed.adminPassword = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--author-password') {
      parsed.authorPassword = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--role-code') {
      parsed.roleCode = value;
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
  parsed.roleCode = parsed.roleCode.toUpperCase();
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
