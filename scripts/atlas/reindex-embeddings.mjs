#!/usr/bin/env node

// Backfill Atlas KP and note embeddings through ai-service internal endpoints.
//
// Required env:
//   AI_INTERNAL_SERVICE_TOKEN=...  (same token configured for ai-service)
//
// Examples:
//   node scripts/atlas/reindex-embeddings.mjs --kind all --limit 100 --batches 20
//   ATLAS_AI_BASE_URL=http://localhost:8000 node scripts/atlas/reindex-embeddings.mjs --kind notes

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.ATLAS_AI_BASE_URL || 'http://localhost:8000');
const token = process.env.AI_INTERNAL_SERVICE_TOKEN || process.env.AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN || '';

if (!token || token.length < 32) {
  console.error('missing AI_INTERNAL_SERVICE_TOKEN or AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN with at least 32 chars');
  process.exit(2);
}

const kinds = args.kind === 'all' ? ['knowledge-points', 'notes'] : [args.kind];
let totalFailed = 0;

for (const kind of kinds) {
  const summary = await runKind(kind);
  totalFailed += summary.failed;
}

if (totalFailed > 0) {
  process.exit(1);
}

async function runKind(kind) {
  const endpoint = kind === 'knowledge-points'
    ? '/v1/atlas/knowledge-points/index-batch'
    : '/v1/notes/index-batch';
  const summary = {
    kind,
    batches: 0,
    selected: 0,
    succeeded: 0,
    notFound: 0,
    failed: 0,
  };

  for (let batch = 1; batch <= args.batches; batch += 1) {
    const payload = {
      limit: args.limit,
      stale_only: args.staleOnly,
    };
    if (args.userId !== null) {
      payload.user_id = args.userId;
    }

    const data = await postJson(`${baseUrl}${endpoint}`, payload);
    summary.batches += 1;
    summary.selected += data.selected_count || 0;
    summary.succeeded += data.succeeded || 0;
    summary.notFound += data.not_found || 0;
    summary.failed += data.failed || 0;

    console.log(
      [
        `kind=${kind}`,
        `batch=${batch}`,
        `profile=${data.profile_id || 'n/a'}`,
        `model=${data.model_id || 'n/a'}`,
        `selected=${data.selected_count || 0}`,
        `succeeded=${data.succeeded || 0}`,
        `not_found=${data.not_found || 0}`,
        `failed=${data.failed || 0}`,
      ].join(' '),
    );
    for (const error of data.errors || []) {
      console.error(`kind=${kind} id=${error.id} error=${error.error}`);
    }

    if ((data.selected_count || 0) === 0) {
      break;
    }
    if ((data.selected_count || 0) < args.limit) {
      break;
    }
    if ((data.succeeded || 0) === 0 && (data.not_found || 0) === 0 && (data.failed || 0) > 0) {
      console.error(`kind=${kind} stopped because the whole batch failed`);
      break;
    }
  }

  console.log(
    [
      `summary kind=${kind}`,
      `batches=${summary.batches}`,
      `selected=${summary.selected}`,
      `succeeded=${summary.succeeded}`,
      `not_found=${summary.notFound}`,
      `failed=${summary.failed}`,
    ].join(' '),
  );
  return summary;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Internal-Service': token,
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid JSON from ${url}: ${error.message}; raw=${raw.slice(0, 500)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${response.statusText} from ${url}: ${raw.slice(0, 500)}`);
  }
  return data;
}

function parseArgs(argv) {
  const out = {
    baseUrl: '',
    kind: 'all',
    limit: 100,
    batches: 20,
    staleOnly: true,
    userId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`missing value for ${arg}`);
      }
      return argv[index];
    };

    switch (arg) {
      case '--base-url':
        out.baseUrl = next();
        break;
      case '--kind':
        out.kind = next();
        break;
      case '--limit':
        out.limit = parsePositiveInt(next(), '--limit');
        break;
      case '--batches':
        out.batches = parsePositiveInt(next(), '--batches');
        break;
      case '--user-id':
        out.userId = parsePositiveInt(next(), '--user-id');
        break;
      case '--all':
        out.staleOnly = false;
        break;
      case '--stale-only':
        out.staleOnly = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!['all', 'knowledge-points', 'notes'].includes(out.kind)) {
    throw new Error('--kind must be all, knowledge-points, or notes');
  }
  if (out.limit > 500) {
    throw new Error('--limit must be <= 500');
  }
  return out;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function printHelp() {
  console.log(`Usage:
  node scripts/atlas/reindex-embeddings.mjs [options]

Options:
  --base-url <url>           ai-service base URL (default: ATLAS_AI_BASE_URL or http://localhost:8000)
  --kind <kind>              all | knowledge-points | notes (default: all)
  --limit <n>                batch size, max 500 (default: 100)
  --batches <n>              max batches per kind (default: 20)
  --user-id <id>             restrict to one author/user scope
  --stale-only               only missing/stale active-profile embeddings (default)
  --all                      force reindex of selected rows even if embeddings exist
`);
}
