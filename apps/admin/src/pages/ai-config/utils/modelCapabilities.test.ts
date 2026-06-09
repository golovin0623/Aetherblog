import { describe, it, expect } from 'vitest';
import type { AiModel } from '@/services/aiProviderService';
import {
  buildModelCapabilities,
  resolveModelAbilities,
  resolveModelContextWindow,
  resolveModelMaxOutputTokens,
  resolveModelPricing,
  resolveModelSource,
} from './modelCapabilities';

function model(partial: Partial<AiModel> & { capabilities?: Record<string, unknown> } = {}): AiModel {
  return {
    id: 1,
    provider_id: 1,
    provider_code: 'p',
    model_id: 'm',
    model_type: 'chat',
    is_enabled: true,
    capabilities: {},
    ...partial,
  } as AiModel;
}

describe('resolveModelAbilities', () => {
  it('从规范 abilities 对象读取', () => {
    const a = resolveModelAbilities(model({ capabilities: { abilities: { vision: true, functionCall: true } } }));
    expect(a.vision).toBe(true);
    expect(a.functionCall).toBe(true);
  });

  it('兼容旧版扁平键（function_calling / web_search / image_generation）', () => {
    const a = resolveModelAbilities(
      model({ capabilities: { function_calling: true, web_search: true, image_generation: true } })
    );
    expect(a.functionCall).toBe(true);
    expect(a.search).toBe(true);
    expect(a.imageOutput).toBe(true);
  });

  it('兼容能力缩写字符串列表（"fc, vision"）', () => {
    const a = resolveModelAbilities(model({ capabilities: { ability: 'fc, vision' } }));
    expect(a.functionCall).toBe(true);
    expect(a.vision).toBe(true);
  });
});

describe('resolveModelPricing', () => {
  it('优先取 capabilities.pricing，缺失则回落顶层列价', () => {
    const p = resolveModelPricing(model({ input_cost_per_1m: 1.5, capabilities: { pricing: { output: 6 } } }));
    expect(p.output).toBe(6);
    expect(p.input).toBe(1.5); // 回落顶层
  });
});

describe('上下文窗口 / 最大输出回落', () => {
  it('顶层缺失时从 capabilities 多别名回落', () => {
    expect(resolveModelContextWindow(model({ capabilities: { contextWindowTokens: 200000 } }))).toBe(200000);
    expect(resolveModelMaxOutputTokens(model({ capabilities: { maxOutput: 8192 } }))).toBe(8192);
  });
});

describe('resolveModelSource', () => {
  it('默认 builtin', () => {
    expect(resolveModelSource(model())).toBe('builtin');
  });
  it('读取显式 source', () => {
    expect(resolveModelSource(model({ capabilities: { source: 'remote' } }))).toBe('remote');
  });
});

describe('buildModelCapabilities 往返', () => {
  it('写入 abilities 并镜像旧版扁平键', () => {
    const caps = buildModelCapabilities({
      abilities: { vision: true, functionCall: true },
    });
    expect((caps.abilities as Record<string, unknown>).vision).toBe(true);
    // 旧版镜像键，保证老消费方仍可读
    expect(caps.vision).toBe(true);
    expect(caps.function_calling).toBe(true);
  });

  it('保留 settings.disabledParams', () => {
    const caps = buildModelCapabilities({
      abilities: { reasoning: true },
      settings: { disabledParams: ['temperature', 'top_p'] },
    });
    const settings = caps.settings as Record<string, unknown>;
    expect(settings.disabledParams).toEqual(['temperature', 'top_p']);
  });

  it('空字符串 / 空数组不写入', () => {
    const caps = buildModelCapabilities({
      abilities: {},
      description: '',
      resolutions: [],
    });
    expect('description' in caps).toBe(false);
    expect('resolutions' in caps).toBe(false);
  });
});
