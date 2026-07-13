import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const selectSource = readFileSync(new URL('./Select.tsx', import.meta.url), 'utf8');

test('Select exposes a stable combobox to listbox ownership contract', () => {
  assert.match(selectSource, /React\.useId\(\)/);
  assert.match(selectSource, /aria-controls=\{isOpen \? listboxId : undefined\}/);
  assert.match(selectSource, /aria-activedescendant=\{activeOptionId\}/);
  assert.match(selectSource, /id=\{listboxId\}[\s\S]*?role="listbox"/);
});

test('Select exposes only a valid open option as the active descendant', () => {
  assert.match(
    selectSource,
    /const activeOptionId =[\s\S]*?isOpen[\s\S]*?!activeOption\.disabled[\s\S]*?getOptionId\(activeIndex\)/
  );
  assert.match(selectSource, /id=\{getOptionId\(i\)\}[\s\S]*?role="option"/);
});

test('Select flattens structural list wrappers without losing option semantics', () => {
  assert.match(selectSource, /<ul role="none"/);
  assert.match(selectSource, /<li role="none" key=\{opt\.value\}>/);
  assert.match(selectSource, /role="option"[\s\S]*?aria-selected=\{isSelected\}/);
  assert.match(selectSource, /aria-selected=\{isSelected\}[\s\S]*?disabled=\{opt\.disabled\}/);
});
