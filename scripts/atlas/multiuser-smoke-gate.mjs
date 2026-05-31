#!/usr/bin/env node
// Atlas multi-user smoke report verifier.
//
// This verifies that a gateway/browser smoke report covers the non-admin Atlas
// RBAC/scope checks required before claiming the multi-user gate has evidence.

import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const REQUIRED_CHECKS = [
  { id: 'admin-login', surface: 'Admin', path: '/admin/login' },
  { id: 'role-permission-setup', surface: 'Access Control', path: '/api/v1/admin/roles/<roleId>/permissions' },
  { id: 'author-a-login', surface: 'Non-admin Author A', path: '/admin/login' },
  { id: 'author-b-login', surface: 'Non-admin Author B', path: '/admin/login' },
  { id: 'author-a-dashboard', surface: 'Non-admin Author A', path: '/admin/atlas' },
  { id: 'author-b-dashboard', surface: 'Non-admin Author B', path: '/admin/atlas' },
  { id: 'author-a-create-kp', surface: 'Non-admin Author A', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-create-kp', surface: 'Non-admin Author B', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-cannot-see-author-a', surface: 'Non-admin Isolation', path: '/api/v1/admin/atlas/knowledge-points' },
  { id: 'author-b-author-switch-denied', surface: 'Non-admin Isolation', path: '/api/v1/admin/atlas/knowledge-points?authorId=<authorAId>' },
  { id: 'admin-scope-all-sees-both', surface: 'Admin Scope', path: '/api/v1/admin/atlas/knowledge-points?scope=all' },
  { id: 'admin-author-filter-isolates', surface: 'Admin Scope', path: '/api/v1/admin/atlas/knowledge-points?authorId=<authorAId>' },
];

const args = parseArgs(argv.slice(2));

if (args.printTemplate) {
  stdout.write(JSON.stringify(template(), null, 2) + '\n');
  exit(0);
}

if (!args.input) {
  console.error('missing --input <multiuser-smoke-report.json>; use --print-template for the required report shape');
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
    actors: {
      admin: { username: 'admin' },
      authorA: { id: 0, username: '<author-a>' },
      authorB: { id: 0, username: '<author-b>' },
    },
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
  console.log('Atlas Multi-user Smoke Gate');
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
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--input') parsed.input = raw[++i];
    else if (arg === '--allow-blocked') parsed.allowBlocked = true;
    else if (arg === '--print-template') parsed.printTemplate = true;
  }
  return parsed;
}
