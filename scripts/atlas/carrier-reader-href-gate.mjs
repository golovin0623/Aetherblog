#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = new URL('../../apps/admin/src/pages/atlas/carrierReaderHref.ts', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
});

const module = { exports: {} };
vm.runInNewContext(transpiled.outputText, { exports: module.exports, module }, { filename: sourcePath.pathname });

const { carrierReaderHref } = module.exports;
const carrier = (type, id = 42, sourceUri = `${type}://source`) => ({ id, type, sourceUri });

const cases = [
  { name: 'note markdown carrier', input: carrier('markdown', 12, 'notes://34'), expected: '/atlas/reader/note/34' },
  { name: 'non-note markdown carrier', input: carrier('markdown', 12, 'imports://readwise/1'), expected: null },
  { name: 'pdf carrier', input: carrier('pdf'), expected: '/atlas/reader/pdf/42' },
  { name: 'web carrier', input: carrier('web'), expected: '/atlas/reader/web/42' },
  { name: 'blog post carrier', input: carrier('blog_post'), expected: '/atlas/reader/blog-post/42' },
  { name: 'video transcript carrier', input: carrier('video'), expected: '/atlas/reader/transcript/42' },
  { name: 'audio transcript carrier', input: carrier('audio'), expected: '/atlas/reader/transcript/42' },
  { name: 'image carrier', input: carrier('image'), expected: '/atlas/reader/image/42' },
  { name: 'unsupported epub carrier', input: carrier('epub'), expected: null },
];

for (const testCase of cases) {
  assert.equal(carrierReaderHref(testCase.input), testCase.expected, testCase.name);
}

console.log(`[carrier-reader-href-gate] passed ${cases.length}/${cases.length} cases`);
