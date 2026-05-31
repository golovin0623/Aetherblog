#!/usr/bin/env node
// Atlas R5 release-smoke report verifier.
//
// This intentionally does not automate login or mutate data. It verifies that a
// gateway/manual/Playwright smoke report covers the required surfaces and has no
// failed checks. Use --print-template to generate the expected JSON shape.

import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

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

if (args.printTemplate) {
  stdout.write(JSON.stringify(template(), null, 2) + '\n');
  exit(0);
}

if (!args.input) {
  console.error('missing --input <smoke-report.json>; use --print-template for the required report shape');
  exit(2);
}

const report = JSON.parse(readFileSync(args.input, 'utf8'));
const result = evaluate(report, Boolean(args.allowBlocked));

if (args.json) {
  stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  printReport(result);
}

if (!result.passed) {
  exit(1);
}

function template() {
  return {
    gatewayUrl: 'http://<host>:7899',
    runAt: new Date(0).toISOString(),
    checks: REQUIRED_CHECKS.map((check) => ({
      ...check,
      status: 'blocked',
      evidence: '',
      notes: '',
    })),
  };
}

function evaluate(report, allowBlocked) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const byID = new Map(checks.map((check) => [check.id, check]));
  const missing = [];
  const failed = [];
  const blocked = [];
  const passedChecks = [];

  for (const required of REQUIRED_CHECKS) {
    const check = byID.get(required.id);
    if (!check) {
      missing.push(required.id);
      continue;
    }
    if (check.status === 'passed') passedChecks.push(required.id);
    else if (check.status === 'blocked') blocked.push(required.id);
    else failed.push(required.id);
  }

  const failures = [];
  if (missing.length) failures.push(`missing required checks: ${missing.join(', ')}`);
  if (failed.length) failures.push(`failed checks: ${failed.join(', ')}`);
  if (blocked.length && !allowBlocked) failures.push(`blocked checks: ${blocked.join(', ')}`);

  return {
    gatewayUrl: report.gatewayUrl ?? '',
    runAt: report.runAt ?? '',
    required: REQUIRED_CHECKS.length,
    passedChecks: passedChecks.length,
    blockedChecks: blocked.length,
    failedChecks: failed.length,
    missingChecks: missing.length,
    allowBlocked,
    failures,
    passed: failures.length === 0,
  };
}

function printReport(result) {
  console.log('Atlas R5 Release Smoke Gate');
  console.log('===========================');
  console.log(`gateway_url=${result.gatewayUrl || 'n/a'}`);
  console.log(`run_at=${result.runAt || 'n/a'}`);
  console.log(`required=${result.required}`);
  console.log(`passed_checks=${result.passedChecks}`);
  console.log(`blocked_checks=${result.blockedChecks}`);
  console.log(`failed_checks=${result.failedChecks}`);
  console.log(`missing_checks=${result.missingChecks}`);
  console.log(`allow_blocked=${result.allowBlocked}`);
  console.log('');
  if (result.failures.length) {
    for (const failure of result.failures) console.log(`FAIL: ${failure}`);
  }
  console.log(result.passed ? 'PASS' : 'FAIL');
}

function parseArgs(raw) {
  const parsed = {};
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--input') parsed.input = raw[++i];
    else if (arg === '--allow-blocked') parsed.allowBlocked = true;
    else if (arg === '--print-template') parsed.printTemplate = true;
  }
  return parsed;
}
