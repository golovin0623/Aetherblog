#!/usr/bin/env node
// Atlas R1 anchoring recall verifier for PDF text-layer corpora.
//
// This does not claim PDF.js extraction is complete. It verifies that once a PDF
// reader supplies stable page text plus FragmentSelector metadata, the existing
// TextQuote/TextPosition relocation path keeps anchors across version changes.

import { argv, exit, stdout } from 'node:process';

const DEFAULT_MIN_RECALL = 0.9;
const SOFT_THRESHOLD = 0.85;
const HARD_THRESHOLD = 0.5;

const args = parseArgs(argv.slice(2));
const minRecall = Number(args.minRecall ?? DEFAULT_MIN_RECALL);

const PAGE_BREAK = '\n\f\n';
const ORIGINAL = [
  'PDF Reader 把页面文本层作为锚定空间，页面坐标只作为跳回原文的辅助信息。',
  '页码和矩形只负责跳回视口；TextQuoteSelector 负责跨版本召回。',
  'OCR 修正可能改变空格和标点，因此 prefix 与滑窗匹配必须保留。',
  '关系证据必须能跳回 PDF 页面的原位置，方便用户审计关系为什么成立。',
  '删除的段落应该进入 orphan 状态，而不是伪装成低置信度命中。',
].join(PAGE_BREAK);

const ANCHOR_TEXTS = [
  'PDF Reader 把页面文本层作为锚定空间',
  '页面坐标只作为跳回原文的辅助信息',
  'TextQuoteSelector 负责跨版本召回',
  'OCR 修正可能改变空格和标点',
  '关系证据必须能跳回 PDF 页面的原位置',
  '删除的段落应该进入 orphan 状态',
];

const CASES = [
  {
    name: 'cover-page-insert',
    text: `封面\n\nAether Atlas PDF 版本迁移测试。${PAGE_BREAK}${ORIGINAL}`,
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'ocr-punctuation-copyedit',
    text: ORIGINAL.replace('OCR 修正可能改变空格和标点', 'OCR 修正可能改变空格、标点'),
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'page-note-insert',
    text: ORIGINAL.replace(
      '关系证据必须能跳回 PDF 页面的原位置',
      '页脚说明：本页来自重新导出的 PDF。\n关系证据必须能跳回 PDF 页面的原位置'
    ),
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'intentional-orphan',
    text: ORIGINAL.replace('删除的段落应该进入 orphan 状态，而不是伪装成低置信度命中。', '该页内容被作者重写，旧段落已经不存在。'),
    anchorable: ANCHOR_TEXTS.filter((text) => text !== '删除的段落应该进入 orphan 状态'),
    orphan: ['删除的段落应该进入 orphan 状态'],
  },
];

const selectors = new Map(ANCHOR_TEXTS.map((text) => [text, makeSelectors(ORIGINAL, text)]));
const results = [];

for (const testCase of CASES) {
  for (const exact of testCase.anchorable) {
    const outcome = anchor(testCase.text, selectors.get(exact));
    results.push({ case: testCase.name, exact, expected: 'anchored_or_soft', ...outcome });
  }
  for (const exact of testCase.orphan ?? []) {
    const outcome = anchor(testCase.text, selectors.get(exact));
    results.push({ case: testCase.name, exact, expected: 'orphan', ...outcome });
  }
}

const anchorable = results.filter((row) => row.expected === 'anchored_or_soft');
const recalled = anchorable.filter((row) => row.state === 'anchored' || row.state === 'soft_anchored');
const deliberateOrphans = results.filter((row) => row.expected === 'orphan');
const orphanMatches = deliberateOrphans.filter((row) => row.state === 'orphan');
const recall = anchorable.length ? recalled.length / anchorable.length : 0;
const passed = recall >= minRecall && orphanMatches.length === deliberateOrphans.length;

if (args.json) {
  stdout.write(
    JSON.stringify(
      {
        minRecall,
        recall,
        passed,
        totalAnchorable: anchorable.length,
        recalled: recalled.length,
        deliberateOrphans: deliberateOrphans.length,
        orphanMatches: orphanMatches.length,
        results,
      },
      null,
      2
    ) + '\n'
  );
} else {
  console.log('Atlas R1 Anchoring Recall — PDF Text-Layer Version Corpus');
  console.log('=========================================================');
  console.log(`anchorable=${anchorable.length} recalled=${recalled.length} recall=${fmtPct(recall)} min=${fmtPct(minRecall)}`);
  console.log(`deliberate_orphans=${deliberateOrphans.length} matched=${orphanMatches.length}`);
  console.log('');
  for (const row of results) {
    console.log(`${row.case.padEnd(26)} ${row.state.padEnd(13)} ${row.score.toFixed(3)}  ${row.exact}`);
  }
  console.log('');
  console.log(passed ? 'PASS' : 'FAIL');
}

if (!passed) {
  exit(1);
}

function makeSelectors(text, exact) {
  const start = text.indexOf(exact);
  if (start < 0) {
    throw new Error(`anchor text not found: ${exact}`);
  }
  const end = start + exact.length;
  const page = 1 + text.slice(0, start).split(PAGE_BREAK).length - 1;
  return [
    {
      type: 'TextQuoteSelector',
      exact,
      prefix: text.slice(Math.max(0, start - 30), start),
      suffix: text.slice(end, Math.min(text.length, end + 30)),
    },
    {
      type: 'TextPositionSelector',
      start,
      end,
    },
    {
      type: 'FragmentSelector',
      conformsTo: 'https://aetherblog.local/atlas/pdf-text-layer',
      value: `page=${page}&rect=0,0,100,12`,
      page,
      rects: [{ x: 0, y: 0, width: 100, height: 12 }],
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

function fmtPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function parseArgs(raw) {
  const parsed = {};
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--min-recall') parsed.minRecall = raw[++i];
  }
  return parsed;
}
