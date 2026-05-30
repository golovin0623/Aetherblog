#!/usr/bin/env node
// Atlas R1 anchoring recall verifier.
//
// This is a deterministic Markdown/version-migration corpus, not the exploratory
// random-edit spike. It exits non-zero when recall drops below the configured
// threshold so release gates can use it as repeatable evidence.

import { argv, exit, stdout } from 'node:process';

const DEFAULT_MIN_RECALL = 0.9;
const SOFT_THRESHOLD = 0.85;
const HARD_THRESHOLD = 0.5;

const args = parseArgs(argv.slice(2));
const minRecall = Number(args.minRecall ?? DEFAULT_MIN_RECALL);

const ORIGINAL = `# Atlas R1 Corpus

Aether Atlas 把标注和知识点分开：标注只是出处，知识点才是用户综合后的判断。
关系自身也需要证据，否则图谱会退化为无来源的断言。
Typed relation 必须是 supports, refutes, specializes, generalizes, precedes, causes, similar_to, cites, instance_of 之一。

## Local First

CRDT 🔒 本地优先让私有知识可以离线编辑，再通过受控同步进入多端视图。
Reader 重新打开时必须把 W3C TextQuoteSelector 和 TextPositionSelector 一起用于重定位。

## AetherHub

AetherHub 回答只能引用用户选择或系统召回的 KP，并在答案里保留 [KP #id] 与 evidence 标记。
AI 建议必须先进入 Inbox，用户接受后才可以写入知识图谱。
`;

const ANCHOR_TEXTS = [
  '标注只是出处，知识点才是用户综合后的判断',
  '关系自身也需要证据，否则图谱会退化为无来源的断言',
  'supports, refutes, specializes, generalizes',
  'CRDT 🔒 本地优先让私有知识可以离线编辑',
  'W3C TextQuoteSelector 和 TextPositionSelector 一起用于重定位',
  '用户接受后才可以写入知识图谱',
];

const CASES = [
  {
    name: 'prepend-intro',
    text: `> 版本迁移：新增导言不会破坏旧标注。\n\n${ORIGINAL}`,
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'append-section-and-minor-copyedit',
    text: ORIGINAL.replace('无来源的断言', '缺来源的断言') + '\n## Review\n\n新增复习段落不会改变既有锚点。',
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'heading-rename-and-paragraph-insert',
    text: ORIGINAL
      .replace('## Local First', '## Local-first Notes')
      .replace('Reader 重新打开时必须', '新增一段上下文。\n\nReader 重新打开时必须'),
    anchorable: ANCHOR_TEXTS,
  },
  {
    name: 'intentional-orphan',
    text: ORIGINAL.replace('AI 建议必须先进入 Inbox，用户接受后才可以写入知识图谱。', 'AI 建议被删除后应该进入 orphan 状态。'),
    anchorable: ANCHOR_TEXTS.filter((text) => text !== '用户接受后才可以写入知识图谱'),
    orphan: ['用户接受后才可以写入知识图谱'],
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

const anchorable = results.filter((r) => r.expected === 'anchored_or_soft');
const recalled = anchorable.filter((r) => r.state === 'anchored' || r.state === 'soft_anchored');
const deliberateOrphans = results.filter((r) => r.expected === 'orphan');
const orphanMatches = deliberateOrphans.filter((r) => r.state === 'orphan');
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
  console.log('Atlas R1 Anchoring Recall — Markdown Version Corpus');
  console.log('===================================================');
  console.log(`anchorable=${anchorable.length} recalled=${recalled.length} recall=${fmtPct(recall)} min=${fmtPct(minRecall)}`);
  console.log(`deliberate_orphans=${deliberateOrphans.length} matched=${orphanMatches.length}`);
  console.log('');
  for (const row of results) {
    console.log(`${row.case.padEnd(30)} ${row.state.padEnd(13)} ${row.score.toFixed(3)}  ${row.exact}`);
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
      type: 'CssSelector',
      value: '[data-atlas-reader]',
    },
  ];
}

function anchor(newText, selectorList) {
  const quote = selectorList.find((s) => s.type === 'TextQuoteSelector');
  const position = selectorList.find((s) => s.type === 'TextPositionSelector');
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
    if (arg === '--min-recall') parsed.minRecall = raw[++i];
  }
  return parsed;
}
