#!/usr/bin/env node
// Atlas R3 live AI-quality gate.
//
// Seeds an isolated non-admin author through the gateway API, generates Atlas
// KP/relation suggestions through the server-go -> ai-service path, rejects any
// heuristic fallback output, then accepts/rejects final suggestions to measure
// the same quality contract as ai-quality-gate.mjs against a live system.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const KP_TYPES = new Set(['claim', 'concept', 'question', 'definition', 'method', 'example', 'person', 'source']);
const RELATION_TYPES = new Set([
  'supports',
  'refutes',
  'specializes',
  'generalizes',
  'precedes',
  'causes',
  'similar_to',
  'cites',
  'instance_of',
]);
const FINAL_STATUSES = new Set(['accepted', 'rejected', 'ignored', 'expired']);
const STUB_MODEL = 'atlas-stub/heuristic-v1';

const DEFAULT_THRESHOLDS = {
  minKpAcceptRate: 0.5,
  minRelationAcceptRate: 0.35,
  minSchemaValidRate: 1,
  minGroundedRate: 1,
};

const args = parseArgs(argv.slice(2));

if (!args.adminPassword) {
  console.error('missing admin smoke password; set ATLAS_SMOKE_PASSWORD or pass --admin-password <value>');
  exit(2);
}

const thresholds = {
  minKpAcceptRate: numberArg(args.minKpAcceptRate, DEFAULT_THRESHOLDS.minKpAcceptRate),
  minRelationAcceptRate: numberArg(args.minRelationAcceptRate, DEFAULT_THRESHOLDS.minRelationAcceptRate),
  minSchemaValidRate: numberArg(args.minSchemaValidRate, DEFAULT_THRESHOLDS.minSchemaValidRate),
  minGroundedRate: numberArg(args.minGroundedRate, DEFAULT_THRESHOLDS.minGroundedRate),
};

const stamp = compactTimestamp();
const authorPassword = args.authorPassword || `AtlasR3${stamp.slice(-6)}Aa`;
const report = {
  gatewayUrl: args.baseUrl,
  aiServiceUrl: args.aiBaseUrl,
  runAt: new Date().toISOString(),
  thresholds,
  modelId: args.modelId || null,
  actor: {},
  seeded: {},
  suggestions: [],
  metrics: null,
  checks: [],
  passed: false,
};

let adminSession;
let authorSession;
let originalRolePermissions;
let roleID;
const generatedSuggestionIds = [];

try {
  adminSession = await login(args.adminUsername, args.adminPassword);
  pass('admin-login', '/api/v1/auth/login', `admin=${args.adminUsername}`);

  const taskReadiness = await inspectAtlasTaskReadiness(adminSession);
  report.taskReadiness = taskReadiness;
  assertTaskReadiness(taskReadiness, Boolean(args.modelId));
  pass(
    'atlas-ai-task-readiness',
    '/api/v1/admin/ai/tasks + /api/v1/admin/providers/routing/atlas_*',
    readinessSummary(taskReadiness)
  );

  const permissionSetup = await grantAtlasPermissions(adminSession, args.roleCode);
  originalRolePermissions = permissionSetup.originalPermissionCodes;
  roleID = permissionSetup.role.id;
  pass(
    'role-permission-setup',
    `/api/v1/admin/roles/${roleID}/permissions`,
    `role=${args.roleCode}; ensured=content.atlas.read,content.atlas.write`
  );

  const author = await ensureSmokeUser(adminSession, `atlas_r3_author_${stamp}`, authorPassword, args.roleCode);
  authorSession = await login(author.username, authorPassword);
  report.actor = { id: author.id, username: author.username, role: args.roleCode };
  pass('author-login', '/api/v1/auth/login', `author=${author.username}; id=${author.id}`);

  const seeded = await seedCarrierAndAnnotations(authorSession, stamp);
  report.seeded = summarizeSeeded(seeded);
  pass(
    'seed-r3-source-dataset',
    '/api/v1/admin/atlas',
    `note=${seeded.note.id}; carrier=${seeded.carrier.id}; annotations=${seeded.annotations.map((item) => item.id).join(',')}`
  );

  const kpSuggestions = await generateKpSuggestions(authorSession, seeded.annotations);
  generatedSuggestionIds.push(...kpSuggestions.map((suggestion) => suggestion.id));
  assertNonStubSuggestions(kpSuggestions, 'kp');
  pass(
    'generate-real-kp-suggestions',
    '/api/v1/admin/atlas/annotations/:id/suggestions',
    `count=${kpSuggestions.length}; models=${modelSet(kpSuggestions)}`
  );

  const resolvedKps = await resolveKpSuggestions(authorSession, kpSuggestions);
  if (resolvedKps.accepted.length < 2) {
    throw new Error(`R3 live gate requires at least 2 accepted KP suggestions, got ${resolvedKps.accepted.length}`);
  }
  pass(
    'resolve-kp-suggestions',
    '/api/v1/admin/atlas/suggestions/:id/(accept|reject)',
    `accepted=${resolvedKps.accepted.length}; rejected=${resolvedKps.rejected.length}`
  );

  const relationSuggestions = await generateRelationSuggestions(authorSession, resolvedKps.accepted);
  generatedSuggestionIds.push(...relationSuggestions.map((suggestion) => suggestion.id));
  assertNonStubSuggestions(relationSuggestions, 'relation');
  pass(
    'generate-real-relation-suggestions',
    '/api/v1/admin/atlas/knowledge-points/:id/relation-suggestions',
    `count=${relationSuggestions.length}; models=${modelSet(relationSuggestions)}`
  );

  const resolvedRelations = await resolveRelationSuggestions(authorSession, relationSuggestions);
  pass(
    'resolve-relation-suggestions',
    '/api/v1/admin/atlas/suggestions/:id/(accept|reject)',
    `accepted=${resolvedRelations.accepted.length}; rejected=${resolvedRelations.rejected.length}`
  );

  report.suggestions = [
    ...resolvedKps.accepted,
    ...resolvedKps.rejected,
    ...resolvedRelations.accepted,
    ...resolvedRelations.rejected,
  ].map(normalizeSuggestionForQualityGate);

  const quality = evaluate(report.suggestions, thresholds);
  report.metrics = quality.metrics;
  if (!quality.passed) {
    throw new Error(`live R3 quality failed: ${quality.failures.join('; ')}`);
  }
  pass(
    'live-ai-quality-thresholds',
    'scripts/atlas/ai-quality-gate.mjs contract',
    `kp_accept=${pct(quality.metrics.kpAcceptRate)} relation_accept=${pct(quality.metrics.relationAcceptRate)} schema=${pct(quality.metrics.schemaValidRate)} grounded=${pct(quality.metrics.groundedRate)}`
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
  if (authorSession && generatedSuggestionIds.length) {
    await rejectPendingSuggestions(authorSession, generatedSuggestionIds);
  }
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

async function rejectPendingSuggestions(session, suggestionIds) {
  for (const id of suggestionIds) {
    try {
      await api(session, 'POST', `/api/v1/admin/atlas/suggestions/${id}/reject`);
    } catch {
      // Suggestions already accepted/rejected by the gate are intentionally ignored.
    }
  }
}

async function inspectAtlasTaskReadiness(session) {
  const tasks = await aiApi(session, 'GET', '/api/v1/admin/ai/tasks');
  const taskCodes = new Set((Array.isArray(tasks) ? tasks : []).map((task) => task.code));
  const claimsRouting = await aiApi(session, 'GET', '/api/v1/admin/providers/routing/atlas_claims');
  const relationsRouting = await aiApi(session, 'GET', '/api/v1/admin/providers/routing/atlas_relations');
  return {
    taskTypes: {
      atlasClaims: taskCodes.has('atlas_claims'),
      atlasRelations: taskCodes.has('atlas_relations'),
    },
    routing: {
      atlasClaims: summarizeRouting(claimsRouting),
      atlasRelations: summarizeRouting(relationsRouting),
    },
  };
}

function assertTaskReadiness(readiness, hasExplicitModel) {
  const failures = [];
  if (!readiness.taskTypes.atlasClaims) failures.push('missing ai_task_types row: atlas_claims');
  if (!readiness.taskTypes.atlasRelations) failures.push('missing ai_task_types row: atlas_relations');
  if (!hasExplicitModel && !readiness.routing.atlasClaims.configured) failures.push('missing routing: atlas_claims');
  if (!hasExplicitModel && !readiness.routing.atlasRelations.configured) failures.push('missing routing: atlas_relations');
  if (!hasExplicitModel && readiness.routing.atlasClaims.configured && !readiness.routing.atlasClaims.credentialConfigured) {
    failures.push('atlas_claims routing has no usable credential');
  }
  if (!hasExplicitModel && readiness.routing.atlasRelations.configured && !readiness.routing.atlasRelations.credentialConfigured) {
    failures.push('atlas_relations routing has no usable credential');
  }
  if (failures.length) {
    throw new Error(`${failures.join('; ')}; run migrations and configure Atlas AI routing or pass --model-id for an explicit live model probe`);
  }
}

function readinessSummary(readiness) {
  return [
    `tasks=claims:${readiness.taskTypes.atlasClaims},relations:${readiness.taskTypes.atlasRelations}`,
    `routing=claims:${readiness.routing.atlasClaims.configured ? readiness.routing.atlasClaims.primaryModelId : 'missing'}`,
    `relations:${readiness.routing.atlasRelations.configured ? readiness.routing.atlasRelations.primaryModelId : 'missing'}`,
  ].join('; ');
}

function summarizeRouting(raw) {
  if (!raw) return { configured: false };
  const primaryModel = raw.primaryModel || raw.primary_model || null;
  const fallbackModel = raw.fallbackModel || raw.fallback_model || null;
  return {
    configured: Boolean(raw.primaryModelId ?? raw.primary_model_id ?? primaryModel?.id),
    primaryModelId: primaryModel?.modelId || primaryModel?.model_id || raw.primaryModelId || raw.primary_model_id || null,
    fallbackModelId: fallbackModel?.modelId || fallbackModel?.model_id || raw.fallbackModelId || raw.fallback_model_id || null,
    credentialConfigured: Boolean(raw.credentialConfigured ?? raw.credential_configured ?? raw.credentialId ?? raw.credential_id),
  };
}

async function seedCarrierAndAnnotations(session, suffix) {
  const anchors = [
    `Atlas R3 grounded extraction keeps annotation evidence separate from knowledge points ${suffix}`,
    `Atlas R3 relation suggestions must explain how two accepted knowledge points connect ${suffix}`,
  ];
  const contentMarkdown = [
    `# Atlas R3 Live Dataset ${suffix}`,
    '',
    `${anchors[0]}. This sentence should become a concise claim candidate with explicit evidence.`,
    '',
    `${anchors[1]}. This sentence should become a typed relation candidate after users accept the related knowledge points.`,
    '',
    'The live gate rejects heuristic fallback output and only accepts model-backed suggestions.',
  ].join('\n');

  const note = await api(session, 'POST', '/api/v1/admin/atlas/carriers/markdown/source', {
    title: `Atlas R3 Live Dataset ${suffix}`,
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
        bodyMeta: { source: 'run-ai-quality-live-gate' },
        anchorState: 'anchored',
        anchorScore: 1,
      })
    );
  }
  return { note, carrier, annotations };
}

async function generateKpSuggestions(session, annotations) {
  const suggestions = [];
  for (const annotation of annotations) {
    const payload = { maxCandidates: args.kpCandidates };
    if (args.modelId) payload.modelId = args.modelId;
    const generated = await api(session, 'POST', `/api/v1/admin/atlas/annotations/${annotation.id}/suggestions`, payload);
    suggestions.push(...generated);
  }
  if (!suggestions.length) throw new Error('no KP suggestions generated');
  return suggestions;
}

async function resolveKpSuggestions(session, suggestions) {
  const accepted = [];
  const rejected = [];
  for (const suggestion of suggestions) {
    if (accepted.length < 2) {
      accepted.push(await api(session, 'POST', `/api/v1/admin/atlas/suggestions/${suggestion.id}/accept`));
    } else {
      rejected.push(await api(session, 'POST', `/api/v1/admin/atlas/suggestions/${suggestion.id}/reject`));
    }
  }
  return { accepted, rejected };
}

async function generateRelationSuggestions(session, acceptedKpSuggestions) {
  const kpIds = acceptedKpSuggestions.map((suggestion) => suggestion.resolvedKpId).filter(Boolean);
  if (kpIds.length < 2) throw new Error(`need at least 2 resolved KP ids, got ${kpIds.length}`);
  const payload = { toKpId: kpIds[1] };
  if (args.modelId) payload.modelId = args.modelId;
  const first = await api(session, 'POST', `/api/v1/admin/atlas/knowledge-points/${kpIds[0]}/relation-suggestions`, payload);

  const secondPayload = { toKpId: kpIds[0] };
  if (args.modelId) secondPayload.modelId = args.modelId;
  const second = await api(session, 'POST', `/api/v1/admin/atlas/knowledge-points/${kpIds[1]}/relation-suggestions`, secondPayload);
  return [first, second];
}

async function resolveRelationSuggestions(session, suggestions) {
  const accepted = [];
  const rejected = [];
  for (let index = 0; index < suggestions.length; index += 1) {
    const suggestion = suggestions[index];
    if (index === 0) {
      accepted.push(await api(session, 'POST', `/api/v1/admin/atlas/suggestions/${suggestion.id}/accept`));
    } else {
      rejected.push(await api(session, 'POST', `/api/v1/admin/atlas/suggestions/${suggestion.id}/reject`));
    }
  }
  return { accepted, rejected };
}

function assertNonStubSuggestions(suggestions, expectedKind) {
  const failures = [];
  for (const suggestion of suggestions) {
    if (suggestion.kind !== expectedKind) failures.push(`suggestion ${suggestion.id} kind=${suggestion.kind}, expected ${expectedKind}`);
    if (!suggestion.modelId) failures.push(`suggestion ${suggestion.id} missing modelId`);
    if (suggestion.modelId === STUB_MODEL || String(suggestion.modelId).startsWith('atlas-stub/')) {
      failures.push(`suggestion ${suggestion.id} used heuristic fallback model ${suggestion.modelId}`);
    }
    if (Number(suggestion.tokensIn || 0) <= 0) failures.push(`suggestion ${suggestion.id} missing tokensIn`);
    if (Number(suggestion.tokensOut || 0) <= 0) failures.push(`suggestion ${suggestion.id} missing tokensOut`);
  }
  if (failures.length) {
    throw new Error(failures.join('; '));
  }
}

function normalizeSuggestionForQualityGate(suggestion) {
  return {
    id: suggestion.id,
    kind: suggestion.kind,
    status: suggestion.status,
    carrierId: suggestion.carrierId,
    annotationId: suggestion.annotationId,
    fromKpId: suggestion.fromKpId,
    toKpId: suggestion.toKpId,
    proposedTitle: suggestion.proposedTitle,
    proposedKpType: suggestion.proposedKpType,
    proposedRelationType: suggestion.proposedRelationType,
    modelId: suggestion.modelId,
    tokensIn: suggestion.tokensIn,
    tokensOut: suggestion.tokensOut,
    costUsd: suggestion.costUsd,
  };
}

function evaluate(suggestions, limits) {
  const finalSuggestions = suggestions.filter((suggestion) => FINAL_STATUSES.has(suggestion.status));
  const kpSuggestions = finalSuggestions.filter((suggestion) => suggestion.kind === 'kp');
  const relationSuggestions = finalSuggestions.filter((suggestion) => suggestion.kind === 'relation');
  const schemaValidSuggestions = finalSuggestions.filter(isSchemaValid);
  const groundedSuggestions = finalSuggestions.filter(isGrounded);
  const nonStubSuggestions = finalSuggestions.filter((suggestion) => suggestion.modelId && !String(suggestion.modelId).startsWith('atlas-stub/'));
  const tokenedSuggestions = finalSuggestions.filter((suggestion) => Number(suggestion.tokensIn || 0) > 0 && Number(suggestion.tokensOut || 0) > 0);

  const metrics = {
    finalSuggestions: finalSuggestions.length,
    kpGenerated: kpSuggestions.length,
    kpAccepted: kpSuggestions.filter((suggestion) => suggestion.status === 'accepted').length,
    relationGenerated: relationSuggestions.length,
    relationAccepted: relationSuggestions.filter((suggestion) => suggestion.status === 'accepted').length,
    schemaValidRate: ratio(schemaValidSuggestions.length, finalSuggestions.length),
    groundedRate: ratio(groundedSuggestions.length, finalSuggestions.length),
    nonStubRate: ratio(nonStubSuggestions.length, finalSuggestions.length),
    tokenCoverage: ratio(tokenedSuggestions.length, finalSuggestions.length),
  };
  metrics.kpAcceptRate = ratio(metrics.kpAccepted, metrics.kpGenerated);
  metrics.relationAcceptRate = ratio(metrics.relationAccepted, metrics.relationGenerated);

  const failures = [];
  if (metrics.finalSuggestions === 0) failures.push('final suggestion count is zero');
  if (metrics.kpGenerated === 0) failures.push('final KP suggestion count is zero');
  if (metrics.relationGenerated === 0) failures.push('final relation suggestion count is zero');
  if (metrics.kpAcceptRate < limits.minKpAcceptRate) failures.push(`KP accept rate ${pct(metrics.kpAcceptRate)} < ${pct(limits.minKpAcceptRate)}`);
  if (metrics.relationAcceptRate < limits.minRelationAcceptRate) {
    failures.push(`relation accept rate ${pct(metrics.relationAcceptRate)} < ${pct(limits.minRelationAcceptRate)}`);
  }
  if (metrics.schemaValidRate < limits.minSchemaValidRate) failures.push(`schema valid rate ${pct(metrics.schemaValidRate)} < ${pct(limits.minSchemaValidRate)}`);
  if (metrics.groundedRate < limits.minGroundedRate) failures.push(`grounded rate ${pct(metrics.groundedRate)} < ${pct(limits.minGroundedRate)}`);
  if (metrics.nonStubRate < 1) failures.push(`non-stub rate ${pct(metrics.nonStubRate)} < 100.00%`);
  if (metrics.tokenCoverage < 1) failures.push(`token coverage ${pct(metrics.tokenCoverage)} < 100.00%`);
  return { metrics, failures, passed: failures.length === 0 };
}

function isSchemaValid(suggestion) {
  if (suggestion.kind === 'kp') {
    return Boolean(suggestion.proposedTitle) && KP_TYPES.has(suggestion.proposedKpType);
  }
  if (suggestion.kind === 'relation') {
    return (
      Number.isFinite(Number(suggestion.fromKpId)) &&
      Number.isFinite(Number(suggestion.toKpId)) &&
      Number(suggestion.fromKpId) !== Number(suggestion.toKpId) &&
      RELATION_TYPES.has(suggestion.proposedRelationType)
    );
  }
  return false;
}

function isGrounded(suggestion) {
  if (suggestion.kind === 'kp') {
    return Number.isFinite(Number(suggestion.annotationId)) || Number.isFinite(Number(suggestion.carrierId));
  }
  if (suggestion.kind === 'relation') {
    return Number.isFinite(Number(suggestion.fromKpId)) && Number.isFinite(Number(suggestion.toKpId));
  }
  return false;
}

async function login(username, password) {
  const result = await rawRequest(args.baseUrl, null, 'POST', '/api/v1/auth/login', { username, password });
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
  const result = await rawRequest(args.baseUrl, session, method, path, data);
  if (!result.ok || result.json?.code !== 200) {
    throw new Error(`${method} ${path} failed HTTP ${result.status} code=${result.json?.code ?? 'n/a'} message=${result.json?.message ?? result.text.slice(0, 160)}`);
  }
  return result.json.data;
}

async function aiApi(session, method, path, data) {
  const result = await rawRequest(args.aiBaseUrl, session, method, path, data);
  if (!result.ok || result.json?.code !== 200) {
    throw new Error(`${method} ${path} failed HTTP ${result.status} code=${result.json?.code ?? 'n/a'} message=${result.json?.message ?? result.text.slice(0, 160)}`);
  }
  return result.json.data;
}

async function rawRequest(baseUrl, session, method, path, data) {
  const headers = { accept: 'application/json' };
  if (data !== undefined) headers['content-type'] = 'application/json';
  if (session?.token) headers.authorization = `Bearer ${session.token}`;

  const response = await fetch(joinUrl(baseUrl, path), {
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
  };
}

function modelSet(suggestions) {
  return Array.from(new Set(suggestions.map((suggestion) => suggestion.modelId || 'missing'))).join(',');
}

function writeReport() {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
}

function printSummary() {
  const passed = report.checks.filter((check) => check.status === 'passed').length;
  const failed = report.checks.filter((check) => check.status !== 'passed').length;
  console.log(`Atlas R3 live AI-quality gate: passed=${passed} failed=${failed} report=${args.out}`);
  console.log(
    `metrics: final=${report.metrics?.finalSuggestions ?? 'n/a'} ` +
      `kp_accept=${pct(report.metrics?.kpAcceptRate ?? 0)} relation_accept=${pct(report.metrics?.relationAcceptRate ?? 0)} ` +
      `schema=${pct(report.metrics?.schemaValidRate ?? 0)} grounded=${pct(report.metrics?.groundedRate ?? 0)} ` +
      `non_stub=${pct(report.metrics?.nonStubRate ?? 0)} token_coverage=${pct(report.metrics?.tokenCoverage ?? 0)}`
  );
}

function parseArgs(raw) {
  const parsed = {
    baseUrl: process.env.ATLAS_SMOKE_BASE_URL || 'http://localhost:7899',
    aiBaseUrl: process.env.ATLAS_AI_BASE_URL || 'http://localhost:8000',
    adminUsername: process.env.ATLAS_SMOKE_USERNAME || 'admin',
    adminPassword: process.env.ATLAS_SMOKE_PASSWORD || '',
    authorPassword: process.env.ATLAS_R3_AUTHOR_PASSWORD || '',
    roleCode: process.env.ATLAS_R3_ROLE || 'AUTHOR',
    modelId: process.env.ATLAS_R3_MODEL_ID || '',
    kpCandidates: Number(process.env.ATLAS_R3_KP_CANDIDATES || 2),
    out: process.env.ATLAS_R3_LIVE_REPORT || 'output/playwright/atlas-r3-live-ai-quality-report.json',
  };

  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    const [key, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = inlineValue ?? raw[i + 1];
    if (key === '--base-url') {
      parsed.baseUrl = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--ai-base-url') {
      parsed.aiBaseUrl = value;
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
    } else if (key === '--model-id') {
      parsed.modelId = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--kp-candidates') {
      parsed.kpCandidates = Number(value);
      if (inlineValue === undefined) i += 1;
    } else if (key === '--out') {
      parsed.out = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-kp-accept') {
      parsed.minKpAcceptRate = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-relation-accept') {
      parsed.minRelationAcceptRate = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-schema-valid') {
      parsed.minSchemaValidRate = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--min-grounded') {
      parsed.minGroundedRate = value;
      if (inlineValue === undefined) i += 1;
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  parsed.aiBaseUrl = parsed.aiBaseUrl.replace(/\/+$/, '');
  parsed.roleCode = parsed.roleCode.toUpperCase();
  if (!Number.isFinite(parsed.kpCandidates) || parsed.kpCandidates < 1) parsed.kpCandidates = 2;
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric argument: ${value}`);
  return parsed;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function pct(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}
