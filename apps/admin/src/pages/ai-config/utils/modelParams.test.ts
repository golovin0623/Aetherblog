import { describe, it, expect } from 'vitest';
import {
  PARAM_CONTROLS,
  PARAM_GROUPS,
  SAMPLING_PARAMS,
  getParamControl,
  groupParamControls,
  recommendedParamIds,
} from './modelParams';

describe('参数控件目录完整性', () => {
  it('每个控件的 group 都在 PARAM_GROUPS 中声明', () => {
    const groupKeys = new Set(PARAM_GROUPS.map((g) => g.key));
    for (const control of PARAM_CONTROLS) {
      expect(groupKeys.has(control.group)).toBe(true);
    }
  });

  it('控件 id 唯一', () => {
    const ids = PARAM_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('采样参数恰为 4 个标准项', () => {
    expect(SAMPLING_PARAMS.map((p) => p.id).sort()).toEqual([
      'frequency_penalty',
      'presence_penalty',
      'temperature',
      'top_p',
    ]);
  });
});

describe('groupParamControls', () => {
  it('未选任何项时仍返回目录分组（custom 分组为空被过滤）', () => {
    const sections = groupParamControls([], null);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => s.group.key !== 'custom')).toBe(true);
  });

  it('已选项被标记 selected', () => {
    const sections = groupParamControls(['reasoningEffort'], null);
    const all = sections.flatMap((s) => s.controls);
    const target = all.find((c) => c.id === 'reasoningEffort');
    expect(target?.selected).toBe(true);
  });

  it('目录外的自定义已选项归入 custom 分组且不丢失', () => {
    const sections = groupParamControls(['gpt5_2ProReasoningEffort'], null);
    const custom = sections.find((s) => s.group.key === 'custom');
    expect(custom).toBeDefined();
    expect(custom!.controls[0].id).toBe('gpt5_2ProReasoningEffort');
    expect(custom!.controls[0].selected).toBe(true);
  });

  it('依据 reasoning 能力标注推荐项', () => {
    const sections = groupParamControls([], { reasoning: true });
    const all = sections.flatMap((s) => s.controls);
    const effort = all.find((c) => c.id === 'reasoningEffort');
    expect(effort?.recommended).toBe(true);
  });
});

describe('recommendedParamIds', () => {
  it('无能力时为空集', () => {
    expect(recommendedParamIds(null).size).toBe(0);
    expect(recommendedParamIds({}).size).toBe(0);
  });

  it('imageOutput → 推荐图像比例/分辨率', () => {
    const ids = recommendedParamIds({ imageOutput: true });
    expect(ids.has('imageAspectRatio')).toBe(true);
    expect(ids.has('imageResolution')).toBe(true);
  });

  it('多能力叠加合并推荐集', () => {
    const ids = recommendedParamIds({ reasoning: true, search: true });
    expect(ids.has('reasoningEffort')).toBe(true);
    expect(ids.has('urlContext')).toBe(true);
  });
});

describe('getParamControl', () => {
  it('命中目录返回控件', () => {
    expect(getParamControl('thinkingBudget')?.group).toBe('thinking');
  });
  it('未知 id 返回 undefined', () => {
    expect(getParamControl('nope')).toBeUndefined();
  });
});
