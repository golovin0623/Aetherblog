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

test('Select consumes Escape so a parent sheet or dialog does not close with it', () => {
  assert.match(
    selectSource,
    /case 'Escape':[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?setIsOpen\(false\);/
  );
});

test('Select closes its portalled listbox when a higher-priority overlay opens', () => {
  assert.match(selectSource, /SELECT_OVERLAY_CLOSE_EVENT = 'aetherblog:close-select-overlays'/);
  assert.match(selectSource, /window\.addEventListener\(SELECT_OVERLAY_CLOSE_EVENT, closeForOverlay\)/);
  assert.match(selectSource, /window\.removeEventListener\(SELECT_OVERLAY_CLOSE_EVENT, closeForOverlay\)/);
});
