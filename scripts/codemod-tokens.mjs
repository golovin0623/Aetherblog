#!/usr/bin/env node
/**
 * AetherBlog · Design System Codemod
 * -------------------------------------------------------------
 * 读取 .claude/design-system/deprecations.json,对工程代码执行:
 *
 *   pnpm design-system:check   只扫描,列出违例,不改文件(CI 默认)
 *   pnpm design-system:fix     按 deprecations.rules[i].replace 做自动替换
 *   pnpm design-system:report  输出 Markdown 报告到 stdout,便于写入 PR
 *
 * 无第三方依赖,纯 Node 20 + fs.glob 实现,目标 < 0.5s 完成全量扫。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { glob } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const deprecationsPath = resolve(repoRoot, '.claude/design-system/deprecations.json');

const mode = process.argv[2] || 'check';
const validModes = ['check', 'fix', 'report'];
if (!validModes.includes(mode)) {
  console.error(`Usage: codemod-tokens.mjs <${validModes.join('|')}>`);
  process.exit(2);
}

const deprecations = JSON.parse(await readFile(deprecationsPath, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const sunsetDate = deprecations.sunsetDate;
const daysToSunset = Math.ceil(
  (new Date(sunsetDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
);

/**
 * 把 deprecations.json 中的 glob 列表展开为文件路径,去重。
 * fs.promises.glob (Node 20.12+) 是懒惰迭代器,需 for await 实际消费。
 */
async function collectFiles(patterns) {
  const seen = new Set();
  for (const pattern of patterns) {
    // 去掉前缀斜杠,glob 相对 cwd 解析
    const norm = pattern.replace(/^\//, '');
    for await (const p of glob(norm, { cwd: repoRoot })) {
      // 跳过 node_modules / .next / dist / build
      if (/node_modules|\.next|dist|build|\.turbo/.test(p)) continue;
      seen.add(resolve(repoRoot, p));
    }
  }
  return [...seen];
}

const severityRank = { error: 3, warning: 2, info: 1 };
const totals = { error: 0, warning: 0, info: 0, filesScanned: 0, filesChanged: 0 };
const perRule = new Map(); // ruleId -> {count, files:Set, hits:[]}
const violations = []; // {file, rule, line, snippet}

for (const rule of deprecations.rules) {
  perRule.set(rule.id, { count: 0, files: new Set(), hits: [], severity: rule.severity });
}

for (const rule of deprecations.rules) {
  const files = await collectFiles(rule.match.files);
  const regex = new RegExp(rule.match.pattern, 'gm');

  for (const file of files) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    const matches = [...content.matchAll(regex)];
    if (matches.length === 0) continue;

    const stats = perRule.get(rule.id);
    stats.count += matches.length;
    stats.files.add(file);
    totals[rule.severity] += matches.length;

    for (const m of matches) {
      const before = content.slice(0, m.index);
      const line = before.split('\n').length;
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = content.indexOf('\n', m.index);
      const snippet = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
      violations.push({
        file: relative(repoRoot, file),
        rule: rule.id,
        severity: rule.severity,
        line,
        snippet: snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet,
      });
      // report 模式限量
      if (stats.hits.length < 6) stats.hits.push({ file: relative(repoRoot, file), line, snippet });
    }

    // fix 模式:按 replace map 做全文替换(仅限简单一对一字符串替换规则)
    if (mode === 'fix' && rule.replace && typeof rule.replace === 'object') {
      let next = content;
      let mutated = false;
      for (const [from, to] of Object.entries(rule.replace)) {
        // 转义字符串为字面量匹配(非正则)
        const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(esc, 'g');
        if (re.test(next)) {
          next = next.replace(re, to);
          mutated = true;
        }
      }
      if (mutated) {
        await writeFile(file, next, 'utf8');
        totals.filesChanged += 1;
      }
    }
  }

  totals.filesScanned += files.length;
}

// --------- Output ---------
if (mode === 'report') {
  console.log(`# Design System Deprecations Report\n`);
  console.log(`- Generated: ${today}`);
  console.log(`- Sunset date: ${sunsetDate} (${daysToSunset} days remaining)`);
  console.log(`- Total violations: ${violations.length}`);
  console.log(`  - errors: ${totals.error}`);
  console.log(`  - warnings: ${totals.warning}`);
  console.log(`  - info: ${totals.info}\n`);

  for (const rule of deprecations.rules) {
    const stats = perRule.get(rule.id);
    if (stats.count === 0) continue;
    console.log(`## \`${rule.id}\` · ${rule.severity.toUpperCase()} · ${stats.count} hit${stats.count === 1 ? '' : 's'} in ${stats.files.size} file${stats.files.size === 1 ? '' : 's'}`);
    console.log(`\n> ${rule.note}\n`);
    for (const hit of stats.hits) {
      console.log(`- \`${hit.file}:${hit.line}\` — \`${hit.snippet}\``);
    }
    if (stats.count > stats.hits.length) {
      console.log(`- …and ${stats.count - stats.hits.length} more`);
    }
    console.log();
  }
  process.exit(0);
}

// check / fix 模式:文本汇总
const maxRuleLen = Math.max(...[...perRule.keys()].map((k) => k.length));
console.log('');
console.log(`AetherBlog Design System · Deprecations ${mode.toUpperCase()}`);
console.log(`  Sunset: ${sunsetDate}  (T-${daysToSunset}d)`);
console.log(`  Scanned ${totals.filesScanned} files  ·  Changed ${totals.filesChanged} files`);
console.log('');

const sortedRules = [...perRule.entries()].sort(
  (a, b) => severityRank[b[1].severity] - severityRank[a[1].severity] || b[1].count - a[1].count,
);

for (const [ruleId, stats] of sortedRules) {
  const pad = ruleId.padEnd(maxRuleLen, ' ');
  const tag =
    stats.severity === 'error' ? 'ERR ' :
    stats.severity === 'warning' ? 'WARN' : 'INFO';
  console.log(`  [${tag}] ${pad}  ${String(stats.count).padStart(4)} hits in ${stats.files.size} files`);
}

console.log('');
console.log(`  Totals: ${totals.error} errors · ${totals.warning} warnings · ${totals.info} info`);
console.log('');

// fix mode 追加提示
if (mode === 'fix') {
  console.log(`  ✓ Applied replacements in ${totals.filesChanged} files.`);
  console.log(`    Rules without a "replace" map cannot be auto-fixed — see report.`);
  console.log('');
}

// CI 策略:仅 error 级别阻断 CI。warning / info 透传。
if (totals.error > 0) {
  console.error(`  ✗ ${totals.error} error-level deprecation(s) found — this commit should not land.`);
  process.exit(1);
}
process.exit(0);
