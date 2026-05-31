#!/usr/bin/env node
// Atlas R2 live relation-health gate.
//
// Seeds an isolated non-admin author through the gateway API, creates an
// evidence-backed graph dataset, then verifies live /atlas/graph/health metrics.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const DEFAULT_THRESHOLDS = {
  minDensity: 2,
  minKpEvidenceCoverage: 0.9,
  minRelationEvidenceCoverage: 0.7,
  maxOrphanRatio: 0.35,
};

const args = parseArgs(argv.slice(2));

if (!args.adminPassword) {
  console.error('missing admin smoke password; set ATLAS_SMOKE_PASSWORD or pass --admin-password <value>');
  exit(2);
}

const thresholds = {
  minDensity: numberArg(args.minDensity, DEFAULT_THRESHOLDS.minDensity),
  minKpEvidenceCoverage: numberArg(args.minKpEvidence, DEFAULT_THRESHOLDS.minKpEvidenceCoverage),
  minRelationEvidenceCoverage: numberArg(args.minRelationEvidence, DEFAULT_THRESHOLDS.minRelationEvidenceCoverage),
  maxOrphanRatio: numberArg(args.maxOrphanRatio, DEFAULT_THRESHOLDS.maxOrphanRatio),
};

const runAt = new Date().toISOString();
const stamp = compactTimestamp();
const authorPassword = args.authorPassword || `AtlasR2${stamp.slice(-6)}Aa`;
const report = {
  gatewayUrl: args.baseUrl,
  runAt,
  thresholds,
  actor: {},
  seeded: {},
  metrics: null,
  checks: [],
  passed: false,
};

let adminSession;
let originalRolePermissions;
let roleID;

try {
  adminSession = await login(args.adminUsername, args.adminPassword);
  pass('admin-login', '/api/v1/auth/login', `admin=${args.adminUsername}`);

  const permissionSetup = await grantAtlasPermissions(adminSession, args.roleCode);
  originalRolePermissions = permissionSetup.originalPermissionCodes;
  roleID = permissionSetup.role.id;
  pass(
    'role-permission-setup',
    `/api/v1/admin/roles/${roleID}/permissions`,
    `role=${args.roleCode}; ensured=content.atlas.read,content.atlas.write`
  );

  const author = await ensureSmokeUser(adminSession, `atlas_r2_author_${stamp}`, authorPassword, args.roleCode);
  const authorSession = await login(author.username, authorPassword);
  report.actor = { id: author.id, username: author.username, role: args.roleCode };
  pass('author-login', '/api/v1/auth/login', `author=${author.username}; id=${author.id}`);

  const seeded = await seedRelationDataset(authorSession, stamp);
  report.seeded = summarizeSeeded(seeded);
  pass(
    'seed-relation-dataset',
    '/api/v1/admin/atlas',
    `note=${seeded.note.id}; carrier=${seeded.carrier.id}; annotations=${seeded.annotations.length}; kps=${seeded.kps.length}; relations=${seeded.relations.length}`
  );

  const graphHealth = await api(authorSession, 'GET', '/api/v1/admin/atlas/graph/health?scope=mine&hubLimit=5');
  report.metrics = graphHealth;
  assertGraphHealth(graphHealth, thresholds);
  pass(
    'live-graph-health-thresholds',
    '/api/v1/admin/atlas/graph/health?scope=mine&hubLimit=5',
    `active_kps=${graphHealth.activeKpCount}; relations=${graphHealth.relationCount}; density=${fmt(graphHealth.relationDensity)}; kp_evidence=${pct(graphHealth.kpEvidenceCoverage)}; relation_evidence=${pct(graphHealth.relationEvidenceCoverage)}; orphan=${pct(graphHealth.orphanKpRatio)}`
  );

  report.passed = true;
  writeReport();
  printSummary();
} catch (error) {
  fail('runner', '', error);
  writeReport();
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
} finally {
  if (adminSession && originalRolePermissions && roleID) {
    try {
      await api(adminSession, 'PUT', `/api/v1/admin/roles/${roleID}/permissions`, {
        permissionCodes: originalRolePermissions,
      });
    } catch (error) {
      console.error(`warning: failed to restore ${args.roleCode} role permissions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function seedRelationDataset(session, suffix) {
  const anchors = [
    `R2 anchor evidence model ${suffix}`,
    `R2 anchor relation density ${suffix}`,
    `R2 anchor graph review ${suffix}`,
    `R2 anchor scoped author dataset ${suffix}`,
    `R2 anchor release threshold ${suffix}`,
  ];
  const contentMarkdown = [
    `# Atlas R2 Live Dataset ${suffix}`,
    '',
    ...anchors.map((anchor, index) => `${index + 1}. ${anchor} proves a live evidence-backed relation-health path.`),
    '',
    'The dataset is created by the R2 live gate and isolated to one temporary author.',
  ].join('\n');

  const note = await api(session, 'POST', '/api/v1/admin/atlas/carriers/markdown/source', {
    title: `Atlas R2 Live Dataset ${suffix}`,
    contentMarkdown,
  });
  const carrier = await api(session, 'POST', '/api/v1/admin/atlas/carriers/markdown', { noteId: note.id });

  const annotations = [];
  for (const anchor of anchors) {
    const start = contentMarkdown.indexOf(anchor);
    const end = start + anchor.length;
    annotations.push(
      await api(session, 'POST', '/api/v1/admin/atlas/annotations', {
        carrierId: carrier.id,
        selectors: [
          {
            type: 'TextQuoteSelector',
            exact: anchor,
            prefix: contentMarkdown.slice(Math.max(0, start - 30), start),
            suffix: contentMarkdown.slice(end, Math.min(contentMarkdown.length, end + 30)),
          },
          { type: 'TextPositionSelector', start, end },
          { type: 'CssSelector', value: 'article' },
        ],
        bodyType: 'highlight',
        bodyText: `Evidence for ${anchor}`,
        bodyMeta: { source: 'run-relation-health-live-gate' },
        anchorState: 'anchored',
        anchorScore: 1,
      })
    );
  }

  const kpTypes = ['claim', 'concept', 'method', 'example', 'definition'];
  const kps = [];
  for (let index = 0; index < anchors.length; index += 1) {
    kps.push(
      await api(session, 'POST', '/api/v1/admin/atlas/knowledge-points', {
        title: `R2 Live KP ${index + 1} ${suffix}`,
        bodyMarkdown: `Evidence-backed live KP for ${anchors[index]}.`,
        type: kpTypes[index],
        status: 'seed',
        provenance: 'user',
        confidence: 0.9,
        evidenceAnnotationIds: [annotations[index].id],
      })
    );
  }

  const relationSpecs = [
    [0, 1, 'supports'],
    [1, 2, 'specializes'],
    [2, 3, 'causes'],
    [3, 4, 'precedes'],
    [4, 0, 'cites'],
    [0, 2, 'generalizes'],
    [2, 4, 'instance_of'],
    [1, 3, 'similar_to'],
    [3, 0, 'refutes'],
    [4, 1, 'supports'],
  ];
  const relations = [];
  for (let index = 0; index < relationSpecs.length; index += 1) {
    const [from, to, type] = relationSpecs[index];
    relations.push(
      await api(session, 'POST', '/api/v1/admin/atlas/relations', {
        fromKpId: kps[from].id,
        toKpId: kps[to].id,
        type,
        strength: 0.82,
        bodyMarkdown: `R2 live relation ${index + 1} has explicit evidence and rationale.`,
        provenance: 'user',
        evidenceAnnotationIds: [annotations[index % annotations.length].id],
      })
    );
  }

  return { note, carrier, annotations, kps, relations };
}

function assertGraphHealth(metrics, limits) {
  const failures = [];
  if (Number(metrics.activeKpCount) < 5) failures.push(`active KP count ${metrics.activeKpCount} < 5`);
  if (Number(metrics.relationCount) < 10) failures.push(`relation count ${metrics.relationCount} < 10`);
  if (Number(metrics.relationDensity) < limits.minDensity) {
    failures.push(`relation density ${fmt(metrics.relationDensity)} < ${fmt(limits.minDensity)}`);
  }
  if (Number(metrics.kpEvidenceCoverage) < limits.minKpEvidenceCoverage) {
    failures.push(`KP evidence coverage ${pct(metrics.kpEvidenceCoverage)} < ${pct(limits.minKpEvidenceCoverage)}`);
  }
  if (Number(metrics.relationEvidenceCoverage) < limits.minRelationEvidenceCoverage) {
    failures.push(`relation evidence coverage ${pct(metrics.relationEvidenceCoverage)} < ${pct(limits.minRelationEvidenceCoverage)}`);
  }
  if (Number(metrics.orphanKpRatio) > limits.maxOrphanRatio) {
    failures.push(`orphan KP ratio ${pct(metrics.orphanKpRatio)} > ${pct(limits.maxOrphanRatio)}`);
  }
  if (failures.length) {
    throw new Error(`live R2 graph health failed: ${failures.join('; ')}`);
  }
}

async function login(username, password) {
  const result = await rawRequest(null, 'POST', '/api/v1/auth/login', { username, password });
  if (!result.ok || result.json?.code !== 200) {
    throw new Error(`login failed for ${username}: HTTP ${result.status} code=${result.json?.code ?? 'n/a'} message=${result.json?.message ?? result.text.slice(0, 160)}`);
  }
  return { token: result.json.data.accessToken, user: result.json.data.userInfo };
}

async function grantAtlasPermissions(session, roleCode) {
  const roles = await api(session, 'GET', '/api/v1/admin/roles');
  const role = roles.find((item) => item.code === roleCode);
  if (!role) throw new Error(`role not found: ${roleCode}`);

  const originalPermissionCodes = role.permissions.map((permission) => permission.code);
  const nextPermissionCodes = Array.from(new Set([...originalPermissionCodes, 'content.atlas.read', 'content.atlas.write']));
  await api(session, 'PUT', `/api/v1/admin/roles/${role.id}/permissions`, {
    permissionCodes: nextPermissionCodes,
  });
  return { role, originalPermissionCodes };
}

async function ensureSmokeUser(session, username, password, roleCode) {
  const users = await api(session, 'GET', `/api/v1/admin/users?search=${encodeURIComponent(username)}&pageNum=1&pageSize=20`);
  const existing = Array.isArray(users.list) ? users.list.find((user) => user.username === username) : null;
  if (existing) {
    await api(session, 'PUT', `/api/v1/admin/users/${existing.id}/roles`, { roleCodes: [roleCode] });
    await api(session, 'POST', `/api/v1/admin/users/${existing.id}/reset-password`, {
      password,
      mustChangePassword: false,
    });
    return existing;
  }
  return api(session, 'POST', '/api/v1/admin/users', {
    username,
    email: `${username}@aetherblog.local`,
    password,
    nickname: username,
    roleCodes: [roleCode],
    status: 'ACTIVE',
    mustChangePassword: false,
  });
}

async function api(session, method, path, data) {
  const result = await rawRequest(session, method, path, data);
  if (!result.ok || result.json?.code !== 200) {
    throw new Error(`${method} ${path} failed HTTP ${result.status} code=${result.json?.code ?? 'n/a'} message=${result.json?.message ?? result.text.slice(0, 160)}`);
  }
  return result.json.data;
}

async function rawRequest(session, method, path, data) {
  const headers = { accept: 'application/json' };
  if (data !== undefined) headers['content-type'] = 'application/json';
  if (session?.token) headers.authorization = `Bearer ${session.token}`;

  const response = await fetch(joinUrl(args.baseUrl, path), {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, text, json };
}

function pass(id, path, evidence) {
  report.checks.push({ id, path, status: 'passed', evidence, notes: '' });
}

function fail(id, path, error) {
  report.checks.push({
    id,
    path,
    status: 'failed',
    evidence: '',
    notes: error instanceof Error ? error.message : String(error),
  });
}

function summarizeSeeded(seeded) {
  return {
    noteId: seeded.note.id,
    carrierId: seeded.carrier.id,
    annotationIds: seeded.annotations.map((annotation) => annotation.id),
    kpIds: seeded.kps.map((kp) => kp.id),
    relationIds: seeded.relations.map((relation) => relation.id),
  };
}

function writeReport() {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
}

function printSummary() {
  const passed = report.checks.filter((check) => check.status === 'passed').length;
  const failed = report.checks.filter((check) => check.status !== 'passed').length;
  console.log(`Atlas R2 live relation-health gate: passed=${passed} failed=${failed} report=${args.out}`);
  console.log(
    `metrics: active_kps=${report.metrics?.activeKpCount ?? 'n/a'} relations=${report.metrics?.relationCount ?? 'n/a'} ` +
      `density=${fmt(report.metrics?.relationDensity ?? 0)} kp_evidence=${pct(report.metrics?.kpEvidenceCoverage ?? 0)} ` +
      `relation_evidence=${pct(report.metrics?.relationEvidenceCoverage ?? 0)} orphan=${pct(report.metrics?.orphanKpRatio ?? 0)}`
  );
}

function parseArgs(raw) {
  const parsed = {
    baseUrl: process.env.ATLAS_SMOKE_BASE_URL || 'http://localhost:7899',
    adminUsername: process.env.ATLAS_SMOKE_USERNAME || 'admin',
    adminPassword: process.env.ATLAS_SMOKE_PASSWORD || '',
    authorPassword: process.env.ATLAS_R2_AUTHOR_PASSWORD || '',
    roleCode: process.env.ATLAS_R2_ROLE || 'AUTHOR',
    out: process.env.ATLAS_R2_LIVE_REPORT || 'output/playwright/atlas-r2-live-relation-health-report.json',
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
    } else if (key === '--min-density') {
      parsed.minDensity = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-kp-evidence') {
      parsed.minKpEvidence = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-relation-evidence') {
      parsed.minRelationEvidence = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--max-orphan-ratio') {
      parsed.maxOrphanRatio = value;
      if (inlineValue === undefined) i += 1;
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  parsed.roleCode = parsed.roleCode.toUpperCase();
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric argument: ${value}`);
  return parsed;
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function fmt(value) {
  return Number(value).toFixed(2);
}

function pct(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}
