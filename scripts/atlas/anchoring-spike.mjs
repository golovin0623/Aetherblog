#!/usr/bin/env node
// Atlas Phase 0 锚定鲁棒性 spike
//
// 目的：在中文 + Markdown 场景下验证 W3C TextQuoteSelector + 模糊匹配 + 向量回退的召回率，
//      决定 D1（编辑器栈）是否需要升级到 Y.RelativePosition 双轨。
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 0 task-knowledge-P0-08
// 决策记录: docs/plan/task-knowledge-decisions.md §Spike-1
//
// 实现说明：
//   * 本 spike 不依赖任何 npm 包，纯 Node 内置 API。
//   * 使用简化版的"prefix 模糊查找 + 编辑距离阈值"作为锚定回退，
//     近似 Hypothes.is 的 Bitap+Myers diff 行为。**正式实现** Phase 1 必须
//     使用 diff-match-patch（已添加进 Phase 1 任务 P1-07）。
//
// 用法：
//   node scripts/atlas/anchoring-spike.mjs            # 默认 10 段 × 50 锚定 × 100 编辑
//   node scripts/atlas/anchoring-spike.mjs --json     # 输出机器可读 JSON
//   node scripts/atlas/anchoring-spike.mjs --seed 42  # 固定随机种子

import { argv, stdout } from 'node:process';

const ARGS = parseArgs(argv.slice(2));
const SEED = ARGS.seed ?? 1729;
const NUM_ANCHORS = ARGS.anchors ?? 50;
const SOFT_THRESHOLD = 0.85;
const HARD_THRESHOLD = 0.5;
// 真实 PKM 场景下用户编辑强度分布:
//   light  = 拼写更正 / 改个别字 (5 次编辑)
//   medium = 一段重写 / 加几句话 (20 次编辑)
//   heavy  = 大改一整段 (60 次编辑)
const EDIT_PROFILES = [
  { name: 'light', edits: 5 },
  { name: 'medium', edits: 20 },
  { name: 'heavy', edits: 60 },
];

// ============================================================
// 测试文本 —— 学术 / 技术 / 散文 各 3-4 段，全部中文 + 部分英文 + Markdown 标记
// ============================================================
const TEXTS = [
  `# 系统1与系统2\n\n卡尼曼在《思考，快与慢》中提出了认知双系统理论：系统1是直觉、快速、自动的，系统2是审慎、缓慢、需要努力的。两者并非互相独立，而是协同工作——系统1先给出印象与直觉，系统2在被需要时介入校验。日常 80% 以上的决策由系统1完成。`,
  `## 知识图谱的关系类型\n\nSKOS 标准提供了 broader / narrower / related 三种基础关系，ConceptNet 扩展到 36 种语义关系（IsA, PartOf, Causes, HasContext 等）。对个人 PKM 系统，9 种最小集已经足够覆盖 80% 场景：supports, refutes, specializes, generalizes, precedes, causes, similar_to, cites, instance_of。`,
  `### W3C Web Annotation Data Model\n\nWADM 2017 年成为 W3C Recommendation。它规定每条标注是 {body, target} 二元组，target 通过 SpecificResource 引用多个 Selector。Selector 的关键设计是可组合：refinedBy 串联（先用 XPath 定位元素，再用 TextPosition 定位字符），列表形式并列（任意一个解析成功即可）。`,
  `Hypothes.is 的 Robust Anchoring 算法分为四档：先用 TextPositionSelector 精确定位；失败则用 prefix+suffix 的 Bitap 模糊搜索；候选区域文本与 quote.exact 的 Myers diff 距离低于阈值即接受；全部失败则回退到向量相似度。这是 W3C 多选择器哲学在工程上的具体实现。`,
  `WhisperX 的词级时间戳精度被市场宣传严重夸大。vendor 博客（localaimaster, clore.ai）宣称 ±50ms，但 Bain et al. 原论文 arXiv:2303.00747 的评估使用 200ms collar：For all evaluations we use a collar value of 200 milliseconds to account for differences in annotation and models。生产中应该把对齐当作高质量近似，允许用户手动微调。`,
  `Microsoft Research 的 GraphRAG 用 LLM 自动从文本抽取实体 + 关系 + 主张，再用 Leiden 算法做层级社区聚类。Edge et al. 论文 arXiv:2404.16130 在 VIINA 数据集上用 LLM 评判员做成对比较显示 GraphRAG 在综合性维度赢得 72-83% 对比局。注意这些胜率来自 LLM 评判员而非人类判断，可能存在 self-preference bias。`,
  `Tana 的 supertag + field 是当前类型化关系工程实现最务实的方案。每个节点有类型，类型决定字段，关系自身也是带类型的对象。与 Notion 的硬 database 相比更灵活；与 Anytype 把所有东西强制对象化的认知门槛相比更轻量。AETHERBLOG Atlas 在 Phase 2 内置 5 种默认 supertag 覆盖 80% 场景，自定义为高级功能。`,
  `Yjs 的 RelativePosition 把位置绑定到 CRDT 内部的不可变 itemID（clientID, clock 二元组），无论后续插入/删除多少字符都不会失效。代价是必须用 CRDT 编辑流而不是裸字符串编辑。这是 local-first 协作场景下唯一确定性的迁移方案——但跨工具互操作性差，导出时仍需降级为 W3C 选择器。`,
  `> 知识点是用户综合后的产物，标注只是它的出处证据。一个知识点可以被多个标注佐证，可以被支持、反驳、特例化。把高亮等同于知识点是 Readwise 类工具的根本局限——结果是大量"标了但从未回看"的死亡数据。`,
  `本地优先 (local-first) 已成为 PKM 的伦理底线。Anytype, Logseq, Obsidian, Reflect 都采用本地存储 + 端到端加密 + CRDT 同步。Reflect 甚至把 embedding 计算放在客户端以保持端到端加密。Roam 的中心化云架构是它衰落的核心原因之一。`,
];

// ============================================================
// 简化版伪随机
// ============================================================
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ============================================================
// 编辑距离（Levenshtein）
// ============================================================
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
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

// ============================================================
// 制作 TextQuoteSelector
// ============================================================
function makeAnchor(text, pos, length, ctxSize = 30) {
  const start = pos;
  const end = pos + length;
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ctxSize), start),
    suffix: text.slice(end, Math.min(text.length, end + ctxSize)),
    originalStart: start,
    originalEnd: end,
  };
}

// ============================================================
// 锚定回退：位置→上下文模糊→编辑距离
// ============================================================
function tryAnchor(quote, newText) {
  // 档1：直接搜 exact
  const idx = newText.indexOf(quote.exact);
  if (idx !== -1) {
    return { state: 'anchored', score: 1.0, position: idx };
  }

  // 档2：在 prefix 附近的窗口里搜
  const prefixIdx = quote.prefix.length > 5 ? newText.indexOf(quote.prefix) : -1;
  if (prefixIdx !== -1) {
    const candidateStart = prefixIdx + quote.prefix.length;
    const candidate = newText.slice(candidateStart, candidateStart + quote.exact.length);
    const sim = similarity(candidate, quote.exact);
    if (sim >= SOFT_THRESHOLD) {
      return { state: 'soft_anchored', score: sim, position: candidateStart };
    }
  }

  // 档3：滑窗 + 编辑距离最优匹配
  let bestSim = 0;
  let bestPos = -1;
  const winLen = quote.exact.length;
  const step = Math.max(1, Math.floor(winLen / 8));
  for (let i = 0; i + winLen <= newText.length; i += step) {
    const slice = newText.slice(i, i + winLen);
    const sim = similarity(slice, quote.exact);
    if (sim > bestSim) {
      bestSim = sim;
      bestPos = i;
    }
  }
  if (bestSim >= SOFT_THRESHOLD) {
    return { state: 'soft_anchored', score: bestSim, position: bestPos };
  }
  if (bestSim >= HARD_THRESHOLD) {
    return { state: 'orphan', score: bestSim, position: bestPos };
  }
  return { state: 'orphan', score: bestSim, position: -1 };
}

// ============================================================
// 随机编辑
// ============================================================
function randomEdit(text, rand) {
  if (text.length < 5) return text;
  const op = rand();
  const pos = Math.floor(rand() * text.length);
  const len = 1 + Math.floor(rand() * 3);
  const charset = '的一是了在不和有大这中人上为来个个就要也时';
  const filler = Array.from({ length: len }, () => charset[Math.floor(rand() * charset.length)]).join('');
  if (op < 0.4) {
    return text.slice(0, pos) + filler + text.slice(pos);
  } else if (op < 0.7) {
    return text.slice(0, pos) + text.slice(pos + len);
  } else {
    return text.slice(0, pos) + filler + text.slice(pos + len);
  }
}

// ============================================================
// 跑 spike
// ============================================================
function runSpikeForProfile(profile) {
  const rand = rng(SEED + profile.edits); // profile-specific seed
  const counters = { anchored: 0, soft_anchored: 0, orphan: 0, total: 0 };

  TEXTS.forEach((origText) => {
    if (origText.length < 60) return;

    // 锚点长度 20-80 字（真实高亮）
    const anchors = [];
    for (let i = 0; i < NUM_ANCHORS; i++) {
      const len = 20 + Math.floor(rand() * 60);
      if (origText.length < len + 60) continue;
      const pos = 30 + Math.floor(rand() * (origText.length - len - 60));
      anchors.push(makeAnchor(origText, pos, len));
    }

    let editedText = origText;
    for (let e = 0; e < profile.edits; e++) {
      editedText = randomEdit(editedText, rand);
    }

    for (const a of anchors) {
      const result = tryAnchor(a, editedText);
      counters[result.state]++;
      counters.total++;
    }
  });

  return counters;
}

function runSpike() {
  return EDIT_PROFILES.map((p) => ({ profile: p.name, edits: p.edits, ...runSpikeForProfile(p) }));
}

// ============================================================
// 输出
// ============================================================
function fmtPct(n, total) {
  if (!total) return '0.00%';
  return ((n / total) * 100).toFixed(2) + '%';
}

function main() {
  const results = runSpike();

  if (ARGS.json) {
    stdout.write(
      JSON.stringify(
        {
          seed: SEED,
          numAnchors: NUM_ANCHORS,
          editProfiles: EDIT_PROFILES,
          results: results.map((r) => ({
            ...r,
            recall: (r.anchored + r.soft_anchored) / r.total,
          })),
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  console.log('Atlas 锚定鲁棒性 Spike — Phase 0 (中文 / Markdown)');
  console.log('================================================');
  console.log(`seed=${SEED}  texts=${TEXTS.length}  anchors/text=${NUM_ANCHORS}`);
  console.log(`SOFT_THRESHOLD = ${SOFT_THRESHOLD}  HARD_THRESHOLD = ${HARD_THRESHOLD}`);
  console.log('');
  console.log('编辑强度 -> anchored / soft_anchored / orphan / recall');
  console.log('-'.repeat(70));

  for (const r of results) {
    const { profile, edits, anchored, soft_anchored, orphan, total } = r;
    const recall = (anchored + soft_anchored) / total;
    console.log(
      `${profile.padEnd(8)} (${String(edits).padStart(2)} edits)  ` +
        `${fmtPct(anchored, total).padStart(7)} / ` +
        `${fmtPct(soft_anchored, total).padStart(7)} / ` +
        `${fmtPct(orphan, total).padStart(7)} / ` +
        `recall=${fmtPct(anchored + soft_anchored, total)}`
    );
  }

  console.log('');
  console.log('结论指引（手册 §0.2 R1 红线 = 90%）:');
  const lightRecall = (results[0].anchored + results[0].soft_anchored) / results[0].total;
  const mediumRecall = (results[1].anchored + results[1].soft_anchored) / results[1].total;
  console.log(`  · light(5 edits)  recall=${fmtPct(results[0].anchored + results[0].soft_anchored, results[0].total)} → ${lightRecall >= 0.9 ? '✓ 达标' : '✗ 不达标'}`);
  console.log(`  · medium(20)      recall=${fmtPct(results[1].anchored + results[1].soft_anchored, results[1].total)} → ${mediumRecall >= 0.7 ? '✓ 可接受' : '✗ 偏低'}`);
  console.log('  · heavy(60) 仅供参考，真实场景罕见 60 次乱编辑');
  console.log('');
  if (lightRecall >= 0.9) {
    console.log('  D1 决策: 保守路径足够（CodeMirror + W3C 单轨 + 模糊回退）');
  } else if (lightRecall >= 0.7) {
    console.log('  D1 决策: 进入 Phase 1，Phase 1 末必须复测；Tiptap+Yjs 不必现在引入');
  } else {
    console.log('  D1 决策: 锚定栈需要升级 —— 评估 diff-match-patch 或直接上 Y.RelativePosition');
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--edits') out.edits = Number(argv[++i]);
    else if (a === '--anchors') out.anchors = Number(argv[++i]);
  }
  return out;
}

main();
