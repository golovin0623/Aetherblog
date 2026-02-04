// AI 供应商图标组件 (使用 @lobehub/icons)
// ref: §5.1 - AI Service 架构

import type { ComponentType, CSSProperties } from 'react';

import { getBrandIconSvgMaskUrl, resolveBrandIconId } from '../utils/lobeIcons';

// 动态导入 LobeHub 图标 (避免 tree-shaking 问题)
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Google from '@lobehub/icons/es/Google';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Azure from '@lobehub/icons/es/Azure';
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
import { Bot } from 'lucide-react';

// 图标组件类型
type IconComponent = ComponentType<{ size?: number; style?: CSSProperties }>;

// 供应商代码 -> LobeHub 图标映射
const PROVIDER_ICONS: Record<string, IconComponent> = {
  openai: OpenAI,
  anthropic: Anthropic,
  claude: Claude,
  google: Google,
  gemini: Gemini,
  deepseek: DeepSeek,
  azure: Azure,
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
};

// 供应商名称别名（用于模糊匹配）
const PROVIDER_ALIASES: Record<string, string> = {
  'aliyun': 'qwen',
  'alibaba': 'qwen',
  'tongyi': 'qwen',
  'kimi': 'moonshot',
  'glm': 'zhipu',
  'chatglm': 'zhipu',
  '01ai': 'yi',
  'lingyiwanwu': 'yi',
};

function isLikelyEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.length <= 6 && /[^\p{ASCII}]/u.test(trimmed);
}

interface ProviderIconProps {
  code: string;
  icon?: string | null;
  size?: number;
  className?: string;
}

/**
 * 渲染供应商图标
 * 使用 @lobehub/icons 提供的官方 AI 品牌图标
 */
export default function ProviderIcon({ code, icon, size = 24, className }: ProviderIconProps) {
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
      return (
        <div
          className={className}
          style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <LocalBrandIcon size={size} />
        </div>
      );
    }

    const svgUrl = getBrandIconSvgMaskUrl(brandIconId, 'aliyun');
    return (
      <div
        className={className}
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
    return (
      <div 
        className={className}
        style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <IconComponent size={size} />
      </div>
    );
  }

  const trimmedIcon = icon?.trim();
  if (trimmedIcon && isLikelyEmoji(trimmedIcon)) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span aria-hidden="true" style={{ fontSize: Math.max(12, Math.round(size * 0.85)), lineHeight: 1 }}>
          {trimmedIcon}
        </span>
      </div>
    );
  }

  // Fallback: 使用通用图标
  return (
    <div 
      className={className}
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
