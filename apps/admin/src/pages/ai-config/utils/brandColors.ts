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
  hunyuan: {
    primary: '#0052d9', // Tencent Blue
    gradientFrom: '#0052d9',
    gradientTo: '#003cab',
  },
  taichu: {
    primary: '#1890ff', // Tech Blue
    gradientFrom: '#1890ff',
    gradientTo: '#096dd9',
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
  groq: {
    primary: '#f55036', // Groq Orange
    gradientFrom: '#f55036',
    gradientTo: '#d9442b',
  },
  together: {
    primary: '#0f6fff', // Together Blue
    gradientFrom: '#0f6fff',
    gradientTo: '#0a56cc',
  },
  fireworks: {
    primary: '#f43f5e', // Fireworks Rose
    gradientFrom: '#f43f5e',
    gradientTo: '#e11d48',
  },
  openrouter: {
    primary: '#7c3aed', // OpenRouter Violet
    gradientFrom: '#7c3aed',
    gradientTo: '#5b21b6',
  },
  novita: {
    primary: '#8b5cf6', // Novita Violet
    gradientFrom: '#8b5cf6',
    gradientTo: '#7c3aed',
  },
  siliconflow: {
    primary: '#2563eb', // SiliconFlow Blue
    gradientFrom: '#2563eb',
    gradientTo: '#1d4ed8',
  },
  upstage: {
    primary: '#f59e0b', // Upstage Amber
    gradientFrom: '#f59e0b',
    gradientTo: '#d97706',
  },
  vercel: {
    primary: '#000000', // Vercel Black
    gradientFrom: '#333333',
    gradientTo: '#000000',
  },
  nebius: {
    primary: '#7c3aed', // Nebius Purple
    gradientFrom: '#7c3aed',
    gradientTo: '#5b21b6',
  },
  cerebras: {
    primary: '#334155', // Cerebras Slate
    gradientFrom: '#334155',
    gradientTo: '#1e293b',
  },
  grok: {
    primary: '#000000', // X Black
    gradientFrom: '#1f2937',
    gradientTo: '#000000',
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
  if (normalizedCode.includes('groq')) return PROVIDER_BRAND_COLORS.groq;
  if (normalizedCode.includes('together')) return PROVIDER_BRAND_COLORS.together;
  if (normalizedCode.includes('taichu')) return PROVIDER_BRAND_COLORS.taichu;
  if (normalizedCode.includes('fireworks')) return PROVIDER_BRAND_COLORS.fireworks;
  if (normalizedCode.includes('siliconflow')) return PROVIDER_BRAND_COLORS.siliconflow;
  if (normalizedCode.includes('upstage')) return PROVIDER_BRAND_COLORS.upstage;
  if (normalizedCode.includes('vercel')) return PROVIDER_BRAND_COLORS.vercel;
  if (normalizedCode.includes('nebius')) return PROVIDER_BRAND_COLORS.nebius;
  if (normalizedCode.includes('cerebras')) return PROVIDER_BRAND_COLORS.cerebras;
  if (normalizedCode.includes('perplexity')) return PROVIDER_BRAND_COLORS.perplexity;
  if (normalizedCode.includes('mistral')) return PROVIDER_BRAND_COLORS.mistral;
  if (normalizedCode.includes('openrouter')) return PROVIDER_BRAND_COLORS.openrouter;

  return PROVIDER_BRAND_COLORS[normalizedCode] || DEFAULT_BRAND_COLOR;
}
