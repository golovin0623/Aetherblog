import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * 工具参数面板：按工具类型渲染对应的参数控件。
 *
 * 参数持久化到 localStorage (`ai-tools:params:<tool>`)，每个工具独立。
 * 外部通过 useToolParams() 读取当前参数并在运行时合并到请求体。
 */

export type ToolParams = Record<string, unknown>;

export interface ToolParamsPanelProps {
  toolId: string;
  value: ToolParams;
  onChange: (next: ToolParams) => void;
}

const TRANSLATE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: '英语 (English)' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日语 (日本語)' },
  { code: 'ko', label: '韩语 (한국어)' },
  { code: 'fr', label: '法语 (Français)' },
  { code: 'de', label: '德语 (Deutsch)' },
  { code: 'es', label: '西班牙语 (Español)' },
  { code: 'ru', label: '俄语 (Русский)' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'pt', label: '葡萄牙语' },
];

const POLISH_TONES = ['专业', '轻松', '学术', '口语', '商务', '诙谐', '简洁'];

const OUTLINE_STYLES: Array<{ value: string; label: string }> = [
  { value: 'professional', label: '专业' },
  { value: 'casual', label: '轻松' },
  { value: 'technical', label: '技术' },
];

export const DEFAULT_TOOL_PARAMS: Record<string, ToolParams> = {
  summary: { maxLength: 200 },
  tags: { maxTags: 5 },
  titles: { maxTitles: 5 },
  polish: { tone: '专业' },
  outline: { depth: 2, style: 'professional' },
  translate: { targetLanguage: 'en', sourceLanguage: '' },
};

const paramsKey = (toolId: string) => `ai-tools:params:${toolId}`;

export function loadToolParams(toolId: string): ToolParams {
  const fallback = { ...(DEFAULT_TOOL_PARAMS[toolId] || {}) };
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(paramsKey(toolId));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      return { ...fallback, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveToolParams(toolId: string, params: ToolParams) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(paramsKey(toolId), JSON.stringify(params));
  } catch {
    /* ignore quota errors */
  }
}

// ─────────────────────────── UI primitives ───────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
        {hint && <span className="text-[10px] font-normal normal-case opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all';

// ─────────────────────────── Main panel ───────────────────────────

export function ToolParamsPanel({ toolId, value, onChange }: ToolParamsPanelProps) {
  const set = useCallback(
    (patch: ToolParams) => onChange({ ...value, ...patch }),
    [value, onChange],
  );

  switch (toolId) {
    case 'summary':
      return (
        <div className="space-y-4">
          <Field label="摘要最大字符数" hint="10 – 2000">
            <input
              type="number"
              min={10}
              max={2000}
              step={10}
              className={inputCls}
              value={Number(value.maxLength ?? 200)}
              onChange={(e) => set({ maxLength: Number(e.target.value) || 200 })}
            />
          </Field>
        </div>
      );

    case 'tags':
      return (
        <div className="space-y-4">
          <Field label="标签数量" hint="1 – 20">
            <input
              type="number"
              min={1}
              max={20}
              className={inputCls}
              value={Number(value.maxTags ?? 5)}
              onChange={(e) => set({ maxTags: Number(e.target.value) || 5 })}
            />
          </Field>
        </div>
      );

    case 'titles':
      return (
        <div className="space-y-4">
          <Field label="标题数量" hint="1 – 10">
            <input
              type="number"
              min={1}
              max={10}
              className={inputCls}
              value={Number(value.maxTitles ?? 5)}
              onChange={(e) => set({ maxTitles: Number(e.target.value) || 5 })}
            />
          </Field>
        </div>
      );

    case 'polish':
      return (
        <div className="space-y-4">
          <Field label="润色语气">
            <div className="flex flex-wrap gap-2">
              {POLISH_TONES.map((tone) => {
                const isOn = value.tone === tone;
                return (
                  <button
                    key={tone}
                    type="button"
                    onClick={() => set({ tone })}
                    className={cn(
                      'px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                      isOn
                        ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]',
                    )}
                  >
                    {tone}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      );

    case 'outline':
      return (
        <div className="space-y-4">
          <Field label="大纲层级深度" hint="1 – 6">
            <input
              type="number"
              min={1}
              max={6}
              className={inputCls}
              value={Number(value.depth ?? 2)}
              onChange={(e) => set({ depth: Number(e.target.value) || 2 })}
            />
          </Field>
          <Field label="风格">
            <div className="flex flex-wrap gap-2">
              {OUTLINE_STYLES.map((opt) => {
                const isOn = value.style === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set({ style: opt.value })}
                    className={cn(
                      'px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                      isOn
                        ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      );

    case 'translate':
      return (
        <div className="space-y-4">
          <Field label="目标语言">
            <select
              className={inputCls}
              value={String(value.targetLanguage ?? 'en')}
              onChange={(e) => set({ targetLanguage: e.target.value })}
            >
              {TRANSLATE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="源语言（可选）" hint="留空 = 自动检测">
            <input
              type="text"
              className={inputCls}
              placeholder="例如 zh / en"
              value={String(value.sourceLanguage ?? '')}
              onChange={(e) => set({ sourceLanguage: e.target.value })}
            />
          </Field>
        </div>
      );

    default:
      return (
        <div className="text-xs text-[var(--text-muted)] py-2">
          当前工具暂无可配置参数。
        </div>
      );
  }
}

/**
 * Convenience hook: 读取并持久化某个工具的参数。
 */
export function useToolParams(toolId: string) {
  const [params, setParams] = useState<ToolParams>(() => loadToolParams(toolId));

  useEffect(() => {
    setParams(loadToolParams(toolId));
  }, [toolId]);

  const update = useCallback(
    (next: ToolParams) => {
      setParams(next);
      saveToolParams(toolId, next);
    },
    [toolId],
  );

  return [params, update] as const;
}
