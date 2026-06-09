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

// 可被「屏蔽」的标准采样参数 —— 某些推理模型不接受这些参数，调用时需省略
export type SamplingParam = 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty';

export type ModelSettings = {
  extendParams?: string[];
  searchImpl?: 'tool' | 'params' | 'internal';
  searchProvider?: string;
  // 调用该模型时需省略的采样参数（如 o 系列推理模型不支持自定义 temperature）
  disabledParams?: SamplingParam[];
};

export type ModelConfig = {
  deploymentName?: string;
  enabledSearch?: boolean;
};

export type ModelPricing = {
  currency?: 'USD' | 'CNY';
  input?: number;
  output?: number;
  audioInput?: number;
  audioOutput?: number;
  cachedInput?: number;
  cachedAudioInput?: number;
  // 缓存写入价（首次写入 KV 缓存的单价，区别于命中缓存的读取价 cachedInput）
  writeCacheInput?: number;
  // 多模态分项单价（每 1M / 每张，按 units 细分时使用）
  imageInput?: number;
  imageOutput?: number;
  videoInput?: number;
  units?: unknown[];
};

export type ModelExtraCapabilities = {
  abilities?: ModelAbility;
  settings?: ModelSettings;
  config?: ModelConfig;
  pricing?: ModelPricing;
  parameters?: Record<string, unknown>;
  released_at?: string;
  description?: string;
  legacy?: boolean;
  organization?: string;
  maxDimension?: number;
  resolutions?: string[];
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
  apiKeyUrl?: string;
  modelsUrl?: string;
  url?: string;
  checkModel?: string;
  settings?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  priority?: number;
}

// 官方预设供应商列表
export const PRESET_PROVIDERS: PresetProvider[] = [
  {
    "code": "openai",
    "name": "OpenAI",
    "displayName": "OpenAI",
    "icon": "🤖",
    "apiType": "openai_compat",
    "baseUrl": "https://api.openai.com/v1",
    "docUrl": "https://platform.openai.com/docs/models",
    "description": "OpenAI 是全球领先的人工智能研究机构，其开发的模型如GPT系列推动了自然语言处理的前沿。OpenAI 致力于通过创新和高效的AI解决方案改变多个行业。他们的产品具有显著的性能和经济性，广泛用于研究、商业和创新应用。",
    "apiKeyUrl": "https://platform.openai.com/api-keys",
    "modelsUrl": "https://platform.openai.com/docs/models",
    "url": "https://openai.com",
    "checkModel": "gpt-5-nano",
    "settings": {
      "responseAnimation": "smooth",
      "showModelFetcher": true,
      "supportResponsesApi": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "OpenAI 是全球领先的人工智能研究机构，其开发的模型如GPT系列推动了自然语言处理的前沿。OpenAI 致力于通过创新和高效的AI解决方案改变多个行业。他们的产品具有显著的性能和经济性，广泛用于研究、商业和创新应用。",
      "apiKeyUrl": "https://platform.openai.com/api-keys",
      "modelsUrl": "https://platform.openai.com/docs/models",
      "url": "https://openai.com",
      "settings": {
        "responseAnimation": "smooth",
        "showModelFetcher": true,
        "supportResponsesApi": true
      },
      "checkModel": "gpt-5-nano"
    },
    "priority": 1000
  },
  {
    "code": "azure",
    "name": "Azure OpenAI",
    "displayName": "Azure OpenAI",
    "icon": "☁️",
    "apiType": "azure",
    "docUrl": "https://learn.microsoft.com/azure/ai-services/openai/concepts/models",
    "description": "Azure 提供多种先进的AI模型，包括GPT-3.5和最新的GPT-4系列，支持多种数据类型和复杂任务，致力于安全、可靠和可持续的AI解决方案。",
    "modelsUrl": "https://learn.microsoft.com/azure/ai-services/openai/concepts/models",
    "url": "https://azure.microsoft.com",
    "settings": {
      "defaultShowBrowserRequest": true,
      "sdkType": "azure",
      "showDeployName": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Azure 提供多种先进的AI模型，包括GPT-3.5和最新的GPT-4系列，支持多种数据类型和复杂任务，致力于安全、可靠和可持续的AI解决方案。",
      "modelsUrl": "https://learn.microsoft.com/azure/ai-services/openai/concepts/models",
      "url": "https://azure.microsoft.com",
      "settings": {
        "defaultShowBrowserRequest": true,
        "sdkType": "azure",
        "showDeployName": true
      }
    },
    "priority": 999
  },
  {
    "code": "azureai",
    "name": "Azure AI",
    "displayName": "Azure AI",
    "icon": "☁️",
    "apiType": "azure",
    "docUrl": "https://ai.azure.com/explore/models",
    "description": "Azure 提供多种先进的AI模型，包括GPT-3.5和最新的GPT-4系列，支持多种数据类型和复杂任务，致力于安全、可靠和可持续的AI解决方案。",
    "modelsUrl": "https://ai.azure.com/explore/models",
    "url": "https://ai.azure.com",
    "settings": {
      "defaultShowBrowserRequest": true,
      "sdkType": "azureai",
      "showDeployName": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Azure 提供多种先进的AI模型，包括GPT-3.5和最新的GPT-4系列，支持多种数据类型和复杂任务，致力于安全、可靠和可持续的AI解决方案。",
      "modelsUrl": "https://ai.azure.com/explore/models",
      "url": "https://ai.azure.com",
      "settings": {
        "defaultShowBrowserRequest": true,
        "sdkType": "azureai",
        "showDeployName": true
      }
    },
    "priority": 998
  },
  {
    "code": "ollama",
    "name": "Ollama",
    "displayName": "Ollama",
    "icon": "🦙",
    "apiType": "openai_compat",
    "baseUrl": "http://localhost:11434/v1",
    "docUrl": "https://ollama.com/library",
    "description": "Ollama 提供的模型广泛涵盖代码生成、数学运算、多语种处理和对话互动等领域，支持企业级和本地化部署的多样化需求。",
    "modelsUrl": "https://ollama.com/library",
    "url": "https://ollama.com",
    "checkModel": "deepseek-r1",
    "settings": {
      "defaultShowBrowserRequest": true,
      "sdkType": "ollama",
      "showApiKey": false,
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Ollama 提供的模型广泛涵盖代码生成、数学运算、多语种处理和对话互动等领域，支持企业级和本地化部署的多样化需求。",
      "modelsUrl": "https://ollama.com/library",
      "url": "https://ollama.com",
      "settings": {
        "defaultShowBrowserRequest": true,
        "sdkType": "ollama",
        "showApiKey": false,
        "showModelFetcher": true
      },
      "checkModel": "deepseek-r1"
    },
    "priority": 997
  },
  {
    "code": "ollamacloud",
    "name": "Ollama Cloud",
    "displayName": "Ollama Cloud",
    "icon": "☁️",
    "apiType": "openai_compat",
    "docUrl": "https://ollama.com/library",
    "description": "Ollama Cloud 提供官方托管的推理服务，开箱即用地访问 Ollama 模型库，并支持 OpenAI 兼容接口。",
    "modelsUrl": "https://ollama.com/library",
    "url": "https://ollama.com/cloud",
    "checkModel": "gpt-oss:20b",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Ollama Cloud 提供官方托管的推理服务，开箱即用地访问 Ollama 模型库，并支持 OpenAI 兼容接口。",
      "modelsUrl": "https://ollama.com/library",
      "url": "https://ollama.com/cloud",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "gpt-oss:20b"
    },
    "priority": 996
  },
  {
    "code": "vllm",
    "name": "vLLM",
    "displayName": "vLLM",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "http://localhost:8000/v1",
    "docUrl": "https://docs.vllm.ai/en/latest/models/supported_models.html#supported-models",
    "description": "vLLM 是一个快速且易于使用的库，用于 LLM 推理和服务。",
    "modelsUrl": "https://docs.vllm.ai/en/latest/models/supported_models.html#supported-models",
    "url": "https://docs.vllm.ai",
    "settings": {
      "proxyUrl": {
        "placeholder": "http://localhost:8000/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "vLLM 是一个快速且易于使用的库，用于 LLM 推理和服务。",
      "modelsUrl": "https://docs.vllm.ai/en/latest/models/supported_models.html#supported-models",
      "url": "https://docs.vllm.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "http://localhost:8000/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      }
    },
    "priority": 995
  },
  {
    "code": "comfyui",
    "name": "ComfyUI",
    "displayName": "ComfyUI",
    "icon": "🔌",
    "apiType": "custom",
    "docUrl": "https://www.comfy.org/",
    "description": "强大的开源图像、视频、音频生成工作流引擎，支持 SD FLUX Qwen Hunyuan WAN 等先进模型，提供节点化工作流编辑和私有化部署能力",
    "url": "https://www.comfy.org/",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "comfyui",
      "showAddNewModel": false,
      "showApiKey": true,
      "showChecker": false,
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "强大的开源图像、视频、音频生成工作流引擎，支持 SD FLUX Qwen Hunyuan WAN 等先进模型，提供节点化工作流编辑和私有化部署能力",
      "url": "https://www.comfy.org/",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "comfyui",
        "showAddNewModel": false,
        "showApiKey": true,
        "showChecker": false,
        "showModelFetcher": false
      }
    },
    "priority": 994
  },
  {
    "code": "xinference",
    "name": "Xinference",
    "displayName": "Xinference",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "http://localhost:9997/v1",
    "docUrl": "https://inference.readthedocs.io/zh-cn/latest/models/builtin/index.html",
    "description": "Xorbits Inference (Xinference) 是一个开源平台，用于简化各种 AI 模型的运行和集成。借助 Xinference，您可以使用任何开源 LLM、嵌入模型和多模态模型在云端或本地环境中运行推理，并创建强大的 AI 应用。",
    "modelsUrl": "https://inference.readthedocs.io/zh-cn/latest/models/builtin/index.html",
    "url": "https://inference.readthedocs.io/zh-cn/v0.12.3/index.html",
    "settings": {
      "proxyUrl": {
        "placeholder": "http://localhost:9997/v1"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "Xorbits Inference (Xinference) 是一个开源平台，用于简化各种 AI 模型的运行和集成。借助 Xinference，您可以使用任何开源 LLM、嵌入模型和多模态模型在云端或本地环境中运行推理，并创建强大的 AI 应用。",
      "modelsUrl": "https://inference.readthedocs.io/zh-cn/latest/models/builtin/index.html",
      "url": "https://inference.readthedocs.io/zh-cn/v0.12.3/index.html",
      "settings": {
        "proxyUrl": {
          "placeholder": "http://localhost:9997/v1"
        },
        "sdkType": "openai"
      }
    },
    "priority": 993
  },
  {
    "code": "anthropic",
    "name": "Anthropic",
    "displayName": "Anthropic",
    "icon": "🧠",
    "apiType": "anthropic",
    "baseUrl": "https://api.anthropic.com",
    "docUrl": "https://docs.anthropic.com/en/docs/about-claude/models#model-names",
    "description": "Anthropic 是一家专注于人工智能研究和开发的公司，提供了一系列先进的语言模型，如 Claude 3.5 Sonnet、Claude 3 Sonnet、Claude 3 Opus 和 Claude 3 Haiku。这些模型在智能、速度和成本之间取得了理想的平衡，适用于从企业级工作负载到快速响应的各种应用场景。Claude 3.5 Sonnet 作为其最新模型，在多项评估中表现优异，同时保持了较高的性价比。",
    "modelsUrl": "https://docs.anthropic.com/en/docs/about-claude/models#model-names",
    "url": "https://anthropic.com",
    "checkModel": "claude-3-haiku-20240307",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.anthropic.com"
      },
      "responseAnimation": "smooth",
      "sdkType": "anthropic",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Anthropic 是一家专注于人工智能研究和开发的公司，提供了一系列先进的语言模型，如 Claude 3.5 Sonnet、Claude 3 Sonnet、Claude 3 Opus 和 Claude 3 Haiku。这些模型在智能、速度和成本之间取得了理想的平衡，适用于从企业级工作负载到快速响应的各种应用场景。Claude 3.5 Sonnet 作为其最新模型，在多项评估中表现优异，同时保持了较高的性价比。",
      "modelsUrl": "https://docs.anthropic.com/en/docs/about-claude/models#model-names",
      "url": "https://anthropic.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.anthropic.com"
        },
        "responseAnimation": "smooth",
        "sdkType": "anthropic",
        "showModelFetcher": true
      },
      "checkModel": "claude-3-haiku-20240307"
    },
    "priority": 992
  },
  {
    "code": "bedrock",
    "name": "Bedrock",
    "displayName": "Bedrock",
    "icon": "🔌",
    "apiType": "custom",
    "docUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html",
    "description": "Bedrock 是亚马逊 AWS 提供的一项服务，专注于为企业提供先进的 AI 语言模型和视觉模型。其模型家族包括 Anthropic 的 Claude 系列、Meta 的 Llama 3.1 系列等，涵盖从轻量级到高性能的多种选择，支持文本生成、对话、图像处理等多种任务，适用于不同规模和需求的企业应用。",
    "modelsUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html",
    "url": "https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html",
    "checkModel": "anthropic.claude-instant-v1",
    "settings": {
      "sdkType": "bedrock"
    },
    "capabilities": {
      "source": "builtin",
      "description": "Bedrock 是亚马逊 AWS 提供的一项服务，专注于为企业提供先进的 AI 语言模型和视觉模型。其模型家族包括 Anthropic 的 Claude 系列、Meta 的 Llama 3.1 系列等，涵盖从轻量级到高性能的多种选择，支持文本生成、对话、图像处理等多种任务，适用于不同规模和需求的企业应用。",
      "modelsUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html",
      "url": "https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html",
      "settings": {
        "sdkType": "bedrock"
      },
      "checkModel": "anthropic.claude-instant-v1"
    },
    "priority": 991
  },
  {
    "code": "google",
    "name": "Google",
    "displayName": "Google",
    "icon": "🔮",
    "apiType": "google",
    "baseUrl": "https://generativelanguage.googleapis.com",
    "docUrl": "https://ai.google.dev/gemini-api/docs/models/gemini",
    "description": "Google 的 Gemini 系列是其最先进、通用的 AI模型，由 Google DeepMind 打造，专为多模态设计，支持文本、代码、图像、音频和视频的无缝理解与处理。适用于从数据中心到移动设备的多种环境，极大提升了AI模型的效率与应用广泛性。",
    "modelsUrl": "https://ai.google.dev/gemini-api/docs/models/gemini",
    "url": "https://ai.google.dev",
    "checkModel": "gemini-2.0-flash",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://generativelanguage.googleapis.com"
      },
      "responseAnimation": {
        "speed": 50,
        "text": "smooth"
      },
      "sdkType": "google",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Google 的 Gemini 系列是其最先进、通用的 AI模型，由 Google DeepMind 打造，专为多模态设计，支持文本、代码、图像、音频和视频的无缝理解与处理。适用于从数据中心到移动设备的多种环境，极大提升了AI模型的效率与应用广泛性。",
      "modelsUrl": "https://ai.google.dev/gemini-api/docs/models/gemini",
      "url": "https://ai.google.dev",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://generativelanguage.googleapis.com"
        },
        "responseAnimation": {
          "speed": 50,
          "text": "smooth"
        },
        "sdkType": "google",
        "showModelFetcher": true
      },
      "checkModel": "gemini-2.0-flash"
    },
    "priority": 990
  },
  {
    "code": "vertexai",
    "name": "Vertex AI",
    "displayName": "Vertex AI",
    "icon": "🔌",
    "apiType": "google",
    "docUrl": "https://console.cloud.google.com/vertex-ai/model-garden",
    "description": "Google 的 Gemini 系列是其最先进、通用的 AI模型，由 Google DeepMind 打造，专为多模态设计，支持文本、代码、图像、音频和视频的无缝理解与处理。适用于从数据中心到移动设备的多种环境，极大提升了AI模型的效率与应用广泛性。",
    "modelsUrl": "https://console.cloud.google.com/vertex-ai/model-garden",
    "url": "https://cloud.google.com/vertex-ai",
    "checkModel": "gemini-1.5-flash-001",
    "settings": {
      "disableBrowserRequest": true,
      "responseAnimation": "smooth",
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "Google 的 Gemini 系列是其最先进、通用的 AI模型，由 Google DeepMind 打造，专为多模态设计，支持文本、代码、图像、音频和视频的无缝理解与处理。适用于从数据中心到移动设备的多种环境，极大提升了AI模型的效率与应用广泛性。",
      "modelsUrl": "https://console.cloud.google.com/vertex-ai/model-garden",
      "url": "https://cloud.google.com/vertex-ai",
      "settings": {
        "disableBrowserRequest": true,
        "responseAnimation": "smooth",
        "showModelFetcher": false
      },
      "checkModel": "gemini-1.5-flash-001"
    },
    "priority": 989
  },
  {
    "code": "deepseek",
    "name": "DeepSeek",
    "displayName": "DeepSeek",
    "icon": "🌊",
    "apiType": "openai_compat",
    "baseUrl": "https://api.deepseek.com",
    "docUrl": "https://platform.deepseek.com/api-docs/zh-cn/quick_start/pricing",
    "description": "DeepSeek 是一家专注于人工智能技术研究和应用的公司，其最新模型 DeepSeek-V3 多项评测成绩超越 Qwen2.5-72B 和 Llama-3.1-405B 等开源模型，性能对齐领军闭源模型 GPT-4o 与 Claude-3.5-Sonnet。",
    "modelsUrl": "https://platform.deepseek.com/api-docs/zh-cn/quick_start/pricing",
    "url": "https://deepseek.com",
    "checkModel": "deepseek-chat",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.deepseek.com"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "DeepSeek 是一家专注于人工智能技术研究和应用的公司，其最新模型 DeepSeek-V3 多项评测成绩超越 Qwen2.5-72B 和 Llama-3.1-405B 等开源模型，性能对齐领军闭源模型 GPT-4o 与 Claude-3.5-Sonnet。",
      "modelsUrl": "https://platform.deepseek.com/api-docs/zh-cn/quick_start/pricing",
      "url": "https://deepseek.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.deepseek.com"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "deepseek-chat"
    },
    "priority": 988
  },
  {
    "code": "moonshot",
    "name": "Moonshot",
    "displayName": "Moonshot",
    "icon": "🌙",
    "apiType": "openai_compat",
    "baseUrl": "https://api.moonshot.cn/v1",
    "docUrl": "https://platform.moonshot.cn/docs/intro",
    "description": "Moonshot 是由北京月之暗面科技有限公司推出的开源平台，提供多种自然语言处理模型，应用领域广泛，包括但不限于内容创作、学术研究、智能推荐、医疗诊断等，支持长文本处理和复杂生成任务。",
    "modelsUrl": "https://platform.moonshot.cn/docs/intro",
    "url": "https://www.moonshot.cn",
    "checkModel": "kimi-latest",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.moonshot.cn/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Moonshot 是由北京月之暗面科技有限公司推出的开源平台，提供多种自然语言处理模型，应用领域广泛，包括但不限于内容创作、学术研究、智能推荐、医疗诊断等，支持长文本处理和复杂生成任务。",
      "modelsUrl": "https://platform.moonshot.cn/docs/intro",
      "url": "https://www.moonshot.cn",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.moonshot.cn/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "kimi-latest"
    },
    "priority": 987
  },
  {
    "code": "aihubmix",
    "name": "AiHubMix",
    "displayName": "AiHubMix",
    "icon": "🧰",
    "apiType": "openai_compat",
    "docUrl": "https://docs.aihubmix.com/cn/api/Model-List",
    "description": "AiHubMix 通过统一的 API 接口提供对多种 AI 模型的访问。",
    "apiKeyUrl": "https://lobe.li/9mZhb4T",
    "modelsUrl": "https://docs.aihubmix.com/cn/api/Model-List",
    "url": "https://aihubmix.com",
    "checkModel": "gpt-4.1-nano",
    "settings": {
      "sdkType": "router",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "AiHubMix 通过统一的 API 接口提供对多种 AI 模型的访问。",
      "apiKeyUrl": "https://lobe.li/9mZhb4T",
      "modelsUrl": "https://docs.aihubmix.com/cn/api/Model-List",
      "url": "https://aihubmix.com",
      "settings": {
        "sdkType": "router",
        "showModelFetcher": true
      },
      "checkModel": "gpt-4.1-nano"
    },
    "priority": 986
  },
  {
    "code": "openrouter",
    "name": "OpenRouter",
    "displayName": "OpenRouter",
    "icon": "🧭",
    "apiType": "openai_compat",
    "baseUrl": "https://openrouter.ai/api/v1",
    "docUrl": "https://openrouter.ai/models",
    "description": "OpenRouter 是一个提供多种前沿大模型接口的服务平台，支持 OpenAI、Anthropic、LLaMA 及更多，适合多样化的开发和应用需求。用户可根据自身需求灵活选择最优的模型和价格，助力AI体验的提升。",
    "modelsUrl": "https://openrouter.ai/models",
    "url": "https://openrouter.ai",
    "checkModel": "google/gemma-2-9b-it:free",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://openrouter.ai/api/v1"
      },
      "sdkType": "openai",
      "searchMode": "params",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "OpenRouter 是一个提供多种前沿大模型接口的服务平台，支持 OpenAI、Anthropic、LLaMA 及更多，适合多样化的开发和应用需求。用户可根据自身需求灵活选择最优的模型和价格，助力AI体验的提升。",
      "modelsUrl": "https://openrouter.ai/models",
      "url": "https://openrouter.ai",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://openrouter.ai/api/v1"
        },
        "sdkType": "openai",
        "searchMode": "params",
        "showModelFetcher": true
      },
      "checkModel": "google/gemma-2-9b-it:free"
    },
    "priority": 985
  },
  {
    "code": "fal",
    "name": "Fal",
    "displayName": "Fal",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://fal.ai",
    "description": "面向开发者的生成式媒体平台",
    "url": "https://fal.ai",
    "settings": {
      "disableBrowserRequest": true,
      "showAddNewModel": false,
      "showChecker": false,
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "面向开发者的生成式媒体平台",
      "url": "https://fal.ai",
      "settings": {
        "disableBrowserRequest": true,
        "showAddNewModel": false,
        "showChecker": false,
        "showModelFetcher": false
      }
    },
    "priority": 984
  },
  {
    "code": "huggingface",
    "name": "HuggingFace",
    "displayName": "HuggingFace",
    "icon": "🤗",
    "apiType": "custom",
    "docUrl": "https://huggingface.co/docs/api-inference/en/supported-models",
    "description": "HuggingFace Inference API 提供了一种快速且免费的方式，让您可以探索成千上万种模型，适用于各种任务。无论您是在为新应用程序进行原型设计，还是在尝试机器学习的功能，这个 API 都能让您即时访问多个领域的高性能模型。",
    "apiKeyUrl": "https://huggingface.co/settings/tokens",
    "modelsUrl": "https://huggingface.co/docs/api-inference/en/supported-models",
    "url": "https://huggingface.co",
    "checkModel": "mistralai/Mistral-7B-Instruct-v0.2",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "huggingface",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "HuggingFace Inference API 提供了一种快速且免费的方式，让您可以探索成千上万种模型，适用于各种任务。无论您是在为新应用程序进行原型设计，还是在尝试机器学习的功能，这个 API 都能让您即时访问多个领域的高性能模型。",
      "apiKeyUrl": "https://huggingface.co/settings/tokens",
      "modelsUrl": "https://huggingface.co/docs/api-inference/en/supported-models",
      "url": "https://huggingface.co",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "huggingface",
        "showModelFetcher": true
      },
      "checkModel": "mistralai/Mistral-7B-Instruct-v0.2"
    },
    "priority": 983
  },
  {
    "code": "cloudflare",
    "name": "Cloudflare Workers AI",
    "displayName": "Cloudflare Workers AI",
    "icon": "🔌",
    "apiType": "custom",
    "docUrl": "https://developers.cloudflare.com/workers-ai/models",
    "description": "在 Cloudflare 的全球网络上运行由无服务器 GPU 驱动的机器学习模型。",
    "url": "https://developers.cloudflare.com/workers-ai/models",
    "checkModel": "@hf/meta-llama/meta-llama-3-8b-instruct",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "cloudflare",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "在 Cloudflare 的全球网络上运行由无服务器 GPU 驱动的机器学习模型。",
      "url": "https://developers.cloudflare.com/workers-ai/models",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "cloudflare",
        "showModelFetcher": true
      },
      "checkModel": "@hf/meta-llama/meta-llama-3-8b-instruct"
    },
    "priority": 982
  },
  {
    "code": "github",
    "name": "GitHub",
    "displayName": "GitHub",
    "icon": "🔌",
    "apiType": "azure",
    "docUrl": "https://github.com/marketplace/models",
    "description": "通过GitHub模型，开发人员可以成为AI工程师，并使用行业领先的AI模型进行构建。",
    "url": "https://github.com/marketplace/models",
    "checkModel": "microsoft/Phi-3-mini-4k-instruct",
    "settings": {
      "sdkType": "azure",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "通过GitHub模型，开发人员可以成为AI工程师，并使用行业领先的AI模型进行构建。",
      "url": "https://github.com/marketplace/models",
      "settings": {
        "sdkType": "azure",
        "showModelFetcher": true
      },
      "checkModel": "microsoft/Phi-3-mini-4k-instruct"
    },
    "priority": 981
  },
  {
    "code": "newapi",
    "name": "New API",
    "displayName": "New API",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://your.new-api-provider.com",
    "docUrl": "https://github.com/Calcium-Ion/new-api",
    "description": "开源的多个 AI 服务聚合统一转发平台",
    "url": "https://github.com/Calcium-Ion/new-api",
    "checkModel": "gpt-4o-mini",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://your.new-api-provider.com"
      },
      "sdkType": "router",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "开源的多个 AI 服务聚合统一转发平台",
      "url": "https://github.com/Calcium-Ion/new-api",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://your.new-api-provider.com"
        },
        "sdkType": "router",
        "showModelFetcher": true
      },
      "checkModel": "gpt-4o-mini"
    },
    "priority": 980
  },
  {
    "code": "bfl",
    "name": "Black Forest Labs",
    "displayName": "Black Forest Labs",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://bfl.ai/",
    "description": "领先的前沿人工智能研究实验室，构建明日的视觉基础设施。",
    "url": "https://bfl.ai/",
    "settings": {
      "disableBrowserRequest": true,
      "showAddNewModel": false,
      "showChecker": false,
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "领先的前沿人工智能研究实验室，构建明日的视觉基础设施。",
      "url": "https://bfl.ai/",
      "settings": {
        "disableBrowserRequest": true,
        "showAddNewModel": false,
        "showChecker": false,
        "showModelFetcher": false
      }
    },
    "priority": 979
  },
  {
    "code": "novita",
    "name": "Novita",
    "displayName": "Novita",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.novita.ai/v3/openai",
    "docUrl": "https://novita.ai/model-api/product/llm-api",
    "description": "Novita AI 是一个提供多种大语言模型与 AI 图像生成的 API 服务的平台，灵活、可靠且具有成本效益。它支持 Llama3、Mistral 等最新的开源模型，并为生成式 AI 应用开发提供了全面、用户友好且自动扩展的 API 解决方案，适合 AI 初创公司的快速发展。",
    "modelsUrl": "https://novita.ai/model-api/product/llm-api",
    "url": "https://novita.ai",
    "checkModel": "meta-llama/llama-3.1-8b-instruct",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.novita.ai/v3/openai"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Novita AI 是一个提供多种大语言模型与 AI 图像生成的 API 服务的平台，灵活、可靠且具有成本效益。它支持 Llama3、Mistral 等最新的开源模型，并为生成式 AI 应用开发提供了全面、用户友好且自动扩展的 API 解决方案，适合 AI 初创公司的快速发展。",
      "modelsUrl": "https://novita.ai/model-api/product/llm-api",
      "url": "https://novita.ai",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.novita.ai/v3/openai"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "meta-llama/llama-3.1-8b-instruct"
    },
    "priority": 978
  },
  {
    "code": "ppio",
    "name": "PPIO",
    "displayName": "PPIO",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://ppinfra.com/llm-api?utm_source=github_lobe-chat&utm_medium=github_readme&utm_campaign=link",
    "description": "PPIO 派欧云提供稳定、高性价比的开源模型 API 服务，支持 DeepSeek 全系列、Llama、Qwen 等行业领先大模型。",
    "modelsUrl": "https://ppinfra.com/llm-api?utm_source=github_lobe-chat&utm_medium=github_readme&utm_campaign=link",
    "url": "https://ppinfra.com/user/register",
    "checkModel": "deepseek/deepseek-r1-distill-qwen-32b",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "PPIO 派欧云提供稳定、高性价比的开源模型 API 服务，支持 DeepSeek 全系列、Llama、Qwen 等行业领先大模型。",
      "modelsUrl": "https://ppinfra.com/llm-api?utm_source=github_lobe-chat&utm_medium=github_readme&utm_campaign=link",
      "url": "https://ppinfra.com/user/register",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "deepseek/deepseek-r1-distill-qwen-32b"
    },
    "priority": 977
  },
  {
    "code": "ai302",
    "name": "302.AI",
    "displayName": "302.AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.302.ai/v1",
    "docUrl": "https://302.ai/pricing/",
    "description": "302.AI 是一个按需付费的 AI 应用平台，提供市面上最全的 AI API 和 AI 在线应用",
    "apiKeyUrl": "https://lobe.li/Oizw5sN",
    "modelsUrl": "https://302.ai/pricing/",
    "url": "https://302.ai",
    "checkModel": "gpt-4o",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.302.ai/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "302.AI 是一个按需付费的 AI 应用平台，提供市面上最全的 AI API 和 AI 在线应用",
      "apiKeyUrl": "https://lobe.li/Oizw5sN",
      "modelsUrl": "https://302.ai/pricing/",
      "url": "https://302.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.302.ai/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "gpt-4o"
    },
    "priority": 976
  },
  {
    "code": "nvidia",
    "name": "Nvidia",
    "displayName": "Nvidia",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "docUrl": "https://build.nvidia.com/models",
    "description": "NVIDIA NIM™ 提供容器，可用于自托管 GPU 加速推理微服务，支持在云端、数据中心、RTX™ AI 个人电脑和工作站上部署预训练和自定义 AI 模型。",
    "modelsUrl": "https://build.nvidia.com/models",
    "url": "https://build.nvidia.com",
    "checkModel": "meta/llama-3.2-1b-instruct",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://integrate.api.nvidia.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "NVIDIA NIM™ 提供容器，可用于自托管 GPU 加速推理微服务，支持在云端、数据中心、RTX™ AI 个人电脑和工作站上部署预训练和自定义 AI 模型。",
      "modelsUrl": "https://build.nvidia.com/models",
      "url": "https://build.nvidia.com",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://integrate.api.nvidia.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "meta/llama-3.2-1b-instruct"
    },
    "priority": 975
  },
  {
    "code": "togetherai",
    "name": "Together AI",
    "displayName": "Together AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.together.xyz/v1",
    "docUrl": "https://docs.together.ai/docs/chat-models",
    "description": "Together AI 致力于通过创新的 AI 模型实现领先的性能，提供广泛的自定义能力，包括快速扩展支持和直观的部署流程，满足企业的各种需求。",
    "modelsUrl": "https://docs.together.ai/docs/chat-models",
    "url": "https://www.together.ai",
    "checkModel": "meta-llama/Llama-Vision-Free",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.together.xyz/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Together AI 致力于通过创新的 AI 模型实现领先的性能，提供广泛的自定义能力，包括快速扩展支持和直观的部署流程，满足企业的各种需求。",
      "modelsUrl": "https://docs.together.ai/docs/chat-models",
      "url": "https://www.together.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.together.xyz/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "meta-llama/Llama-Vision-Free"
    },
    "priority": 974
  },
  {
    "code": "fireworksai",
    "name": "Fireworks AI",
    "displayName": "Fireworks AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "docUrl": "https://fireworks.ai/models?show=Serverless",
    "description": "Fireworks AI 是一家领先的高级语言模型服务商，专注于功能调用和多模态处理。其最新模型 Firefunction V2 基于 Llama-3，优化用于函数调用、对话及指令跟随。视觉语言模型 FireLLaVA-13B 支持图像和文本混合输入。其他 notable 模型包括 Llama 系列和 Mixtral 系列，提供高效的多语言指令跟随与生成支持。",
    "modelsUrl": "https://fireworks.ai/models?show=Serverless",
    "url": "https://fireworks.ai",
    "checkModel": "accounts/fireworks/models/llama-v3p2-3b-instruct",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.fireworks.ai/inference/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Fireworks AI 是一家领先的高级语言模型服务商，专注于功能调用和多模态处理。其最新模型 Firefunction V2 基于 Llama-3，优化用于函数调用、对话及指令跟随。视觉语言模型 FireLLaVA-13B 支持图像和文本混合输入。其他 notable 模型包括 Llama 系列和 Mixtral 系列，提供高效的多语言指令跟随与生成支持。",
      "modelsUrl": "https://fireworks.ai/models?show=Serverless",
      "url": "https://fireworks.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.fireworks.ai/inference/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "accounts/fireworks/models/llama-v3p2-3b-instruct"
    },
    "priority": 973
  },
  {
    "code": "groq",
    "name": "Groq",
    "displayName": "Groq",
    "icon": "⚡",
    "apiType": "openai_compat",
    "baseUrl": "https://api.groq.com/openai/v1",
    "docUrl": "https://console.groq.com/docs/models",
    "description": "Groq 的 LPU 推理引擎在最新的独立大语言模型（LLM）基准测试中表现卓越，以其惊人的速度和效率重新定义了 AI 解决方案的标准。Groq 是一种即时推理速度的代表，在基于云的部署中展现了良好的性能。",
    "modelsUrl": "https://console.groq.com/docs/models",
    "url": "https://groq.com",
    "checkModel": "llama-3.1-8b-instant",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.groq.com/openai/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Groq 的 LPU 推理引擎在最新的独立大语言模型（LLM）基准测试中表现卓越，以其惊人的速度和效率重新定义了 AI 解决方案的标准。Groq 是一种即时推理速度的代表，在基于云的部署中展现了良好的性能。",
      "modelsUrl": "https://console.groq.com/docs/models",
      "url": "https://groq.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.groq.com/openai/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "llama-3.1-8b-instant"
    },
    "priority": 972
  },
  {
    "code": "perplexity",
    "name": "Perplexity",
    "displayName": "Perplexity",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.perplexity.ai",
    "docUrl": "https://docs.perplexity.ai/guides/model-cards",
    "description": "Perplexity 是一家领先的对话生成模型提供商，提供多种先进的Llama 3.1模型，支持在线和离线应用，特别适用于复杂的自然语言处理任务。",
    "modelsUrl": "https://docs.perplexity.ai/guides/model-cards",
    "url": "https://www.perplexity.ai",
    "checkModel": "sonar",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.perplexity.ai"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "Perplexity 是一家领先的对话生成模型提供商，提供多种先进的Llama 3.1模型，支持在线和离线应用，特别适用于复杂的自然语言处理任务。",
      "modelsUrl": "https://docs.perplexity.ai/guides/model-cards",
      "url": "https://www.perplexity.ai",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.perplexity.ai"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai"
      },
      "checkModel": "sonar"
    },
    "priority": 971
  },
  {
    "code": "mistral",
    "name": "Mistral",
    "displayName": "Mistral",
    "icon": "🌪️",
    "apiType": "openai_compat",
    "baseUrl": "https://api.mistral.ai",
    "docUrl": "https://docs.mistral.ai/getting-started/models",
    "description": "Mistral 提供先进的通用、专业和研究型模型，广泛应用于复杂推理、多语言任务、代码生成等领域，通过功能调用接口，用户可以集成自定义功能，实现特定应用。",
    "modelsUrl": "https://docs.mistral.ai/getting-started/models",
    "url": "https://mistral.ai",
    "checkModel": "ministral-3b-latest",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.mistral.ai"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Mistral 提供先进的通用、专业和研究型模型，广泛应用于复杂推理、多语言任务、代码生成等领域，通过功能调用接口，用户可以集成自定义功能，实现特定应用。",
      "modelsUrl": "https://docs.mistral.ai/getting-started/models",
      "url": "https://mistral.ai",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.mistral.ai"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "ministral-3b-latest"
    },
    "priority": 970
  },
  {
    "code": "modelscope",
    "name": "ModelScope",
    "displayName": "ModelScope",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api-inference.modelscope.cn/v1",
    "docUrl": "https://modelscope.cn",
    "description": "ModelScope是阿里云推出的模型即服务平台，提供丰富的AI模型和推理服务。",
    "url": "https://modelscope.cn",
    "checkModel": "Qwen/Qwen3-4B",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api-inference.modelscope.cn/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "ModelScope是阿里云推出的模型即服务平台，提供丰富的AI模型和推理服务。",
      "url": "https://modelscope.cn",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api-inference.modelscope.cn/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Qwen/Qwen3-4B"
    },
    "priority": 969
  },
  {
    "code": "ai21",
    "name": "Ai21Labs",
    "displayName": "Ai21Labs",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://docs.ai21.com/reference",
    "description": "AI21 Labs 为企业构建基础模型和人工智能系统，加速生成性人工智能在生产中的应用。",
    "modelsUrl": "https://docs.ai21.com/reference",
    "url": "https://studio.ai21.com",
    "checkModel": "jamba-mini",
    "settings": {
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "AI21 Labs 为企业构建基础模型和人工智能系统，加速生成性人工智能在生产中的应用。",
      "modelsUrl": "https://docs.ai21.com/reference",
      "url": "https://studio.ai21.com",
      "settings": {
        "sdkType": "openai"
      },
      "checkModel": "jamba-mini"
    },
    "priority": 968
  },
  {
    "code": "upstage",
    "name": "Upstage",
    "displayName": "Upstage",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.upstage.ai/v1/solar",
    "docUrl": "https://developers.upstage.ai/docs/getting-started/models",
    "description": "Upstage 专注于为各种商业需求开发AI模型，包括 Solar LLM 和文档 AI，旨在实现工作的人造通用智能（AGI）。通过 Chat API 创建简单的对话代理，并支持功能调用、翻译、嵌入以及特定领域应用。",
    "modelsUrl": "https://developers.upstage.ai/docs/getting-started/models",
    "url": "https://upstage.ai",
    "checkModel": "solar-1-mini-chat",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.upstage.ai/v1/solar"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "Upstage 专注于为各种商业需求开发AI模型，包括 Solar LLM 和文档 AI，旨在实现工作的人造通用智能（AGI）。通过 Chat API 创建简单的对话代理，并支持功能调用、翻译、嵌入以及特定领域应用。",
      "modelsUrl": "https://developers.upstage.ai/docs/getting-started/models",
      "url": "https://upstage.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.upstage.ai/v1/solar"
        },
        "sdkType": "openai"
      },
      "checkModel": "solar-1-mini-chat"
    },
    "priority": 967
  },
  {
    "code": "xai",
    "name": "xAI (Grok)",
    "displayName": "xAI (Grok)",
    "icon": "❎",
    "apiType": "openai_compat",
    "baseUrl": "https://api.x.ai/v1",
    "docUrl": "https://docs.x.ai/docs#models",
    "description": "xAI 是一家致力于构建人工智能以加速人类科学发现的公司。我们的使命是推动我们对宇宙的共同理解。",
    "modelsUrl": "https://docs.x.ai/docs#models",
    "url": "https://x.ai/api",
    "checkModel": "grok-2-1212",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.x.ai/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "xAI 是一家致力于构建人工智能以加速人类科学发现的公司。我们的使命是推动我们对宇宙的共同理解。",
      "modelsUrl": "https://docs.x.ai/docs#models",
      "url": "https://x.ai/api",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.x.ai/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "grok-2-1212"
    },
    "priority": 966
  },
  {
    "code": "jina",
    "name": "Jina AI",
    "displayName": "Jina AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://deepsearch.jina.ai/v1",
    "docUrl": "https://jina.ai/models",
    "description": "Jina AI 成立于 2020 年，是一家领先的搜索 AI 公司。我们的搜索底座平台包含了向量模型、重排器和小语言模型，可帮助企业构建可靠且高质量的生成式AI和多模态的搜索应用。",
    "modelsUrl": "https://jina.ai/models",
    "url": "https://jina.ai",
    "checkModel": "jina-deepsearch-v1",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://deepsearch.jina.ai/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Jina AI 成立于 2020 年，是一家领先的搜索 AI 公司。我们的搜索底座平台包含了向量模型、重排器和小语言模型，可帮助企业构建可靠且高质量的生成式AI和多模态的搜索应用。",
      "modelsUrl": "https://jina.ai/models",
      "url": "https://jina.ai",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://deepsearch.jina.ai/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "jina-deepsearch-v1"
    },
    "priority": 965
  },
  {
    "code": "sambanova",
    "name": "SambaNova",
    "displayName": "SambaNova",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.sambanova.ai/v1",
    "docUrl": "https://cloud.sambanova.ai/plans/pricing",
    "description": "SambaNova Cloud 可让开发者轻松使用最佳的开源模型，并享受最快的推理速度。",
    "modelsUrl": "https://cloud.sambanova.ai/plans/pricing",
    "url": "https://cloud.sambanova.ai",
    "checkModel": "Meta-Llama-3.2-1B-Instruct",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.sambanova.ai/v1"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "SambaNova Cloud 可让开发者轻松使用最佳的开源模型，并享受最快的推理速度。",
      "modelsUrl": "https://cloud.sambanova.ai/plans/pricing",
      "url": "https://cloud.sambanova.ai",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.sambanova.ai/v1"
        },
        "sdkType": "openai"
      },
      "checkModel": "Meta-Llama-3.2-1B-Instruct"
    },
    "priority": 964
  },
  {
    "code": "cohere",
    "name": "Cohere",
    "displayName": "Cohere",
    "icon": "🧩",
    "apiType": "openai_compat",
    "baseUrl": "https://api.cohere.ai/compatibility/v1",
    "docUrl": "https://docs.cohere.com/v2/docs/models",
    "description": "Cohere 为您带来最前沿的多语言模型、先进的检索功能以及为现代企业量身定制的 AI 工作空间 — 一切都集成在一个安全的平台中。",
    "modelsUrl": "https://docs.cohere.com/v2/docs/models",
    "url": "https://cohere.com",
    "checkModel": "command-r7b-12-2024",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.cohere.ai/compatibility/v1"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "Cohere 为您带来最前沿的多语言模型、先进的检索功能以及为现代企业量身定制的 AI 工作空间 — 一切都集成在一个安全的平台中。",
      "modelsUrl": "https://docs.cohere.com/v2/docs/models",
      "url": "https://cohere.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.cohere.ai/compatibility/v1"
        },
        "sdkType": "openai"
      },
      "checkModel": "command-r7b-12-2024"
    },
    "priority": 963
  },
  {
    "code": "v0",
    "name": "Vercel (v0)",
    "displayName": "Vercel (v0)",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://vercel.com/docs/v0/api#models",
    "description": "v0 是一个配对编程助手，你只需用自然语言描述想法，它就能为你的项目生成代码和用户界面（UI）",
    "modelsUrl": "https://vercel.com/docs/v0/api#models",
    "url": "https://v0.dev",
    "checkModel": "v0-1.5-md",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "v0 是一个配对编程助手，你只需用自然语言描述想法，它就能为你的项目生成代码和用户界面（UI）",
      "modelsUrl": "https://vercel.com/docs/v0/api#models",
      "url": "https://v0.dev",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "openai"
      },
      "checkModel": "v0-1.5-md"
    },
    "priority": 962
  },
  {
    "code": "qwen",
    "name": "Aliyun Bailian",
    "displayName": "Aliyun Bailian",
    "icon": "🌈",
    "apiType": "openai_compat",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "docUrl": "https://help.aliyun.com/zh/dashscope/developer-reference/api-details",
    "description": "通义千问是阿里云自主研发的超大规模语言模型，具有强大的自然语言理解和生成能力。它可以回答各种问题、创作文字内容、表达观点看法、撰写代码等，在多个领域发挥作用。",
    "modelsUrl": "https://help.aliyun.com/zh/dashscope/developer-reference/api-details",
    "url": "https://www.aliyun.com/product/bailian",
    "checkModel": "qwen-flash",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://dashscope.aliyuncs.com/compatible-mode/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showDeployName": true,
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "通义千问是阿里云自主研发的超大规模语言模型，具有强大的自然语言理解和生成能力。它可以回答各种问题、创作文字内容、表达观点看法、撰写代码等，在多个领域发挥作用。",
      "modelsUrl": "https://help.aliyun.com/zh/dashscope/developer-reference/api-details",
      "url": "https://www.aliyun.com/product/bailian",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://dashscope.aliyuncs.com/compatible-mode/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showDeployName": true,
        "showModelFetcher": true
      },
      "checkModel": "qwen-flash"
    },
    "priority": 961
  },
  {
    "code": "wenxin",
    "name": "Wenxin",
    "displayName": "Wenxin",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://qianfan.baidubce.com/v2",
    "docUrl": "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Nlks5zkzu#%E5%AF%B9%E8%AF%9Dchat",
    "description": "企业级一站式大模型与AI原生应用开发及服务平台，提供最全面易用的生成式人工智能模型开发、应用开发全流程工具链",
    "modelsUrl": "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Nlks5zkzu#%E5%AF%B9%E8%AF%9Dchat",
    "url": "https://cloud.baidu.com/wenxin.html",
    "checkModel": "ernie-speed-128k",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://qianfan.baidubce.com/v2"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "企业级一站式大模型与AI原生应用开发及服务平台，提供最全面易用的生成式人工智能模型开发、应用开发全流程工具链",
      "modelsUrl": "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Nlks5zkzu#%E5%AF%B9%E8%AF%9Dchat",
      "url": "https://cloud.baidu.com/wenxin.html",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://qianfan.baidubce.com/v2"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai"
      },
      "checkModel": "ernie-speed-128k"
    },
    "priority": 960
  },
  {
    "code": "tencentcloud",
    "name": "TencentCloud",
    "displayName": "TencentCloud",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/v1",
    "docUrl": "https://cloud.tencent.com/document/api/1772/115963",
    "description": "知识引擎原子能力（LLM Knowledge Engine Atomic Power）基于知识引擎研发的知识问答全链路能力，面向企业及开发者，提供灵活组建及开发模型应用的能力。您可通过多款原子能力组建您专属的模型服务，调用文档解析、拆分、embedding、多轮改写等服务进行组装，定制企业专属 AI 业务。",
    "modelsUrl": "https://cloud.tencent.com/document/api/1772/115963",
    "url": "https://cloud.tencent.com/document/api/1772/115365",
    "checkModel": "deepseek-v3",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.lkeap.cloud.tencent.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "知识引擎原子能力（LLM Knowledge Engine Atomic Power）基于知识引擎研发的知识问答全链路能力，面向企业及开发者，提供灵活组建及开发模型应用的能力。您可通过多款原子能力组建您专属的模型服务，调用文档解析、拆分、embedding、多轮改写等服务进行组装，定制企业专属 AI 业务。",
      "modelsUrl": "https://cloud.tencent.com/document/api/1772/115963",
      "url": "https://cloud.tencent.com/document/api/1772/115365",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.lkeap.cloud.tencent.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "deepseek-v3"
    },
    "priority": 959
  },
  {
    "code": "hunyuan",
    "name": "Hunyuan",
    "displayName": "Hunyuan",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
    "docUrl": "https://cloud.tencent.com/document/product/1729/104753",
    "description": "由腾讯研发的大语言模型，具备强大的中文创作能力，复杂语境下的逻辑推理能力，以及可靠的任务执行能力",
    "modelsUrl": "https://cloud.tencent.com/document/product/1729/104753",
    "url": "https://hunyuan.tencent.com",
    "checkModel": "hunyuan-lite",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.hunyuan.cloud.tencent.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "由腾讯研发的大语言模型，具备强大的中文创作能力，复杂语境下的逻辑推理能力，以及可靠的任务执行能力",
      "modelsUrl": "https://cloud.tencent.com/document/product/1729/104753",
      "url": "https://hunyuan.tencent.com",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.hunyuan.cloud.tencent.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "hunyuan-lite"
    },
    "priority": 958
  },
  {
    "code": "zhipu",
    "name": "ZhiPu",
    "displayName": "ZhiPu",
    "icon": "🔷",
    "apiType": "openai_compat",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "docUrl": "https://open.bigmodel.cn/dev/howuse/model",
    "description": "智谱 AI 提供多模态与语言模型的开放平台，支持广泛的AI应用场景，包括文本处理、图像理解与编程辅助等。",
    "modelsUrl": "https://open.bigmodel.cn/dev/howuse/model",
    "url": "https://zhipuai.cn",
    "checkModel": "glm-4.5-flash",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://open.bigmodel.cn/api/paas/v4"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "智谱 AI 提供多模态与语言模型的开放平台，支持广泛的AI应用场景，包括文本处理、图像理解与编程辅助等。",
      "modelsUrl": "https://open.bigmodel.cn/dev/howuse/model",
      "url": "https://zhipuai.cn",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://open.bigmodel.cn/api/paas/v4"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "glm-4.5-flash"
    },
    "priority": 957
  },
  {
    "code": "siliconcloud",
    "name": "SiliconCloud",
    "displayName": "SiliconCloud",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "docUrl": "https://siliconflow.cn/zh-cn/models",
    "description": "SiliconCloud，基于优秀开源基础模型的高性价比 GenAI 云服务",
    "modelsUrl": "https://siliconflow.cn/zh-cn/models",
    "url": "https://siliconflow.cn/zh-cn/siliconcloud",
    "checkModel": "Pro/Qwen/Qwen2-7B-Instruct",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.siliconflow.cn/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "SiliconCloud，基于优秀开源基础模型的高性价比 GenAI 云服务",
      "modelsUrl": "https://siliconflow.cn/zh-cn/models",
      "url": "https://siliconflow.cn/zh-cn/siliconcloud",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.siliconflow.cn/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Pro/Qwen/Qwen2-7B-Instruct"
    },
    "priority": 956
  },
  {
    "code": "zeroone",
    "name": "01.AI",
    "displayName": "01.AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.lingyiwanwu.com/v1",
    "docUrl": "https://platform.lingyiwanwu.com/docs#模型与计费",
    "description": "零一万物致力于推动以人为本的AI 2.0技术革命，旨在通过大语言模型创造巨大的经济和社会价值，并开创新的AI生态与商业模式。",
    "modelsUrl": "https://platform.lingyiwanwu.com/docs#模型与计费",
    "url": "https://www.lingyiwanwu.com/",
    "checkModel": "yi-lightning",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.lingyiwanwu.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "零一万物致力于推动以人为本的AI 2.0技术革命，旨在通过大语言模型创造巨大的经济和社会价值，并开创新的AI生态与商业模式。",
      "modelsUrl": "https://platform.lingyiwanwu.com/docs#模型与计费",
      "url": "https://www.lingyiwanwu.com/",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.lingyiwanwu.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "yi-lightning"
    },
    "priority": 955
  },
  {
    "code": "spark",
    "name": "Spark",
    "displayName": "Spark",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://spark-api-open.xf-yun.com/v1",
    "docUrl": "https://xinghuo.xfyun.cn/spark",
    "description": "科大讯飞星火大模型提供多领域、多语言的强大 AI 能力，利用先进的自然语言处理技术，构建适用于智能硬件、智慧医疗、智慧金融等多种垂直场景的创新应用。",
    "modelsUrl": "https://xinghuo.xfyun.cn/spark",
    "url": "https://www.xfyun.cn",
    "checkModel": "lite",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://spark-api-open.xf-yun.com/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "科大讯飞星火大模型提供多领域、多语言的强大 AI 能力，利用先进的自然语言处理技术，构建适用于智能硬件、智慧医疗、智慧金融等多种垂直场景的创新应用。",
      "modelsUrl": "https://xinghuo.xfyun.cn/spark",
      "url": "https://www.xfyun.cn",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://spark-api-open.xf-yun.com/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showModelFetcher": false
      },
      "checkModel": "lite"
    },
    "priority": 954
  },
  {
    "code": "sensenova",
    "name": "SenseNova",
    "displayName": "SenseNova",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.sensenova.cn/compatible-mode/v1",
    "docUrl": "https://platform.sensenova.cn/pricing",
    "description": "商汤日日新，依托商汤大装置的强大的基础支撑，提供高效易用的全栈大模型服务。",
    "modelsUrl": "https://platform.sensenova.cn/pricing",
    "url": "https://platform.sensenova.cn/home",
    "checkModel": "SenseChat-Turbo",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.sensenova.cn/compatible-mode/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "商汤日日新，依托商汤大装置的强大的基础支撑，提供高效易用的全栈大模型服务。",
      "modelsUrl": "https://platform.sensenova.cn/pricing",
      "url": "https://platform.sensenova.cn/home",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.sensenova.cn/compatible-mode/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "SenseChat-Turbo"
    },
    "priority": 953
  },
  {
    "code": "stepfun",
    "name": "Stepfun",
    "displayName": "Stepfun",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.stepfun.com/v1",
    "docUrl": "https://platform.stepfun.com/docs/llm/text",
    "description": "阶级星辰大模型具备行业领先的多模态及复杂推理能力，支持超长文本理解和强大的自主调度搜索引擎功能。",
    "modelsUrl": "https://platform.stepfun.com/docs/llm/text",
    "url": "https://stepfun.com",
    "checkModel": "step-2-mini",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.stepfun.com/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "阶级星辰大模型具备行业领先的多模态及复杂推理能力，支持超长文本理解和强大的自主调度搜索引擎功能。",
      "modelsUrl": "https://platform.stepfun.com/docs/llm/text",
      "url": "https://stepfun.com",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.stepfun.com/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "step-2-mini"
    },
    "priority": 952
  },
  {
    "code": "baichuan",
    "name": "Baichuan",
    "displayName": "Baichuan",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.baichuan-ai.com/v1",
    "docUrl": "https://platform.baichuan-ai.com/price",
    "description": "百川智能是一家专注于人工智能大模型研发的公司，其模型在国内知识百科、长文本处理和生成创作等中文任务上表现卓越，超越了国外主流模型。百川智能还具备行业领先的多模态能力，在多项权威评测中表现优异。其模型包括 Baichuan 4、Baichuan 3 Turbo 和 Baichuan 3 Turbo 128k 等，分别针对不同应用场景进行优化，提供高性价比的解决方案。",
    "modelsUrl": "https://platform.baichuan-ai.com/price",
    "url": "https://platform.baichuan-ai.com",
    "checkModel": "Baichuan3-Turbo",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.baichuan-ai.com/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "百川智能是一家专注于人工智能大模型研发的公司，其模型在国内知识百科、长文本处理和生成创作等中文任务上表现卓越，超越了国外主流模型。百川智能还具备行业领先的多模态能力，在多项权威评测中表现优异。其模型包括 Baichuan 4、Baichuan 3 Turbo 和 Baichuan 3 Turbo 128k 等，分别针对不同应用场景进行优化，提供高性价比的解决方案。",
      "modelsUrl": "https://platform.baichuan-ai.com/price",
      "url": "https://platform.baichuan-ai.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.baichuan-ai.com/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Baichuan3-Turbo"
    },
    "priority": 951
  },
  {
    "code": "volcengine",
    "name": "Volcengine",
    "displayName": "Volcengine",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "docUrl": "https://www.volcengine.com/docs/82379/1330310",
    "description": "字节跳动推出的大模型服务的开发平台，提供功能丰富、安全以及具备价格竞争力的模型调用服务，同时提供模型数据、精调、推理、评测等端到端功能，全方位保障您的 AI 应用开发落地。",
    "modelsUrl": "https://www.volcengine.com/docs/82379/1330310",
    "url": "https://www.volcengine.com/product/ark",
    "checkModel": "doubao-1-5-lite-32k-250115",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://ark.cn-beijing.volces.com/api/v3"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showDeployName": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "字节跳动推出的大模型服务的开发平台，提供功能丰富、安全以及具备价格竞争力的模型调用服务，同时提供模型数据、精调、推理、评测等端到端功能，全方位保障您的 AI 应用开发落地。",
      "modelsUrl": "https://www.volcengine.com/docs/82379/1330310",
      "url": "https://www.volcengine.com/product/ark",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://ark.cn-beijing.volces.com/api/v3"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showDeployName": true
      },
      "checkModel": "doubao-1-5-lite-32k-250115"
    },
    "priority": 950
  },
  {
    "code": "minimax",
    "name": "Minimax",
    "displayName": "Minimax",
    "icon": "🧠",
    "apiType": "openai_compat",
    "baseUrl": "https://api.minimax.chat/v1",
    "docUrl": "https://platform.minimaxi.com/document/Models",
    "description": "MiniMax 是 2021 年成立的通用人工智能科技公司，致力于与用户共创智能。MiniMax 自主研发了不同模态的通用大模型，其中包括万亿参数的 MoE 文本大模型、语音大模型以及图像大模型。并推出了海螺 AI 等应用。",
    "modelsUrl": "https://platform.minimaxi.com/document/Models",
    "url": "https://www.minimaxi.com",
    "checkModel": "MiniMax-M2",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://api.minimax.chat/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "MiniMax 是 2021 年成立的通用人工智能科技公司，致力于与用户共创智能。MiniMax 自主研发了不同模态的通用大模型，其中包括万亿参数的 MoE 文本大模型、语音大模型以及图像大模型。并推出了海螺 AI 等应用。",
      "modelsUrl": "https://platform.minimaxi.com/document/Models",
      "url": "https://www.minimaxi.com",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://api.minimax.chat/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai"
      },
      "checkModel": "MiniMax-M2"
    },
    "priority": 949
  },
  {
    "code": "lmstudio",
    "name": "LM Studio",
    "displayName": "LM Studio",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "docUrl": "https://lmstudio.ai/models",
    "description": "LM Studio 是一个用于在您的计算机上开发和实验 LLMs 的桌面应用程序。",
    "modelsUrl": "https://lmstudio.ai/models",
    "url": "https://lmstudio.ai",
    "settings": {
      "defaultShowBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "http://127.0.0.1:1234/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "showApiKey": false,
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "LM Studio 是一个用于在您的计算机上开发和实验 LLMs 的桌面应用程序。",
      "modelsUrl": "https://lmstudio.ai/models",
      "url": "https://lmstudio.ai",
      "settings": {
        "defaultShowBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "http://127.0.0.1:1234/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "showApiKey": false,
        "showModelFetcher": true
      }
    },
    "priority": 948
  },
  {
    "code": "internlm",
    "name": "InternLM",
    "displayName": "InternLM",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://internlm-chat.intern-ai.org.cn/puyu/api/v1",
    "docUrl": "https://internlm.intern-ai.org.cn/doc/docs/Models#%E8%8E%B7%E5%8F%96%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8",
    "description": "致力于大模型研究与开发工具链的开源组织。为所有 AI 开发者提供高效、易用的开源平台，让最前沿的大模型与算法技术触手可及",
    "modelsUrl": "https://internlm.intern-ai.org.cn/doc/docs/Models#%E8%8E%B7%E5%8F%96%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8",
    "url": "https://internlm.intern-ai.org.cn",
    "checkModel": "internlm2.5-latest",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://internlm-chat.intern-ai.org.cn/puyu/api/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "致力于大模型研究与开发工具链的开源组织。为所有 AI 开发者提供高效、易用的开源平台，让最前沿的大模型与算法技术触手可及",
      "modelsUrl": "https://internlm.intern-ai.org.cn/doc/docs/Models#%E8%8E%B7%E5%8F%96%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8",
      "url": "https://internlm.intern-ai.org.cn",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://internlm-chat.intern-ai.org.cn/puyu/api/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "internlm2.5-latest"
    },
    "priority": 947
  },
  {
    "code": "higress",
    "name": "Higress",
    "displayName": "Higress",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://127.0.0.1:8080/v1",
    "docUrl": "https://higress.cn/",
    "description": "Higress 是一款云原生 API 网关，在阿里内部为解决 Tengine reload 对长连接业务有损，以及 gRPC/Dubbo 负载均衡能力不足而诞生。",
    "modelsUrl": "https://higress.cn/",
    "url": "https://apig.console.aliyun.com/",
    "checkModel": "qwen-max",
    "settings": {
      "proxyUrl": {
        "desc": "输入Higress AI Gateway的访问地址",
        "placeholder": "https://127.0.0.1:8080/v1",
        "title": "AI Gateway地址"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Higress 是一款云原生 API 网关，在阿里内部为解决 Tengine reload 对长连接业务有损，以及 gRPC/Dubbo 负载均衡能力不足而诞生。",
      "modelsUrl": "https://higress.cn/",
      "url": "https://apig.console.aliyun.com/",
      "settings": {
        "proxyUrl": {
          "desc": "输入Higress AI Gateway的访问地址",
          "placeholder": "https://127.0.0.1:8080/v1",
          "title": "AI Gateway地址"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "qwen-max"
    },
    "priority": 946
  },
  {
    "code": "giteeai",
    "name": "Gitee AI",
    "displayName": "Gitee AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://ai.gitee.com/v1",
    "docUrl": "https://ai.gitee.com/docs/openapi/v1#tag/serverless/POST/chat/completions",
    "description": "Gitee AI 的 Serverless API 为 AI 开发者提供开箱即用的大模型推理 API 服务。",
    "modelsUrl": "https://ai.gitee.com/docs/openapi/v1#tag/serverless/POST/chat/completions",
    "url": "https://ai.gitee.com",
    "checkModel": "Qwen2.5-72B-Instruct",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://ai.gitee.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Gitee AI 的 Serverless API 为 AI 开发者提供开箱即用的大模型推理 API 服务。",
      "modelsUrl": "https://ai.gitee.com/docs/openapi/v1#tag/serverless/POST/chat/completions",
      "url": "https://ai.gitee.com",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://ai.gitee.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Qwen2.5-72B-Instruct"
    },
    "priority": 945
  },
  {
    "code": "taichu",
    "name": "Taichu",
    "displayName": "Taichu",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://ai-maas.wair.ac.cn/maas/v1",
    "docUrl": "https://ai-maas.wair.ac.cn/#/doc",
    "description": "中科院自动化研究所和武汉人工智能研究院推出新一代多模态大模型，支持多轮问答、文本创作、图像生成、3D理解、信号分析等全面问答任务，拥有更强的认知、理解、创作能力，带来全新互动体验。",
    "modelsUrl": "https://ai-maas.wair.ac.cn/#/doc",
    "url": "https://ai-maas.wair.ac.cn",
    "checkModel": "taichu_llm",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://ai-maas.wair.ac.cn/maas/v1"
      },
      "sdkType": "openai"
    },
    "capabilities": {
      "source": "builtin",
      "description": "中科院自动化研究所和武汉人工智能研究院推出新一代多模态大模型，支持多轮问答、文本创作、图像生成、3D理解、信号分析等全面问答任务，拥有更强的认知、理解、创作能力，带来全新互动体验。",
      "modelsUrl": "https://ai-maas.wair.ac.cn/#/doc",
      "url": "https://ai-maas.wair.ac.cn",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://ai-maas.wair.ac.cn/maas/v1"
        },
        "sdkType": "openai"
      },
      "checkModel": "taichu_llm"
    },
    "priority": 944
  },
  {
    "code": "ai360",
    "name": "360 AI",
    "displayName": "360 AI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://ai.360.cn/platform/docs/overview",
    "description": "360 AI 是 360 公司推出的 AI 模型和服务平台，提供多种先进的自然语言处理模型，包括 360GPT2 Pro、360GPT Pro、360GPT Turbo 和 360GPT Turbo Responsibility 8K。这些模型结合了大规模参数和多模态能力，广泛应用于文本生成、语义理解、对话系统与代码生成等领域。通过灵活的定价策略，360 AI 满足多样化用户需求，支持开发者集成，推动智能化应用的革新和发展。",
    "modelsUrl": "https://ai.360.cn/platform/docs/overview",
    "url": "https://ai.360.com",
    "checkModel": "360gpt-turbo",
    "settings": {
      "disableBrowserRequest": true,
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "360 AI 是 360 公司推出的 AI 模型和服务平台，提供多种先进的自然语言处理模型，包括 360GPT2 Pro、360GPT Pro、360GPT Turbo 和 360GPT Turbo Responsibility 8K。这些模型结合了大规模参数和多模态能力，广泛应用于文本生成、语义理解、对话系统与代码生成等领域。通过灵活的定价策略，360 AI 满足多样化用户需求，支持开发者集成，推动智能化应用的革新和发展。",
      "modelsUrl": "https://ai.360.cn/platform/docs/overview",
      "url": "https://ai.360.com",
      "settings": {
        "disableBrowserRequest": true,
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "360gpt-turbo"
    },
    "priority": 943
  },
  {
    "code": "search1api",
    "name": "Search1API",
    "displayName": "Search1API",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.search1api.com/v1",
    "docUrl": "https://www.search1api.com",
    "description": "Search1API 提供可根据需要自行联网的 DeepSeek 系列模型的访问，包括标准版和快速版本，支持多种参数规模的模型选择。",
    "url": "https://www.search1api.com",
    "checkModel": "deepseek-r1-70b-fast-online",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.search1api.com/v1"
      },
      "responseAnimation": {
        "speed": 2,
        "text": "smooth"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Search1API 提供可根据需要自行联网的 DeepSeek 系列模型的访问，包括标准版和快速版本，支持多种参数规模的模型选择。",
      "url": "https://www.search1api.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.search1api.com/v1"
        },
        "responseAnimation": {
          "speed": 2,
          "text": "smooth"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "deepseek-r1-70b-fast-online"
    },
    "priority": 942
  },
  {
    "code": "infiniai",
    "name": "InfiniAI",
    "displayName": "InfiniAI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://cloud.infini-ai.com/maas/v1",
    "docUrl": "https://cloud.infini-ai.com/genstudio/model",
    "description": "为应用开发者提供高性能、易上手、安全可靠的大模型服务，覆盖从大模型开发到大模型服务化部署的全流程。",
    "modelsUrl": "https://cloud.infini-ai.com/genstudio/model",
    "url": "https://cloud.infini-ai.com/genstudio",
    "checkModel": "qwen3-8b",
    "settings": {
      "disableBrowserRequest": true,
      "proxyUrl": {
        "placeholder": "https://cloud.infini-ai.com/maas/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "为应用开发者提供高性能、易上手、安全可靠的大模型服务，覆盖从大模型开发到大模型服务化部署的全流程。",
      "modelsUrl": "https://cloud.infini-ai.com/genstudio/model",
      "url": "https://cloud.infini-ai.com/genstudio",
      "settings": {
        "disableBrowserRequest": true,
        "proxyUrl": {
          "placeholder": "https://cloud.infini-ai.com/maas/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "qwen3-8b"
    },
    "priority": 941
  },
  {
    "code": "akashchat",
    "name": "AkashChat",
    "displayName": "AkashChat",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://chatapi.akash.network/documentation",
    "description": "Akash 是一个无需许可的云资源市场，与传统云提供商相比，其定价具有竞争力。",
    "modelsUrl": "https://chatapi.akash.network/documentation",
    "url": "https://chatapi.akash.network/",
    "checkModel": "Meta-Llama-3-1-8B-Instruct-FP8",
    "settings": {
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Akash 是一个无需许可的云资源市场，与传统云提供商相比，其定价具有竞争力。",
      "modelsUrl": "https://chatapi.akash.network/documentation",
      "url": "https://chatapi.akash.network/",
      "settings": {
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Meta-Llama-3-1-8B-Instruct-FP8"
    },
    "priority": 940
  },
  {
    "code": "qiniu",
    "name": "Qiniu",
    "displayName": "Qiniu",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.qnaigc.com/v1",
    "docUrl": "https://developer.qiniu.com/aitokenapi/12882/ai-inference-api",
    "description": "七牛作为老牌云服务厂商，提供高性价比稳定的实时、批量 AI 推理服务，简单易用。",
    "modelsUrl": "https://developer.qiniu.com/aitokenapi/12882/ai-inference-api",
    "url": "https://www.qiniu.com",
    "checkModel": "deepseek-r1",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.qnaigc.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "七牛作为老牌云服务厂商，提供高性价比稳定的实时、批量 AI 推理服务，简单易用。",
      "modelsUrl": "https://developer.qiniu.com/aitokenapi/12882/ai-inference-api",
      "url": "https://www.qiniu.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.qnaigc.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "deepseek-r1"
    },
    "priority": 939
  },
  {
    "code": "nebius",
    "name": "Nebius",
    "displayName": "Nebius",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.studio.nebius.com/v1",
    "docUrl": "https://studio.nebius.com/",
    "description": "Nebius 通过构建大规模GPU集群和垂直整合的云平台，为全球AI创新者提供高性能基础设施。",
    "modelsUrl": "https://studio.nebius.com/",
    "url": "https://nebius.com/",
    "checkModel": "Qwen/Qwen2.5-Coder-7B",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.studio.nebius.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Nebius 通过构建大规模GPU集群和垂直整合的云平台，为全球AI创新者提供高性能基础设施。",
      "modelsUrl": "https://studio.nebius.com/",
      "url": "https://nebius.com/",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.studio.nebius.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "Qwen/Qwen2.5-Coder-7B"
    },
    "priority": 938
  },
  {
    "code": "cometapi",
    "name": "CometAPI",
    "displayName": "CometAPI",
    "icon": "🔌",
    "apiType": "openai_compat",
    "baseUrl": "https://api.cometapi.com/v1",
    "docUrl": "https://api.cometapi.com/v1/models",
    "description": "CometAPI 是一个提供多种前沿大模型接口的服务平台，支持 OpenAI、Anthropic、Google 及更多，适合多样化的开发和应用需求。用户可根据自身需求灵活选择最优的模型和价格，助力AI体验的提升。",
    "modelsUrl": "https://api.cometapi.com/v1/models",
    "url": "https://cometapi.com",
    "checkModel": "gpt-5-mini",
    "settings": {
      "proxyUrl": {
        "placeholder": "https://api.cometapi.com/v1"
      },
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "CometAPI 是一个提供多种前沿大模型接口的服务平台，支持 OpenAI、Anthropic、Google 及更多，适合多样化的开发和应用需求。用户可根据自身需求灵活选择最优的模型和价格，助力AI体验的提升。",
      "modelsUrl": "https://api.cometapi.com/v1/models",
      "url": "https://cometapi.com",
      "settings": {
        "proxyUrl": {
          "placeholder": "https://api.cometapi.com/v1"
        },
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "gpt-5-mini"
    },
    "priority": 937
  },
  {
    "code": "vercelaigateway",
    "name": "Vercel AI Gateway",
    "displayName": "Vercel AI Gateway",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://vercel.com/ai-gateway/models",
    "description": "Vercel AI Gateway 提供统一的 API 来访问 100+ 模型，通过单一端点即可使用 OpenAI、Anthropic、Google 等多个提供商的模型。支持预算设置、使用监控、请求负载均衡和故障转移。",
    "apiKeyUrl": "https://vercel.com/dashboard/ai-gateway",
    "modelsUrl": "https://vercel.com/ai-gateway/models",
    "url": "https://vercel.com/ai-gateway",
    "checkModel": "openai/gpt-5-nano",
    "settings": {
      "disableBrowserRequest": true,
      "responseAnimation": "smooth",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Vercel AI Gateway 提供统一的 API 来访问 100+ 模型，通过单一端点即可使用 OpenAI、Anthropic、Google 等多个提供商的模型。支持预算设置、使用监控、请求负载均衡和故障转移。",
      "apiKeyUrl": "https://vercel.com/dashboard/ai-gateway",
      "modelsUrl": "https://vercel.com/ai-gateway/models",
      "url": "https://vercel.com/ai-gateway",
      "settings": {
        "disableBrowserRequest": true,
        "responseAnimation": "smooth",
        "showModelFetcher": true
      },
      "checkModel": "openai/gpt-5-nano"
    },
    "priority": 936
  },
  {
    "code": "cerebras",
    "name": "Cerebras",
    "displayName": "Cerebras",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://inference-docs.cerebras.ai/models/overview",
    "description": "Cerebras 是一个基于其专用 CS-3 系统的 AI 推理平台，旨在提供全球最快、实时响应、高吞吐量的 LLM 服务，专为消除延迟和加速复杂的 AI 工作流（如实时代码生成和代理任务）而设计。",
    "modelsUrl": "https://inference-docs.cerebras.ai/models/overview",
    "url": "https://cerebras.ai",
    "checkModel": "llama3.1-8b",
    "settings": {
      "sdkType": "openai",
      "showModelFetcher": true
    },
    "capabilities": {
      "source": "builtin",
      "description": "Cerebras 是一个基于其专用 CS-3 系统的 AI 推理平台，旨在提供全球最快、实时响应、高吞吐量的 LLM 服务，专为消除延迟和加速复杂的 AI 工作流（如实时代码生成和代理任务）而设计。",
      "modelsUrl": "https://inference-docs.cerebras.ai/models/overview",
      "url": "https://cerebras.ai",
      "settings": {
        "sdkType": "openai",
        "showModelFetcher": true
      },
      "checkModel": "llama3.1-8b"
    },
    "priority": 935
  },
  {
    "code": "lobehub",
    "name": "LobeHub",
    "displayName": "LobeHub",
    "icon": "🔌",
    "apiType": "openai_compat",
    "docUrl": "https://lobehub.com/zh/docs/usage/subscription/model-pricing",
    "description": "LobeHub Cloud 通过官方部署的 API 来实现 AI 模型的调用，并采用 Credits 计算积分的方式来衡量 AI 模型的用量，对应大模型使用的 Tokens。",
    "modelsUrl": "https://lobehub.com/zh/docs/usage/subscription/model-pricing",
    "url": "https://lobehub.com",
    "settings": {
      "modelEditable": false,
      "showAddNewModel": false,
      "showModelFetcher": false
    },
    "capabilities": {
      "source": "builtin",
      "description": "LobeHub Cloud 通过官方部署的 API 来实现 AI 模型的调用，并采用 Credits 计算积分的方式来衡量 AI 模型的用量，对应大模型使用的 Tokens。",
      "modelsUrl": "https://lobehub.com/zh/docs/usage/subscription/model-pricing",
      "url": "https://lobehub.com",
      "settings": {
        "modelEditable": false,
        "showAddNewModel": false,
        "showModelFetcher": false
      }
    },
    "priority": 934
  },
  {
    "code": "openai_compat",
    "name": "OpenAI Compatible",
    "displayName": "兼容接口",
    "icon": "🔌",
    "apiType": "openai_compat",
    "capabilities": {
      "chat": true,
      "embedding": true
    },
    "priority": 10
  }
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
