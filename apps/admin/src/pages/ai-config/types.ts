// AI 配置中心共享类型定义
// ref: §5.1 - AI Service 架构

import type {
  AiProvider,
  AiModel,
  AiCredential,
  AiTaskType,
  AiRouting,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateModelRequest,
  UpdateModelRequest,
  CreateCredentialRequest,
  RoutingUpdateRequest,
} from '@/services/aiProviderService';

// 重新导出服务层类型
export type {
  AiProvider,
  AiModel,
  AiCredential,
  AiTaskType,
  AiRouting,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateModelRequest,
  UpdateModelRequest,
  CreateCredentialRequest,
  RoutingUpdateRequest,
};

// 模型类型枚举
export const MODEL_TYPES = [
  { value: 'chat', label: '对话' },
  { value: 'embedding', label: '向量化' },
  { value: 'image', label: '图片' },
  { value: 'tts', label: 'TTS' },
  { value: 'stt', label: 'STT' },
  { value: 'realtime', label: '实时' },
  { value: 'text2video', label: '视频' },
  { value: 'text2music', label: '音乐' },
] as const;

export type ModelType = (typeof MODEL_TYPES)[number]['value'];

// 供应商 API 类型
export const PROVIDER_TYPES = [
  { value: 'openai_compat', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'custom', label: '自定义' },
] as const;

export type ProviderApiType = (typeof PROVIDER_TYPES)[number]['value'];

// 视图状态
export type ViewMode = 'grid' | 'detail';

// 供应商排序状态
export interface ProviderSortItem {
  id: number;
  code: string;
  name: string;
  priority: number;
}

// 模型筛选选项
export interface ModelFilterOptions {
  providerCode?: string;
  modelType?: ModelType | 'all';
  enabledOnly?: boolean;
  search?: string;
}

export type ModelAbility = {
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  imageOutput?: boolean;
  video?: boolean;
  functionCall?: boolean;
  files?: boolean;
  structuredOutput?: boolean;
};

export type ModelSettings = {
  extendParams?: string[];
  searchImpl?: 'tool' | 'params' | 'internal';
  searchProvider?: string;
};

export type ModelConfig = {
  deploymentName?: string;
};

export type ModelPricing = {
  currency?: 'USD' | 'CNY';
  input?: number;
  output?: number;
  audioInput?: number;
  audioOutput?: number;
  cachedInput?: number;
  cachedAudioInput?: number;
};

export type ModelExtraCapabilities = {
  abilities?: ModelAbility;
  settings?: ModelSettings;
  config?: ModelConfig;
  pricing?: ModelPricing;
  parameters?: Record<string, unknown>;
  released_at?: string;
  source?: 'builtin' | 'custom' | 'remote';
};

// 连通性测试结果
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
}

// 预设供应商配置 (带 Logo/默认设置)
export interface PresetProvider {
  code: string;
  name: string;
  displayName: string;
  icon: string;
  apiType: ProviderApiType;
  baseUrl?: string;
  docUrl?: string;
  description?: string;
}

// 官方预设供应商列表
export const PRESET_PROVIDERS: PresetProvider[] = [
  {
    code: 'openai',
    name: 'OpenAI',
    displayName: 'OpenAI',
    icon: '🤖',
    apiType: 'openai_compat',
    baseUrl: 'https://api.openai.com/v1',
    docUrl: 'https://platform.openai.com/docs',
    description: 'GPT-4o, GPT-4, GPT-3.5 等模型',
  },
  {
    code: 'anthropic',
    name: 'Anthropic',
    displayName: 'Anthropic',
    icon: '🧠',
    apiType: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    docUrl: 'https://docs.anthropic.com',
    description: 'Claude 3.5 Sonnet, Claude 3 Opus 等模型',
  },
  {
    code: 'google',
    name: 'Google',
    displayName: 'Google',
    icon: '🔮',
    apiType: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    docUrl: 'https://ai.google.dev/docs',
    description: 'Gemini 2.0, Gemini 1.5 等模型',
  },
  {
    code: 'deepseek',
    name: 'DeepSeek',
    displayName: 'DeepSeek',
    icon: '🌊',
    apiType: 'openai_compat',
    baseUrl: 'https://api.deepseek.com',
    docUrl: 'https://platform.deepseek.com/api-docs',
    description: 'DeepSeek-V3, DeepSeek-R1 等模型',
  },
  {
    code: 'azure',
    name: 'Azure OpenAI',
    displayName: 'Azure OpenAI',
    icon: '☁️',
    apiType: 'azure',
    docUrl: 'https://learn.microsoft.com/azure/ai-services/openai',
    description: 'Azure 托管的 OpenAI 模型',
  },
  {
    code: 'ollama',
    name: 'Ollama',
    displayName: 'Ollama',
    icon: '🦙',
    apiType: 'openai_compat',
    baseUrl: 'http://localhost:11434/v1',
    docUrl: 'https://ollama.com',
    description: '本地运行的开源模型',
  },
  {
    code: 'moonshot',
    name: 'Moonshot',
    displayName: '月之暗面',
    icon: '🌙',
    apiType: 'openai_compat',
    baseUrl: 'https://api.moonshot.cn/v1',
    docUrl: 'https://platform.moonshot.cn/docs',
    description: 'Kimi 系列模型',
  },
  {
    code: 'zhipu',
    name: 'Zhipu',
    displayName: '智谱 AI',
    icon: '🔷',
    apiType: 'openai_compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docUrl: 'https://open.bigmodel.cn/dev/api',
    description: 'GLM-4 系列模型',
  },
  {
    code: 'qwen',
    name: 'Qwen',
    displayName: '通义千问',
    icon: '🌈',
    apiType: 'openai_compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docUrl: 'https://help.aliyun.com/zh/dashscope',
    description: 'Qwen 系列模型',
  },
];

// 获取预设供应商图标
export function getProviderIcon(code: string): string {
  const preset = PRESET_PROVIDERS.find((p) => p.code === code);
  return preset?.icon || '🔌';
}

// 获取预设供应商信息
export function getPresetProvider(code: string): PresetProvider | undefined {
  return PRESET_PROVIDERS.find((p) => p.code === code);
}
