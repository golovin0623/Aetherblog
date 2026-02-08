// AI 供应商图标组件 (使用 @lobehub/icons)
// ref: §5.1 - AI Service 架构

import type { ComponentType, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

import { getBrandIconSvgMaskUrl, resolveBrandIconId, getBrandIconPreviewUrl } from '../utils/lobeIcons';

// 动态导入 LobeHub 图标 (避免 tree-shaking 问题)
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Google from '@lobehub/icons/es/Google';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Azure from '@lobehub/icons/es/Azure';
import AzureAI from '@lobehub/icons/es/AzureAI';
import Ollama from '@lobehub/icons/es/Ollama';
import Moonshot from '@lobehub/icons/es/Moonshot';
import Zhipu from '@lobehub/icons/es/Zhipu';
import Qwen from '@lobehub/icons/es/Qwen';
import Gemini from '@lobehub/icons/es/Gemini';
import Mistral from '@lobehub/icons/es/Mistral';
import Cohere from '@lobehub/icons/es/Cohere';
import Claude from '@lobehub/icons/es/Claude';
import Groq from '@lobehub/icons/es/Groq';
import Yi from '@lobehub/icons/es/Yi';
import Baichuan from '@lobehub/icons/es/Baichuan';
import Stepfun from '@lobehub/icons/es/Stepfun';
import Minimax from '@lobehub/icons/es/Minimax';
import HuggingFace from '@lobehub/icons/es/HuggingFace';
import Together from '@lobehub/icons/es/Together';
import Perplexity from '@lobehub/icons/es/Perplexity';
import OpenRouter from '@lobehub/icons/es/OpenRouter';
import SiliconCloud from '@lobehub/icons/es/SiliconCloud';
import Volcengine from '@lobehub/icons/es/Volcengine';
import Wenxin from '@lobehub/icons/es/Wenxin';
import Spark from '@lobehub/icons/es/Spark';
import Hunyuan from '@lobehub/icons/es/Hunyuan';
import Nvidia from '@lobehub/icons/es/Nvidia';
import Github from '@lobehub/icons/es/Github';
import Cloudflare from '@lobehub/icons/es/Cloudflare';
import V0 from '@lobehub/icons/es/V0';
import VertexAI from '@lobehub/icons/es/VertexAI';
import Ai21 from '@lobehub/icons/es/Ai21';
import Ai302 from '@lobehub/icons/es/Ai302';
import Ai360 from '@lobehub/icons/es/Ai360';
import AiHubMix from '@lobehub/icons/es/AiHubMix';
import AkashChat from '@lobehub/icons/es/AkashChat';
import Bedrock from '@lobehub/icons/es/Bedrock';
import Bfl from '@lobehub/icons/es/Bfl';
import Cerebras from '@lobehub/icons/es/Cerebras';
import CometAPI from '@lobehub/icons/es/CometAPI';
import ComfyUI from '@lobehub/icons/es/ComfyUI';
import Fal from '@lobehub/icons/es/Fal';
import Fireworks from '@lobehub/icons/es/Fireworks';
import GiteeAI from '@lobehub/icons/es/GiteeAI';
import Higress from '@lobehub/icons/es/Higress';
import InternLM from '@lobehub/icons/es/InternLM';
import Jina from '@lobehub/icons/es/Jina';
import LmStudio from '@lobehub/icons/es/LmStudio';
import LobeHub from '@lobehub/icons/es/LobeHub';
import ModelScope from '@lobehub/icons/es/ModelScope';
import Nebius from '@lobehub/icons/es/Nebius';
import NewAPI from '@lobehub/icons/es/NewAPI';
import Novita from '@lobehub/icons/es/Novita';
import PPIO from '@lobehub/icons/es/PPIO';
import Qiniu from '@lobehub/icons/es/Qiniu';
import SambaNova from '@lobehub/icons/es/SambaNova';
import Search1API from '@lobehub/icons/es/Search1API';
import SenseNova from '@lobehub/icons/es/SenseNova';
import Upstage from '@lobehub/icons/es/Upstage';
import Vllm from '@lobehub/icons/es/Vllm';
import XAI from '@lobehub/icons/es/XAI';
import Xinference from '@lobehub/icons/es/Xinference';
import Infinigence from '@lobehub/icons/es/Infinigence';
import TencentCloud from '@lobehub/icons/es/TencentCloud';
import Vercel from '@lobehub/icons/es/Vercel';
import Bailian from '@lobehub/icons/es/Bailian';
import { Bot } from 'lucide-react';

// 图标组件类型
type IconComponent = ComponentType<{ size?: number; style?: CSSProperties }>;
type ColorableIconComponent = IconComponent & { Color?: IconComponent };

// 供应商代码 -> LobeHub 图标映射
const PROVIDER_ICONS: Record<string, IconComponent> = {
  openai: OpenAI,
  anthropic: Anthropic,
  claude: Claude,
  google: Google,
  gemini: Gemini,
  deepseek: DeepSeek,
  azure: Azure,
  azureai: AzureAI,
  ollama: Ollama,
  moonshot: Moonshot,
  zhipu: Zhipu,
  qwen: Qwen,
  mistral: Mistral,
  cohere: Cohere,
  groq: Groq,
  yi: Yi,
  baichuan: Baichuan,
  stepfun: Stepfun,
  minimax: Minimax,
  huggingface: HuggingFace,
  together: Together,
  perplexity: Perplexity,
  openrouter: OpenRouter,
  siliconcloud: SiliconCloud,
  volcengine: Volcengine,
  wenxin: Wenxin,
  spark: Spark,
  hunyuan: Hunyuan,
  zeroone: Yi,
  nvidia: Nvidia,
  github: Github,
  cloudflare: Cloudflare,
  v0: V0,
  vertexai: VertexAI,
  ai21: Ai21,
  ai302: Ai302,
  ai360: Ai360,
  aihubmix: AiHubMix,
  akashchat: AkashChat,
  bedrock: Bedrock,
  bfl: Bfl,
  cerebras: Cerebras,
  cometapi: CometAPI,
  comfyui: ComfyUI,
  fal: Fal,
  fireworksai: Fireworks,
  giteeai: GiteeAI,
  higress: Higress,
  internlm: InternLM,
  jina: Jina,
  lmstudio: LmStudio,
  lobehub: LobeHub,
  modelscope: ModelScope,
  nebius: Nebius,
  newapi: NewAPI,
  novita: Novita,
  ppio: PPIO,
  qiniu: Qiniu,
  sambanova: SambaNova,
  search1api: Search1API,
  sensenova: SenseNova,
  upstage: Upstage,
  vllm: Vllm,
  xai: XAI,
  xinference: Xinference,
  infiniai: Infinigence,
  tencentcloud: TencentCloud,
  vercel: Vercel,
  bailian: Bailian,
};

// 供应商名称别名（用于模糊匹配）
const PROVIDER_ALIASES: Record<string, string> = {
  aliyun: 'qwen',
  alibaba: 'qwen',
  tongyi: 'qwen',
  kimi: 'moonshot',
  glm: 'zhipu',
  chatglm: 'zhipu',
  '01ai': 'yi',
  lingyiwanwu: 'yi',
  ark: 'volcengine',
  baidu: 'wenxin',
  xfun: 'spark',
  iflytek: 'spark',
  tencent: 'hunyuan',
  grok: 'xai',
  togetherai: 'together',
  openaicompat: 'openai',
  ollamacloud: 'ollama',
  vercelaigateway: 'vercel',
};

interface ProviderIconProps {
  code: string;
  icon?: string | null;
  size?: number;
  className?: string;
  colorful?: boolean;
}

/**
 * 渲染供应商图标
 * 使用 @lobehub/icons 提供的官方 AI 品牌图标
 */
export default function ProviderIcon({
  code,
  icon,
  size = 24,
  className,
  colorful = true
}: ProviderIconProps) {
  const resolveColorVariant = (input: IconComponent): IconComponent => {
    const withColor = input as ColorableIconComponent;
    if (colorful && withColor.Color) {
      return withColor.Color;
    }
    return input;
  };

  // 规范化代码
  const normalizedCode = code.toLowerCase().replace(/[-_\s]/g, '');

  // 尝试直接匹配或别名匹配
  const iconKey = PROVIDER_ICONS[normalizedCode]
    ? normalizedCode
    : PROVIDER_ALIASES[normalizedCode] || null;

  const IconComponent = iconKey ? PROVIDER_ICONS[iconKey] : null;

  const brandIconId = resolveBrandIconId(icon);
  if (brandIconId) {
    const normalizedBrandKey = brandIconId.toLowerCase().replace(/[-_\s]/g, '');
    const localBrandKey = PROVIDER_ICONS[normalizedBrandKey]
      ? normalizedBrandKey
      : PROVIDER_ALIASES[normalizedBrandKey] || null;
    const LocalBrandIcon = localBrandKey ? PROVIDER_ICONS[localBrandKey] : null;

    if (LocalBrandIcon) {
      const TargetIcon = resolveColorVariant(LocalBrandIcon);
      return (
        <div
          className={cn('flex-none', className)}
          style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <TargetIcon size={size} />
        </div>
      );
    }

    // CDN 图标处理
    if (colorful) {
      const colorUrl = getBrandIconPreviewUrl({ id: brandIconId, hasColor: true }, 'aliyun');
      return (
        <div
          className={cn('flex-none', className)}
          style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img src={colorUrl} width={size} height={size} alt={code} style={{ objectFit: 'contain' }} />
        </div>
      );
    }

    const svgUrl = getBrandIconSvgMaskUrl(brandIconId, 'aliyun');
    return (
      <div
        className={cn('flex-none', className)}
        style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            backgroundColor: 'currentColor',
            maskImage: `url(${svgUrl})`,
            WebkitMaskImage: `url(${svgUrl})`,
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
          }}
        />
      </div>
    );
  }

  if (IconComponent) {
    const TargetIcon = resolveColorVariant(IconComponent);
    return (
      <div
        className={cn('flex-none', className)}
        style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <TargetIcon size={size} />
      </div>
    );
  }

  // Fallback: 使用通用图标
  return (
    <div
      className={cn('flex-none', className)}
      style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Bot size={size} className="text-[var(--text-muted)]" />
    </div>
  );
}

// 检查是否有可用的供应商图标
export function hasProviderIcon(code: string): boolean {
  const normalizedCode = code.toLowerCase().replace(/[-_\s]/g, '');
  return !!(PROVIDER_ICONS[normalizedCode] || PROVIDER_ALIASES[normalizedCode]);
}

// 获取所有支持的供应商代码
export function getSupportedProviderCodes(): string[] {
  return [...Object.keys(PROVIDER_ICONS), ...Object.keys(PROVIDER_ALIASES)];
}
