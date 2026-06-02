#!/usr/bin/env node
// Atlas R1 real-PDF corpus gate.
//
// This gate builds representative multi-page PDF files, extracts their text
// layers through the same pypdf dependency used by ai-service, and then runs
// the Atlas TextQuote/TextPosition relocation path across document revisions.

import { spawnSync } from 'node:child_process';
import { constants, mkdirSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit, stdout } from 'node:process';

const DEFAULT_MIN_RECALL = 0.9;
const SOFT_THRESHOLD = 0.85;
const HARD_THRESHOLD = 0.5;
const MAX_EXTRACT_BUFFER = 24 * 1024 * 1024;

const args = parseArgs(argv.slice(2));
const minRecall = Number(args.minRecall ?? DEFAULT_MIN_RECALL);
const python = await resolvePython(args.python);
const corpus = buildCorpus();
const documents = [];
const results = [];

if (args.keepOutput) {
  mkdirSync(args.outputDir, { recursive: true });
}

for (const doc of corpus) {
  const originalPdf = buildPDF(doc.pages);
  const originalLayer = extractPDFTextLayer(python, originalPdf, `${doc.id}-original.pdf`);
  if (args.keepOutput) writeFileSync(join(args.outputDir, `${doc.id}-original.pdf`), originalPdf);

  const selectorsByExact = new Map();
  for (const exact of doc.anchors) {
    selectorsByExact.set(exact, makeSelectors(originalLayer, exact));
  }

  documents.push({
    id: doc.id,
    originalPages: originalLayer.page_count,
    originalChars: originalLayer.char_count,
    variants: doc.variants.length,
  });

  for (const variant of doc.variants) {
    const variantPdf = buildPDF(variant.pages);
    const layer = extractPDFTextLayer(python, variantPdf, `${doc.id}-${variant.name}.pdf`);
    if (args.keepOutput) writeFileSync(join(args.outputDir, `${doc.id}-${variant.name}.pdf`), variantPdf);

    for (const exact of variant.anchorable) {
      const outcome = anchor(layer.text, selectorsByExact.get(exact));
      results.push({
        document: doc.id,
        variant: variant.name,
        exact,
        expected: 'anchored_or_soft',
        pageCount: layer.page_count,
        ...outcome,
      });
    }
    for (const exact of variant.orphan ?? []) {
      const outcome = anchor(layer.text, selectorsByExact.get(exact));
      results.push({
        document: doc.id,
        variant: variant.name,
        exact,
        expected: 'orphan',
        pageCount: layer.page_count,
        ...outcome,
      });
    }
  }
}

const anchorable = results.filter((row) => row.expected === 'anchored_or_soft');
const recalled = anchorable.filter((row) => row.state === 'anchored' || row.state === 'soft_anchored');
const deliberateOrphans = results.filter((row) => row.expected === 'orphan');
const orphanMatches = deliberateOrphans.filter((row) => row.state === 'orphan');
const recall = anchorable.length ? recalled.length / anchorable.length : 0;
const passed = recall >= minRecall && orphanMatches.length === deliberateOrphans.length;

const report = {
  minRecall,
  recall,
  passed,
  extractor: 'pypdf',
  python,
  documents,
  totalDocuments: documents.length,
  totalOriginalPages: documents.reduce((sum, doc) => sum + doc.originalPages, 0),
  totalVariants: documents.reduce((sum, doc) => sum + doc.variants, 0),
  totalAnchorable: anchorable.length,
  recalled: recalled.length,
  deliberateOrphans: deliberateOrphans.length,
  orphanMatches: orphanMatches.length,
  results,
};

if (args.json) {
  stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  console.log('Atlas R1 Real PDF Corpus Gate');
  console.log('=============================');
  console.log(`extractor=${report.extractor}`);
  console.log(`documents=${report.totalDocuments} original_pages=${report.totalOriginalPages} variants=${report.totalVariants}`);
  console.log(`anchorable=${report.totalAnchorable} recalled=${report.recalled} recall=${fmtPct(report.recall)} min=${fmtPct(report.minRecall)}`);
  console.log(`deliberate_orphans=${report.deliberateOrphans} matched=${report.orphanMatches}`);
  console.log('');
  for (const row of results) {
    console.log(`${row.document.padEnd(18)} ${row.variant.padEnd(18)} ${row.state.padEnd(13)} ${row.score.toFixed(3)}  ${row.exact}`);
  }
  console.log('');
  console.log(passed ? 'PASS' : 'FAIL');
}

if (!passed) {
  exit(1);
}

async function resolvePython(explicit) {
  const candidates = [
    explicit,
    process.env.ATLAS_PDF_PYTHON,
    'apps/ai-service/.venv/bin/python',
    'python3',
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
    } catch {
      if (candidate.includes('/')) continue;
    }
    const check = spawnSync(candidate, ['-c', 'import pypdf'], { stdio: 'ignore' });
    if (check.status === 0) return candidate;
  }
  throw new Error('No Python interpreter with pypdf found. Install apps/ai-service requirements or pass --python <path>.');
}

function extractPDFTextLayer(pythonBin, pdfBuffer, filename) {
  const script = String.raw`
import hashlib
import io
import json
import sys

import pypdf

reader = pypdf.PdfReader(io.BytesIO(sys.stdin.buffer.read()))
parts = []
pages = []
cursor = 0
for index, page in enumerate(reader.pages, start=1):
    if index > 1:
        parts.append("\n\n")
        cursor += 2
    text = (page.extract_text() or "").strip()
    start = cursor
    parts.append(text)
    cursor += len(text)
    pages.append({"page": index, "text": text, "char_start": start, "char_end": cursor})
full_text = "".join(parts)
json.dump({
    "filename": sys.argv[1],
    "text": full_text,
    "text_hash": hashlib.sha256(full_text.encode("utf-8")).hexdigest(),
    "page_count": len(reader.pages),
    "char_count": len(full_text),
    "pages": pages,
}, sys.stdout, ensure_ascii=False)
`;
  const result = spawnSync(pythonBin, ['-c', script, filename], {
    input: pdfBuffer,
    encoding: 'buffer',
    maxBuffer: MAX_EXTRACT_BUFFER,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pypdf extraction failed for ${filename}: ${result.stderr.toString('utf8').slice(0, 800)}`);
  }
  return JSON.parse(result.stdout.toString('utf8'));
}

function makeSelectors(layer, exact) {
  const start = layer.text.indexOf(exact);
  if (start < 0) {
    throw new Error(`anchor text not found in extracted layer: ${exact}`);
  }
  const end = start + exact.length;
  const page = layer.pages.find((item) => start >= item.char_start && start <= item.char_end)?.page ?? 1;
  return [
    {
      type: 'TextQuoteSelector',
      exact,
      prefix: layer.text.slice(Math.max(0, start - 40), start),
      suffix: layer.text.slice(end, Math.min(layer.text.length, end + 40)),
    },
    {
      type: 'TextPositionSelector',
      start,
      end,
    },
    {
      type: 'FragmentSelector',
      conformsTo: 'https://aetherblog.local/atlas/pdf-text-layer',
      value: `page=${page}&rect=72,120,420,16`,
      page,
      rects: [{ x: 72, y: 120, width: 420, height: 16 }],
    },
  ];
}

function anchor(newText, selectorList) {
  const quote = selectorList.find((selector) => selector.type === 'TextQuoteSelector');
  const position = selectorList.find((selector) => selector.type === 'TextPositionSelector');
  if (!quote) return { state: 'orphan', score: 0, start: -1, end: -1 };

  if (position) {
    const candidate = newText.slice(position.start, position.end);
    if (candidate === quote.exact) {
      return { state: 'anchored', score: 1, start: position.start, end: position.end };
    }
  }

  const exactIdx = newText.indexOf(quote.exact);
  if (exactIdx !== -1) {
    return { state: 'anchored', score: 1, start: exactIdx, end: exactIdx + quote.exact.length };
  }

  if (quote.prefix && quote.prefix.length >= 5) {
    const prefixIdx = newText.indexOf(quote.prefix);
    if (prefixIdx !== -1) {
      const start = prefixIdx + quote.prefix.length;
      const end = start + quote.exact.length;
      const score = similarity(newText.slice(start, end), quote.exact);
      if (score >= 1) return { state: 'anchored', score, start, end };
      if (score >= SOFT_THRESHOLD) return { state: 'soft_anchored', score, start, end };
    }
  }

  const best = slideWindow(newText, quote.exact);
  if (best.score >= SOFT_THRESHOLD) {
    return { state: 'soft_anchored', score: best.score, start: best.start, end: best.start + quote.exact.length };
  }
  if (best.score >= HARD_THRESHOLD) {
    return { state: 'orphan', score: best.score, start: best.start, end: best.start + quote.exact.length };
  }
  return { state: 'orphan', score: best.score, start: -1, end: -1 };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function slideWindow(text, target) {
  const width = target.length;
  if (!width || text.length < width) return { score: 0, start: -1 };
  const step = Math.max(1, Math.floor(width / 8));
  let best = { score: 0, start: -1 };
  for (let start = 0; start + width <= text.length; start += step) {
    const score = similarity(text.slice(start, start + width), target);
    if (score > best.score) best = { score, start };
  }
  return best;
}

function buildPDF(pages) {
  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjects = [];
  let nextObjectID = 4;
  for (const lines of pages) {
    const pageObjectID = nextObjectID;
    const contentObjectID = nextObjectID + 1;
    nextObjectID += 2;
    pageObjects.push(pageObjectID);
    const stream = buildPageStream(lines);
    objects.push(`${pageObjectID} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectID} 0 R >>\nendobj\n`);
    objects.push(`${contentObjectID} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  objects.splice(1, 0, `2 0 obj\n<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjects.length} >>\nendobj\n`);
  objects.splice(2, 0, '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const chunks = ['%PDF-1.4\n% Atlas real corpus\n'];
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

function buildPageStream(lines) {
  const ops = ['BT', '/F1 11 Tf', '14 TL', '72 742 Td'];
  lines.forEach((line, index) => {
    if (index > 0) ops.push('T*');
    ops.push(`(${escapePDFText(line)}) Tj`);
  });
  ops.push('ET', '');
  return `${ops.join('\n')}`;
}

function escapePDFText(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function buildCorpus() {
  const docs = [
    {
      id: 'research-memo',
      anchors: [
        'Atlas captures evidence before claims become graph knowledge',
        'Selectors survive edits when exact quotes and positions agree',
        'Relation evidence prevents graph drift across review cycles',
        'Release gates require recall numbers from the same extraction path',
      ],
      pages: [
        [
          'Aether Atlas Research Memo',
          'Version 1.0',
          'Atlas captures evidence before claims become graph knowledge.',
          'The reader stores quote selectors, text positions, and page fragments.',
          'Selectors survive edits when exact quotes and positions agree.',
          'A review note records when a fallback match needs human confirmation.',
        ],
        [
          'Evidence Model',
          'Relation evidence prevents graph drift across review cycles.',
          'Each relation carries a typed edge and one or more source annotations.',
          'Teams can audit why an edge exists without trusting a model summary.',
          'Orphaned anchors remain visible and do not pretend to be valid.',
        ],
        [
          'Gate Evidence',
          'Release gates require recall numbers from the same extraction path.',
          'The corpus must include multi-page files, inserts, and removed text.',
          'A failed recall gate pauses promotion to later graph workflows.',
        ],
      ],
    },
    {
      id: 'ops-runbook',
      anchors: [
        'The operator checks extraction health before enabling PDF carriers',
        'A rollback keeps text layers immutable for already ingested versions',
        'Alerts include carrier id, media id, and extractor name',
        'Manual review starts when a document loses its primary quote anchor',
      ],
      pages: [
        [
          'Knowledge Atlas Operations Runbook',
          'The operator checks extraction health before enabling PDF carriers.',
          'Step 1: verify pypdf is installed in the AI service runtime.',
          'Step 2: upload a known PDF and inspect page count and text hash.',
          'Step 3: confirm the admin reader opens through the gateway.',
        ],
        [
          'Rollback And Alerts',
          'A rollback keeps text layers immutable for already ingested versions.',
          'Alerts include carrier id, media id, and extractor name.',
          'Manual review starts when a document loses its primary quote anchor.',
          'The incident record links failed anchors to the source PDF page.',
        ],
      ],
    },
    {
      id: 'product-spec',
      anchors: [
        'Inline highlights must never rewrite the original document body',
        'Users can promote an annotation into a knowledge point with evidence',
        'The graph view shows only nodes allowed by the current Atlas scope',
        'AI suggestions stay pending until a person accepts or rejects them',
      ],
      pages: [
        [
          'Atlas Product Spec',
          'Inline highlights must never rewrite the original document body.',
          'Highlights are a rendering overlay and disappear when selectors orphan.',
          'Users can promote an annotation into a knowledge point with evidence.',
          'The detail screen keeps provenance visible next to every claim.',
        ],
        [
          'Graph Scope',
          'The graph view shows only nodes allowed by the current Atlas scope.',
          'Admin users can switch to all accessible data for review.',
          'Authors remain scoped to their own knowledge points and carriers.',
        ],
        [
          'AI Inbox',
          'AI suggestions stay pending until a person accepts or rejects them.',
          'Accepted items write final knowledge points or relations.',
          'Rejected items remain useful as quality measurement data.',
        ],
        [
          'Release Notes',
          'The release checklist records tests, smoke runs, and remaining gates.',
          'Performance budgets cover bundle size, LCP, and graph frame rate.',
        ],
      ],
    },
  ];

  return docs.map((doc) => ({
    ...doc,
    variants: [
      {
        name: 'cover-page-insert',
        pages: [['Cover Page', `${doc.id} controlled revision`, 'This page simulates an exported cover sheet.'], ...doc.pages],
        anchorable: doc.anchors,
      },
      {
        name: 'appendix-insert',
        pages: [...doc.pages, ['Appendix', 'This appendix was added after the first review.', 'Anchors from earlier pages should still relocate.']],
        anchorable: doc.anchors,
      },
      {
        name: 'page-note-insert',
        pages: doc.pages.map((page, index) => (index === 1 ? ['Revision Note', 'A reviewer inserted this page-level note before the original content.', ...page] : page)),
        anchorable: doc.anchors,
      },
      {
        name: 'intentional-orphan',
        pages: removeAnchor(doc.pages, doc.anchors.at(-1)),
        anchorable: doc.anchors.slice(0, -1),
        orphan: [doc.anchors.at(-1)],
      },
    ],
  }));
}

function removeAnchor(pages, anchorText) {
  return pages.map((lines) =>
    lines.map((line) => {
      if (!line.includes(anchorText)) return line;
      return 'This paragraph was rewritten and the previous anchor text is intentionally absent.';
    })
  );
}

function fmtPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function parseArgs(raw) {
  const parsed = {
    outputDir: 'output/atlas-pdf-real-corpus',
  };
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    const [key, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = inlineValue ?? raw[i + 1];
    if (key === '--json') parsed.json = true;
    else if (key === '--keep-output') parsed.keepOutput = true;
    else if (key === '--min-recall') {
      parsed.minRecall = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--python') {
      parsed.python = value;
      if (inlineValue === undefined) i += 1;
    } else if (key === '--output-dir') {
      parsed.outputDir = value;
      if (inlineValue === undefined) i += 1;
    }
  }
  return parsed;
}
