#!/usr/bin/env node
// Atlas R3 AI-suggestion quality verifier.
//
// This gate measures the suggestion inbox contract: generated suggestions must
// be schema-valid, grounded in source context, and accepted often enough to keep
// the feature useful. It can evaluate an exported JSON file or live Postgres via
// psql; without input it uses a deterministic release corpus.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

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

const DEFAULT_THRESHOLDS = {
  minKpAcceptRate: 0.5,
  minRelationAcceptRate: 0.35,
  minSchemaValidRate: 1,
  minGroundedRate: 1,
};

const FIXTURE = {
  suggestions: [
    kp(1, 'accepted', { annotationId: 101, proposedTitle: 'Annotation is evidence, not the KP', proposedKpType: 'claim' }),
    kp(2, 'accepted', { carrierId: 10, proposedTitle: 'Typed relations need source evidence', proposedKpType: 'claim' }),
    kp(3, 'accepted', { annotationId: 103, proposedTitle: 'Atlas keeps AI output in the inbox', proposedKpType: 'concept' }),
    kp(4, 'accepted', { annotationId: 104, proposedTitle: 'Reader anchors combine quote and position selectors', proposedKpType: 'method' }),
    kp(5, 'accepted', { annotationId: 105, proposedTitle: 'AetherHub can ground answers in KP context', proposedKpType: 'claim' }),
    kp(6, 'rejected', { annotationId: 106, proposedTitle: 'Weak duplicate candidate', proposedKpType: 'claim' }),
    kp(7, 'ignored', { annotationId: 107, proposedTitle: 'Noisy restatement', proposedKpType: 'concept' }),
    kp(8, 'rejected', { carrierId: 10, proposedTitle: 'Low-value source node', proposedKpType: 'source' }),
    relation(9, 'accepted', { fromKpId: 1, toKpId: 2, proposedRelationType: 'supports' }),
    relation(10, 'accepted', { fromKpId: 3, toKpId: 1, proposedRelationType: 'specializes' }),
    relation(11, 'accepted', { fromKpId: 4, toKpId: 5, proposedRelationType: 'causes' }),
    relation(12, 'rejected', { fromKpId: 2, toKpId: 4, proposedRelationType: 'similar_to' }),
    relation(13, 'ignored', { fromKpId: 5, toKpId: 3, proposedRelationType: 'cites' }),
    relation(14, 'rejected', { fromKpId: 1, toKpId: 5, proposedRelationType: 'generalizes' }),
  ],
};

const args = parseArgs(argv.slice(2));
const thresholds = {
  minKpAcceptRate: numberArg(args.minKpAcceptRate, DEFAULT_THRESHOLDS.minKpAcceptRate),
  minRelationAcceptRate: numberArg(args.minRelationAcceptRate, DEFAULT_THRESHOLDS.minRelationAcceptRate),
  minSchemaValidRate: numberArg(args.minSchemaValidRate, DEFAULT_THRESHOLDS.minSchemaValidRate),
  minGroundedRate: numberArg(args.minGroundedRate, DEFAULT_THRESHOLDS.minGroundedRate),
};

const { source, data } = loadData(args);
const report = evaluate(data, thresholds);

if (args.json) {
  stdout.write(JSON.stringify({ source, thresholds, ...report }, null, 2) + '\n');
} else {
  printReport(source, thresholds, report);
}

if (!report.passed) {
  exit(1);
}

function kp(id, status, fields) {
  return { id, kind: 'kp', status, ...fields };
}

function relation(id, status, fields) {
  return { id, kind: 'relation', status, ...fields };
}

function loadData(parsedArgs) {
  if (parsedArgs.input) {
    return {
      source: parsedArgs.input,
      data: JSON.parse(readFileSync(parsedArgs.input, 'utf8')),
    };
  }

  const databaseUrl = parsedArgs.databaseUrl ?? process.env.ATLAS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (databaseUrl) {
    return { source: 'database', data: loadFromDatabase(databaseUrl) };
  }

  return { source: 'fixture:r3-ai-quality-corpus', data: FIXTURE };
}

function loadFromDatabase(databaseUrl) {
  const sql = `
SELECT json_build_object(
  'suggestions',
  COALESCE(json_agg(json_build_object(
    'id', id,
    'kind', kind,
    'status', status,
    'carrierId', carrier_id,
    'annotationId', annotation_id,
    'fromKpId', from_kp_id,
    'toKpId', to_kp_id,
    'proposedTitle', proposed_title,
    'proposedKpType', proposed_kp_type,
    'proposedRelationType', proposed_relation_type,
    'modelId', model_id,
    'tokensIn', tokens_in,
    'tokensOut', tokens_out,
    'costUsd', cost_usd
  ) ORDER BY id), '[]'::json)
)
FROM atlas_ai_suggestions
WHERE status IN ('accepted', 'rejected', 'ignored', 'expired');
`;
  try {
    const output = execFileSync('psql', [databaseUrl, '--tuples-only', '--no-align', '--command', sql], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    }).trim();
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`failed to load Atlas AI quality data from database through psql: ${error.message}`);
  }
}

function evaluate(raw, limits) {
  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const finalSuggestions = suggestions.filter((suggestion) => FINAL_STATUSES.has(suggestion.status));
  const kpSuggestions = finalSuggestions.filter((suggestion) => suggestion.kind === 'kp');
  const relationSuggestions = finalSuggestions.filter((suggestion) => suggestion.kind === 'relation');

  const schemaValidSuggestions = finalSuggestions.filter(isSchemaValid);
  const groundedSuggestions = finalSuggestions.filter(isGrounded);

  const metrics = {
    finalSuggestions: finalSuggestions.length,
    kpGenerated: kpSuggestions.length,
    kpAccepted: kpSuggestions.filter((suggestion) => suggestion.status === 'accepted').length,
    relationGenerated: relationSuggestions.length,
    relationAccepted: relationSuggestions.filter((suggestion) => suggestion.status === 'accepted').length,
    schemaValidRate: ratio(schemaValidSuggestions.length, finalSuggestions.length),
    groundedRate: ratio(groundedSuggestions.length, finalSuggestions.length),
  };
  metrics.kpAcceptRate = ratio(metrics.kpAccepted, metrics.kpGenerated);
  metrics.relationAcceptRate = ratio(metrics.relationAccepted, metrics.relationGenerated);

  const failures = [];
  if (metrics.finalSuggestions === 0) failures.push('final suggestion count is zero');
  if (metrics.kpGenerated === 0) failures.push('final KP suggestion count is zero');
  if (metrics.relationGenerated === 0) failures.push('final relation suggestion count is zero');
  if (metrics.kpAcceptRate < limits.minKpAcceptRate) {
    failures.push(`KP accept rate ${pct(metrics.kpAcceptRate)} < ${pct(limits.minKpAcceptRate)}`);
  }
  if (metrics.relationAcceptRate < limits.minRelationAcceptRate) {
    failures.push(`relation accept rate ${pct(metrics.relationAcceptRate)} < ${pct(limits.minRelationAcceptRate)}`);
  }
  if (metrics.schemaValidRate < limits.minSchemaValidRate) {
    failures.push(`schema valid rate ${pct(metrics.schemaValidRate)} < ${pct(limits.minSchemaValidRate)}`);
  }
  if (metrics.groundedRate < limits.minGroundedRate) {
    failures.push(`grounded rate ${pct(metrics.groundedRate)} < ${pct(limits.minGroundedRate)}`);
  }

  return {
    metrics,
    failures,
    passed: failures.length === 0,
  };
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

function printReport(source, limits, report) {
  console.log('Atlas R3 AI Quality Gate');
  console.log('========================');
  console.log(`source=${source}`);
  console.log(
    `thresholds kpAccept>=${pct(limits.minKpAcceptRate)} relationAccept>=${pct(limits.minRelationAcceptRate)} ` +
      `schemaValid>=${pct(limits.minSchemaValidRate)} grounded>=${pct(limits.minGroundedRate)}`
  );
  console.log('');
  console.log(`final_suggestions=${report.metrics.finalSuggestions}`);
  console.log(`kp_accept_rate=${pct(report.metrics.kpAcceptRate)} (${report.metrics.kpAccepted}/${report.metrics.kpGenerated})`);
  console.log(
    `relation_accept_rate=${pct(report.metrics.relationAcceptRate)} ` +
      `(${report.metrics.relationAccepted}/${report.metrics.relationGenerated})`
  );
  console.log(`schema_valid_rate=${pct(report.metrics.schemaValidRate)}`);
  console.log(`grounded_rate=${pct(report.metrics.groundedRate)}`);
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
    else if (arg === '--input') parsed.input = raw[++i];
    else if (arg === '--database-url') parsed.databaseUrl = raw[++i];
    else if (arg === '--min-kp-accept') parsed.minKpAcceptRate = raw[++i];
    else if (arg === '--min-relation-accept') parsed.minRelationAcceptRate = raw[++i];
    else if (arg === '--min-schema-valid') parsed.minSchemaValidRate = raw[++i];
    else if (arg === '--min-grounded') parsed.minGroundedRate = raw[++i];
  }
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

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
