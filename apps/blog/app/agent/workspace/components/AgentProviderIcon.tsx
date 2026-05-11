'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '@aetherblog/ui';

interface AgentProviderIconProps {
  code: string;
  icon?: string | null;
  size?: number;
  className?: string;
}

type BrandIcon = {
  id: string;
  color?: boolean;
};

const LOBE_ICON_ALIASES: Record<string, BrandIcon> = {
  ai21: { id: 'ai21' },
  ai302: { id: 'ai302' },
  ai360: { id: 'ai360' },
  aihubmix: { id: 'aihubmix', color: true },
  aliyun: { id: 'qwen', color: true },
  alibaba: { id: 'qwen', color: true },
  anthropic: { id: 'anthropic' },
  ark: { id: 'volcengine', color: true },
  azure: { id: 'azure', color: true },
  azureai: { id: 'azureai', color: true },
  baidu: { id: 'wenxin', color: true },
  bailian: { id: 'bailian', color: true },
  claude: { id: 'claude', color: true },
  cloudflare: { id: 'cloudflare', color: true },
  cohere: { id: 'cohere', color: true },
  deepseek: { id: 'deepseek', color: true },
  gemini: { id: 'gemini', color: true },
  github: { id: 'github' },
  google: { id: 'google', color: true },
  grok: { id: 'xai' },
  groq: { id: 'groq', color: true },
  huggingface: { id: 'huggingface', color: true },
  hunyuan: { id: 'hunyuan', color: true },
  iflytek: { id: 'spark', color: true },
  kimi: { id: 'moonshot', color: true },
  mistral: { id: 'mistral', color: true },
  moonshot: { id: 'moonshot', color: true },
  nvidia: { id: 'nvidia', color: true },
  ollama: { id: 'ollama', color: true },
  openai: { id: 'openai' },
  openaicompat: { id: 'openai' },
  openrouter: { id: 'openrouter', color: true },
  perplexity: { id: 'perplexity' },
  qwen: { id: 'qwen', color: true },
  siliconcloud: { id: 'siliconcloud', color: true },
  siliconflow: { id: 'siliconcloud', color: true },
  spark: { id: 'spark', color: true },
  tencent: { id: 'hunyuan', color: true },
  together: { id: 'together', color: true },
  togetherai: { id: 'together', color: true },
  tongyi: { id: 'qwen', color: true },
  v0: { id: 'v0' },
  vertexai: { id: 'vertexai', color: true },
  volcengine: { id: 'volcengine', color: true },
  wenxin: { id: 'wenxin', color: true },
  xai: { id: 'xai' },
  xinference: { id: 'xinference' },
  zhipu: { id: 'zhipu', color: true },
  zeroone: { id: 'yi', color: true },
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[-_\s./]/g, '');
}

function normalizeBrandId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

function isTextIcon(value: string): boolean {
  return !/^[a-z0-9][a-z0-9_-]{1,72}$/i.test(value);
}

function lobeIconUrl(icon: BrandIcon): string {
  const suffix = icon.color ? '-color' : '';
  return `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${icon.id.toLowerCase()}${suffix}.svg`;
}

function resolveBrandIcon(code: string, icon?: string | null): BrandIcon | null {
  const custom = icon?.trim();
  if (custom && !isUrl(custom) && !isTextIcon(custom)) {
    const customKey = normalizeKey(custom);
    return LOBE_ICON_ALIASES[customKey] || { id: normalizeBrandId(custom) };
  }
  const key = normalizeKey(code);
  return LOBE_ICON_ALIASES[key] || null;
}

export default function AgentProviderIcon({
  code,
  icon,
  size = 18,
  className,
}: AgentProviderIconProps) {
  const [failed, setFailed] = useState(false);

  const trimmedIcon = icon?.trim() || null;
  const source = useMemo(() => {
    if (trimmedIcon && isUrl(trimmedIcon)) return trimmedIcon;
    const brandIcon = resolveBrandIcon(code, trimmedIcon);
    return brandIcon ? lobeIconUrl(brandIcon) : null;
  }, [code, trimmedIcon]);

  useEffect(() => {
    setFailed(false);
  }, [source, code, trimmedIcon]);

  const boxStyle = { width: size, height: size };
  const textIcon = trimmedIcon && !isUrl(trimmedIcon) && isTextIcon(trimmedIcon) ? trimmedIcon : null;

  if (source && !failed) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md', className)}
        style={boxStyle}
        aria-hidden="true"
      >
        <img
          src={source}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (textIcon) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-md leading-none', className)}
        style={{ ...boxStyle, fontSize: Math.max(12, Math.round(size * 0.72)) }}
        aria-hidden="true"
      >
        {textIcon}
      </span>
    );
  }

  const fallback = code.trim().slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-md bg-[color-mix(in_oklch,var(--ink-muted)_12%,transparent)] text-[var(--ink-muted)]',
        className,
      )}
      style={boxStyle}
      aria-hidden="true"
    >
      {fallback ? (
        <span className="font-mono text-[10px] font-semibold uppercase">{fallback}</span>
      ) : (
        <Bot size={Math.max(12, size - 4)} />
      )}
    </span>
  );
}
