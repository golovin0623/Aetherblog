#!/usr/bin/env node
// Atlas R2 relation-health verifier.
//
// By default this runs against a deterministic release corpus. Pass --input to
// evaluate a JSON export, or --database-url / ATLAS_DATABASE_URL / DATABASE_URL
// to evaluate live Postgres data through psql.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

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

const DEFAULT_THRESHOLDS = {
  minDensity: 2,
  minKpEvidenceCoverage: 0.9,
  minRelationEvidenceCoverage: 0.7,
  maxOrphanRatio: 0.35,
};

const FIXTURE = {
  knowledgePoints: [
    kp(1, [101]),
    kp(2, [102]),
    kp(3, [103]),
    kp(4, [104]),
    kp(5, [105]),
  ],
  relations: [
    rel(1, 1, 2, 'supports', [101], 'Evidence links the core claim.'),
    rel(2, 2, 1, 'generalizes', [102], 'The broader concept contains the claim.'),
    rel(3, 1, 3, 'causes', [101, 103], 'The mechanism causes the downstream effect.'),
    rel(4, 3, 4, 'precedes', [103], 'The source sequence establishes order.'),
    rel(5, 4, 5, 'specializes', [104], 'The example narrows the method.'),
    rel(6, 5, 2, 'instance_of', [105], 'The example belongs to the concept.'),
    rel(7, 2, 3, 'cites', [102, 103], 'The concept cites the observed mechanism.'),
    rel(8, 3, 1, 'refutes', [103], 'Counter-evidence marks the boundary.'),
    rel(9, 4, 2, 'similar_to', [], 'Manual rationale is present pending stronger evidence.'),
    rel(10, 5, 1, 'supports', [], 'Imported rationale is present pending stronger evidence.'),
  ],
};

const args = parseArgs(argv.slice(2));
const thresholds = {
  minDensity: numberArg(args.minDensity, DEFAULT_THRESHOLDS.minDensity),
  minKpEvidenceCoverage: numberArg(args.minKpEvidence, DEFAULT_THRESHOLDS.minKpEvidenceCoverage),
  minRelationEvidenceCoverage: numberArg(args.minRelationEvidence, DEFAULT_THRESHOLDS.minRelationEvidenceCoverage),
  maxOrphanRatio: numberArg(args.maxOrphanRatio, DEFAULT_THRESHOLDS.maxOrphanRatio),
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

function kp(id, evidenceAnnotationIds) {
  return { id, archived: false, deleted: false, evidenceAnnotationIds };
}

function rel(id, fromKpId, toKpId, type, evidenceAnnotationIds, bodyMarkdown) {
  return {
    id,
    fromKpId,
    toKpId,
    type,
    deleted: false,
    evidenceAnnotationIds,
    bodyMarkdown,
  };
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

  return { source: 'fixture:r2-release-corpus', data: FIXTURE };
}

function loadFromDatabase(databaseUrl) {
  const sql = `
WITH active_kps AS (
  SELECT
    kp.id,
    COALESCE(array_agg(link.annotation_id) FILTER (WHERE link.annotation_id IS NOT NULL), '{}') AS evidence_annotation_ids
  FROM atlas_knowledge_points kp
  LEFT JOIN atlas_annotation_kp_links link ON link.kp_id = kp.id
  WHERE kp.deleted = false AND kp.archived = false
  GROUP BY kp.id
),
active_relations AS (
  SELECT
    rel.id,
    rel.from_kp_id,
    rel.to_kp_id,
    rel.type,
    COALESCE(rel.body_markdown, '') AS body_markdown,
    COALESCE(array_agg(ev.annotation_id) FILTER (WHERE ev.annotation_id IS NOT NULL), '{}') AS evidence_annotation_ids
  FROM atlas_typed_relations rel
  LEFT JOIN atlas_relation_evidence ev ON ev.relation_id = rel.id
  WHERE rel.deleted = false
  GROUP BY rel.id
)
SELECT json_build_object(
  'knowledgePoints',
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', id,
        'archived', false,
        'deleted', false,
        'evidenceAnnotationIds', evidence_annotation_ids
      ))
      FROM active_kps
    ), '[]'::json),
  'relations',
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', id,
        'fromKpId', from_kp_id,
        'toKpId', to_kp_id,
        'type', type,
        'deleted', false,
        'bodyMarkdown', body_markdown,
        'evidenceAnnotationIds', evidence_annotation_ids
      ))
      FROM active_relations
    ), '[]'::json)
);
`;
  try {
    const output = execFileSync('psql', [databaseUrl, '--tuples-only', '--no-align', '--command', sql], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    }).trim();
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`failed to load Atlas relation health from database through psql: ${error.message}`);
  }
}

function evaluate(raw, limits) {
  const knowledgePoints = Array.isArray(raw.knowledgePoints) ? raw.knowledgePoints : [];
  const activeKps = knowledgePoints.filter((point) => !point.deleted && !point.archived);
  const activeKpIds = new Set(activeKps.map((point) => Number(point.id)));

  const relations = Array.isArray(raw.relations) ? raw.relations : [];
  const activeRelations = relations.filter((relation) => !relation.deleted);
  const validRelations = activeRelations.filter((relation) => {
    return activeKpIds.has(Number(relation.fromKpId)) && activeKpIds.has(Number(relation.toKpId));
  });
  const invalidRelations = activeRelations.filter((relation) => !validRelations.includes(relation));
  const invalidTypes = validRelations.filter((relation) => !RELATION_TYPES.has(relation.type));

  const connectedKpIds = new Set();
  for (const relation of validRelations) {
    connectedKpIds.add(Number(relation.fromKpId));
    connectedKpIds.add(Number(relation.toKpId));
  }

  const kpsWithEvidence = activeKps.filter((point) => hasEvidence(point.evidenceAnnotationIds));
  const relationsWithEvidenceOrRationale = validRelations.filter((relation) => {
    return hasEvidence(relation.evidenceAnnotationIds) || String(relation.bodyMarkdown ?? '').trim().length > 0;
  });

  const metrics = {
    activeKps: activeKps.length,
    activeRelations: validRelations.length,
    invalidRelations: invalidRelations.length,
    invalidRelationTypes: invalidTypes.length,
    relationDensity: ratio(validRelations.length, activeKps.length),
    kpEvidenceCoverage: ratio(kpsWithEvidence.length, activeKps.length),
    relationEvidenceCoverage: ratio(relationsWithEvidenceOrRationale.length, validRelations.length),
    orphanKpRatio: ratio(activeKps.length - connectedKpIds.size, activeKps.length),
  };

  const failures = [];
  if (metrics.activeKps === 0) failures.push('active KP count is zero');
  if (metrics.invalidRelations > 0) failures.push(`invalid relations reference missing/archived/deleted KPs: ${metrics.invalidRelations}`);
  if (metrics.invalidRelationTypes > 0) failures.push(`invalid relation types: ${metrics.invalidRelationTypes}`);
  if (metrics.relationDensity < limits.minDensity) {
    failures.push(`relation density ${fmt(metrics.relationDensity)} < ${fmt(limits.minDensity)}`);
  }
  if (metrics.kpEvidenceCoverage < limits.minKpEvidenceCoverage) {
    failures.push(`KP evidence coverage ${pct(metrics.kpEvidenceCoverage)} < ${pct(limits.minKpEvidenceCoverage)}`);
  }
  if (metrics.relationEvidenceCoverage < limits.minRelationEvidenceCoverage) {
    failures.push(
      `relation evidence/rationale coverage ${pct(metrics.relationEvidenceCoverage)} < ${pct(limits.minRelationEvidenceCoverage)}`
    );
  }
  if (metrics.orphanKpRatio > limits.maxOrphanRatio) {
    failures.push(`orphan KP ratio ${pct(metrics.orphanKpRatio)} > ${pct(limits.maxOrphanRatio)}`);
  }

  return {
    metrics,
    failures,
    passed: failures.length === 0,
  };
}

function hasEvidence(values) {
  return Array.isArray(values) && values.length > 0;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function printReport(source, limits, report) {
  console.log('Atlas R2 Relation Health Gate');
  console.log('=============================');
  console.log(`source=${source}`);
  console.log(
    `thresholds density>=${fmt(limits.minDensity)} kpEvidence>=${pct(limits.minKpEvidenceCoverage)} ` +
      `relationEvidenceOrRationale>=${pct(limits.minRelationEvidenceCoverage)} orphan<=${pct(limits.maxOrphanRatio)}`
  );
  console.log('');
  console.log(`active_kps=${report.metrics.activeKps}`);
  console.log(`active_relations=${report.metrics.activeRelations}`);
  console.log(`relation_density=${fmt(report.metrics.relationDensity)}`);
  console.log(`kp_evidence_coverage=${pct(report.metrics.kpEvidenceCoverage)}`);
  console.log(`relation_evidence_or_rationale_coverage=${pct(report.metrics.relationEvidenceCoverage)}`);
  console.log(`orphan_kp_ratio=${pct(report.metrics.orphanKpRatio)}`);
  console.log(`invalid_relations=${report.metrics.invalidRelations}`);
  console.log(`invalid_relation_types=${report.metrics.invalidRelationTypes}`);
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
    else if (arg === '--min-density') parsed.minDensity = raw[++i];
    else if (arg === '--min-kp-evidence') parsed.minKpEvidence = raw[++i];
    else if (arg === '--min-relation-evidence') parsed.minRelationEvidence = raw[++i];
    else if (arg === '--max-orphan-ratio') parsed.maxOrphanRatio = raw[++i];
  }
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric argument: ${value}`);
  return parsed;
}

function fmt(value) {
  return value.toFixed(2);
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
