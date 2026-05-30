#!/usr/bin/env node
// Atlas R4 performance-budget verifier.
//
// This script checks build-time budgets from apps/admin/dist and can also
// validate runtime measurements when a Playwright trace/smoke report provides
// LCP and graph FPS values. Use --allow-missing-runtime for build-only evidence.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit, stdout } from 'node:process';

const DEFAULTS = {
  adminDist: 'apps/admin/dist',
  assetPattern: 'Atlas|KnowledgePoint|KnowledgePoints|MarkdownReader|Suggestions|atlasService|CreateNotePage|AetherHubWorkspacePage',
  maxAtlasJsBytes: 300 * 1024,
  maxSingleJsBytes: 2 * 1024 * 1024,
  maxAtlasCssBytes: 512 * 1024,
  maxLcpMs: 2500,
  minGraphFps: 30,
};

const args = parseArgs(argv.slice(2));
const limits = {
  adminDist: args.adminDist ?? DEFAULTS.adminDist,
  assetPattern: args.assetPattern ?? DEFAULTS.assetPattern,
  maxAtlasJsBytes: numberArg(args.maxAtlasJsBytes, DEFAULTS.maxAtlasJsBytes),
  maxSingleJsBytes: numberArg(args.maxSingleJsBytes, DEFAULTS.maxSingleJsBytes),
  maxAtlasCssBytes: numberArg(args.maxAtlasCssBytes, DEFAULTS.maxAtlasCssBytes),
  maxLcpMs: numberArg(args.maxLcpMs, DEFAULTS.maxLcpMs),
  minGraphFps: numberArg(args.minGraphFps, DEFAULTS.minGraphFps),
};

const report = evaluate(limits, args);

if (args.json) {
  stdout.write(JSON.stringify({ limits, ...report }, null, 2) + '\n');
} else {
  printReport(limits, report);
}

if (!report.passed) {
  exit(1);
}

function evaluate(limits, parsedArgs) {
  const assetsDir = join(limits.adminDist, 'assets');
  const files = listFiles(assetsDir);
  const assetRe = new RegExp(limits.assetPattern);
  const atlasAssets = files.filter((file) => assetRe.test(file.name));
  const allJsAssets = files.filter((file) => file.name.endsWith('.js'));
  const atlasJsBytes = sum(atlasAssets.filter((file) => file.name.endsWith('.js')).map((file) => file.bytes));
  const atlasCssBytes = sum(atlasAssets.filter((file) => file.name.endsWith('.css')).map((file) => file.bytes));
  const largestJsAsset = allJsAssets.reduce((largest, file) => (file.bytes > largest.bytes ? file : largest), {
    name: '',
    path: '',
    bytes: 0,
  });

  const runtime = {
    lcpMs: parsedArgs.lcpMs === undefined ? null : Number(parsedArgs.lcpMs),
    graphFps: parsedArgs.graphFps === undefined ? null : Number(parsedArgs.graphFps),
    skipped: Boolean(parsedArgs.allowMissingRuntime && (parsedArgs.lcpMs === undefined || parsedArgs.graphFps === undefined)),
  };

  const metrics = {
    atlasAssetCount: atlasAssets.length,
    atlasJsBytes,
    atlasCssBytes,
    largestJsAsset: { name: largestJsAsset.name, bytes: largestJsAsset.bytes },
    lcpMs: runtime.lcpMs,
    graphFps: runtime.graphFps,
    runtimeSkipped: runtime.skipped,
  };

  const failures = [];
  if (metrics.atlasAssetCount === 0) failures.push(`no Atlas assets matched pattern ${limits.assetPattern}`);
  if (metrics.atlasJsBytes > limits.maxAtlasJsBytes) {
    failures.push(`Atlas JS bytes ${metrics.atlasJsBytes} > ${limits.maxAtlasJsBytes}`);
  }
  if (metrics.atlasCssBytes > limits.maxAtlasCssBytes) {
    failures.push(`Atlas CSS bytes ${metrics.atlasCssBytes} > ${limits.maxAtlasCssBytes}`);
  }
  if (metrics.largestJsAsset.bytes > limits.maxSingleJsBytes) {
    failures.push(`largest JS asset ${metrics.largestJsAsset.name}=${metrics.largestJsAsset.bytes} > ${limits.maxSingleJsBytes}`);
  }
  if (!parsedArgs.allowMissingRuntime || parsedArgs.lcpMs !== undefined) {
    if (!Number.isFinite(runtime.lcpMs)) failures.push('missing runtime LCP measurement; pass --lcp-ms or --allow-missing-runtime');
    else if (runtime.lcpMs > limits.maxLcpMs) failures.push(`LCP ${runtime.lcpMs}ms > ${limits.maxLcpMs}ms`);
  }
  if (!parsedArgs.allowMissingRuntime || parsedArgs.graphFps !== undefined) {
    if (!Number.isFinite(runtime.graphFps)) failures.push('missing graph FPS measurement; pass --graph-fps or --allow-missing-runtime');
    else if (runtime.graphFps < limits.minGraphFps) failures.push(`graph FPS ${runtime.graphFps} < ${limits.minGraphFps}`);
  }

  return {
    metrics,
    failures,
    passed: failures.length === 0,
  };
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isFile()) files.push({ name, path, bytes: stat.size });
  }
  return files;
}

function printReport(limits, report) {
  console.log('Atlas R4 Performance Budget Gate');
  console.log('================================');
  console.log(`admin_dist=${limits.adminDist}`);
  console.log(`asset_pattern=${limits.assetPattern}`);
  console.log(
    `thresholds atlasJs<=${bytes(limits.maxAtlasJsBytes)} atlasCss<=${bytes(limits.maxAtlasCssBytes)} ` +
      `singleJs<=${bytes(limits.maxSingleJsBytes)} lcp<=${limits.maxLcpMs}ms graphFps>=${limits.minGraphFps}`
  );
  console.log('');
  console.log(`atlas_asset_count=${report.metrics.atlasAssetCount}`);
  console.log(`atlas_js=${bytes(report.metrics.atlasJsBytes)}`);
  console.log(`atlas_css=${bytes(report.metrics.atlasCssBytes)}`);
  console.log(`largest_js=${report.metrics.largestJsAsset.name || 'n/a'} ${bytes(report.metrics.largestJsAsset.bytes)}`);
  console.log(`lcp_ms=${report.metrics.lcpMs ?? 'not measured'}`);
  console.log(`graph_fps=${report.metrics.graphFps ?? 'not measured'}`);
  if (report.metrics.runtimeSkipped) console.log('runtime=skipped by --allow-missing-runtime');
  console.log('');
  if (report.failures.length) {
    for (const failure of report.failures) console.log(`FAIL: ${failure}`);
  }
  console.log(report.passed ? 'PASS' : 'FAIL');
}

function parseArgs(raw) {
  const parsed = {};
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--allow-missing-runtime') parsed.allowMissingRuntime = true;
    else if (arg === '--admin-dist') parsed.adminDist = raw[++i];
    else if (arg === '--asset-pattern') parsed.assetPattern = raw[++i];
    else if (arg === '--max-atlas-js-bytes') parsed.maxAtlasJsBytes = raw[++i];
    else if (arg === '--max-single-js-bytes') parsed.maxSingleJsBytes = raw[++i];
    else if (arg === '--max-atlas-css-bytes') parsed.maxAtlasCssBytes = raw[++i];
    else if (arg === '--max-lcp-ms') parsed.maxLcpMs = raw[++i];
    else if (arg === '--min-graph-fps') parsed.minGraphFps = raw[++i];
    else if (arg === '--lcp-ms') parsed.lcpMs = raw[++i];
    else if (arg === '--graph-fps') parsed.graphFps = raw[++i];
  }
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric argument: ${value}`);
  return parsed;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function bytes(value) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KiB`;
  return `${value}B`;
}
