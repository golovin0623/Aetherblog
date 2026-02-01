export interface BrandColor {
  primary: string;
  gradientFrom: string;
  gradientTo: string;
}

export const PROVIDER_BRAND_COLORS: Record<string, BrandColor> = {
  openai: {
    primary: '#10a37f', // OpenAI Green
    gradientFrom: '#10a37f',
    gradientTo: '#0d8c6d',
  },
  azure: {
    primary: '#0078d4', // Azure Blue
    gradientFrom: '#0078d4',
    gradientTo: '#005a9e',
  },
  google: {
    primary: '#4285f4', // Google Blue
    gradientFrom: '#4285f4',
    gradientTo: '#34a853', // Blue to Green
  },
  anthropic: {
    primary: '#da7756', // Claude Clay
    gradientFrom: '#da7756',
    gradientTo: '#b95e3e',
  },
  deepseek: {
    primary: '#4d6bfe', // DeepSeek Blue
    gradientFrom: '#4d6bfe',
    gradientTo: '#2b45d4',
  },
  moonshot: {
    primary: '#6b7280', // Moonshot (Using a neutral grey as they are often just B&W)
    gradientFrom: '#374151',
    gradientTo: '#111827',
  },
  zhipu: {
    primary: '#3b82f6', // GLM Blue
    gradientFrom: '#3b82f6',
    gradientTo: '#1d4ed8',
  },
  yi: {
    primary: '#00bfa5', // Yi Teal
    gradientFrom: '#00bfa5',
    gradientTo: '#00897b',
  },
  qwen: {
    primary: '#615ced', // Qwen Purple/Blue
    gradientFrom: '#615ced',
    gradientTo: '#4a44c9',
  },
  minimax: {
    primary: '#db2777', // Minimax Pink/Red
    gradientFrom: '#db2777',
    gradientTo: '#be185d',
  },
  wenxin: {
    primary: '#2932e1', // Baidu Blue
    gradientFrom: '#2932e1',
    gradientTo: '#1c23a0',
  },
  hundyuan: {
    primary: '#0052d9', // Tencent Blue
    gradientFrom: '#0052d9',
    gradientTo: '#003cab',
  },
  ollama: {
    primary: '#000000', // Ollama Black/White
    gradientFrom: '#333333',
    gradientTo: '#000000',
  },
  perplexity: {
    primary: '#22bfa0', // Perplexity Teal
    gradientFrom: '#22bfa0',
    gradientTo: '#168f76',
  },
  mistral: {
    primary: '#f59e0b', // Mistral Orange/Yellow
    gradientFrom: '#f59e0b',
    gradientTo: '#d97706',
  },
  grok: {
    primary: '#000000', // X Black
    gradientFrom: '#1f2937',
    gradientTo: '#000000',
  },
  openrouter: {
    primary: '#7c3aed', // OpenRouter Violet
    gradientFrom: '#7c3aed',
    gradientTo: '#5b21b6',
  },
};

export const DEFAULT_BRAND_COLOR: BrandColor = {
  primary: '#64748b', // Slate 500
  gradientFrom: '#64748b',
  gradientTo: '#475569',
};

export function getProviderBrand(code: string): BrandColor {
  const normalizedCode = code.toLowerCase().replace(/[-_\s]/g, '');
  // Try exact match first, then partial match or alias handling if needed
  // specific checks for common aliases
  if (normalizedCode.includes('openai')) return PROVIDER_BRAND_COLORS.openai;
  if (normalizedCode.includes('azure')) return PROVIDER_BRAND_COLORS.azure;
  if (normalizedCode.includes('google') || normalizedCode.includes('gemini')) return PROVIDER_BRAND_COLORS.google;
  if (normalizedCode.includes('anthropic') || normalizedCode.includes('claude')) return PROVIDER_BRAND_COLORS.anthropic;
  if (normalizedCode.includes('deepseek')) return PROVIDER_BRAND_COLORS.deepseek;
  if (normalizedCode.includes('moonshot') || normalizedCode.includes('kimi')) return PROVIDER_BRAND_COLORS.moonshot;
  if (normalizedCode.includes('zhipu') || normalizedCode.includes('glm')) return PROVIDER_BRAND_COLORS.zhipu;
  if (normalizedCode.includes('tongyi') || normalizedCode.includes('qwen') || normalizedCode.includes('alibaba')) return PROVIDER_BRAND_COLORS.qwen;
  if (normalizedCode.includes('yi') || normalizedCode.includes('lingyi')) return PROVIDER_BRAND_COLORS.yi;
  if (normalizedCode.includes('ollama')) return PROVIDER_BRAND_COLORS.ollama;

  return PROVIDER_BRAND_COLORS[normalizedCode] || DEFAULT_BRAND_COLOR;
}
