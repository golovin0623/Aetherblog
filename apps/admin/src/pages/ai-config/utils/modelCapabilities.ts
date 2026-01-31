import type { AiModel } from '@/services/aiProviderService';
import type { ModelAbility, ModelExtraCapabilities, ModelSettings, ModelConfig, ModelPricing } from '../types';

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAbilityFlags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).toLowerCase());
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s|]+/g)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export function getModelExtra(model: AiModel): ModelExtraCapabilities {
  const caps = (model.capabilities || {}) as ModelExtraCapabilities & Record<string, unknown>;
  const released = caps.released_at ?? (caps.releasedAt as string | undefined);
  if (released && !caps.released_at) {
    return { ...caps, released_at: released } as ModelExtraCapabilities;
  }
  return caps as ModelExtraCapabilities;
}

export function resolveModelAbilities(model: AiModel): ModelAbility {
  const caps = getModelExtra(model) as ModelExtraCapabilities & Record<string, unknown>;
  const abilities = caps.abilities || {};
  const legacy = caps as Record<string, unknown>;
  const abilityFlags = normalizeAbilityFlags(
    (legacy as Record<string, unknown>).ability ?? (legacy as Record<string, unknown>).abilities
  );
  const hasFlag = (flag: string) => abilityFlags.includes(flag);
  const flagFunctionCall = hasFlag('fc') || hasFlag('functioncall');
  const flagImageOutput = hasFlag('imageoutput') || hasFlag('image_output');
  const flagFiles = hasFlag('file') || hasFlag('files');
  const flagStructured = hasFlag('structuredoutput');

  return {
    functionCall:
      abilities.functionCall ??
      (legacy.function_calling as boolean) ??
      (legacy.function_call as boolean) ??
      flagFunctionCall,
    vision: abilities.vision ?? (legacy.vision as boolean) ?? hasFlag('vision'),
    reasoning: abilities.reasoning ?? (legacy.reasoning as boolean) ?? hasFlag('reasoning'),
    search: abilities.search ?? (legacy.web_search as boolean) ?? hasFlag('search'),
    imageOutput:
      abilities.imageOutput ?? (legacy.image_generation as boolean) ?? flagImageOutput,
    video: abilities.video ?? (legacy.video as boolean) ?? hasFlag('video'),
    files: abilities.files ?? (legacy.files as boolean) ?? flagFiles,
    structuredOutput:
      abilities.structuredOutput ?? (legacy.structured_output as boolean) ?? flagStructured,
  };
}

export function resolveModelSettings(model: AiModel): ModelSettings {
  const caps = getModelExtra(model);
  return caps.settings || {};
}

export function resolveModelConfig(model: AiModel): ModelConfig {
  const caps = getModelExtra(model);
  return caps.config || {};
}

export function resolveModelPricing(model: AiModel): ModelPricing {
  const caps = getModelExtra(model);
  return caps.pricing || {};
}

export function resolveModelContextWindow(model: AiModel): number | null {
  if (model.context_window) return model.context_window;
  const extra = getModelExtra(model) as Record<string, unknown>;
  return (
    parseNumber(extra.maxToken) ??
    parseNumber(extra.max_token) ??
    parseNumber(extra.contextWindow) ??
    parseNumber(extra.context_window)
  );
}

export function resolveModelMaxOutputTokens(model: AiModel): number | null {
  if (model.max_output_tokens) return model.max_output_tokens;
  const extra = getModelExtra(model) as Record<string, unknown>;
  return (
    parseNumber(extra.maxOutputTokens) ??
    parseNumber(extra.max_output_tokens) ??
    parseNumber(extra.maxOutput) ??
    parseNumber(extra.max_output)
  );
}

export function resolveModelSource(model: AiModel): ModelExtraCapabilities['source'] {
  const caps = getModelExtra(model) as ModelExtraCapabilities & Record<string, unknown>;
  return caps.source || (caps.source as ModelExtraCapabilities['source']) || 'builtin';
}

export function buildModelCapabilities(params: {
  abilities: ModelAbility;
  settings?: ModelSettings;
  config?: ModelConfig;
  pricing?: ModelPricing;
  parameters?: Record<string, unknown>;
  released_at?: string | null;
  source?: ModelExtraCapabilities['source'];
  maxToken?: number | null;
  maxOutputTokens?: number | null;
}): Record<string, unknown> {
  const { abilities, settings, config, pricing, parameters, released_at, source, maxToken, maxOutputTokens } = params;

  return {
    abilities,
    settings,
    config,
    pricing,
    parameters,
    released_at: released_at || undefined,
    source,
    maxToken: maxToken || undefined,
    maxOutputTokens: maxOutputTokens || undefined,
    maxOutput: maxOutputTokens || undefined,
    // legacy keys for compatibility
    vision: abilities.vision,
    reasoning: abilities.reasoning,
    web_search: abilities.search,
    image_generation: abilities.imageOutput,
    function_calling: abilities.functionCall,
  };
}
