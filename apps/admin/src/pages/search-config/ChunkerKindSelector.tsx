import { Check, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ChunkerKind } from '@/services/searchProfileService';

/**
 * 5 种 chunker 策略下拉选择器，每项带名称 + 一句话描述。
 *
 * 不复用 CodexModelPicker：模型选择器需要按 provider / 价格排序、品牌 logo 等
 * 复杂表头；chunker 只有 5 个固定选项 + 静态描述，自带浮层即可，更轻量。
 */

export const CHUNKER_KINDS: ReadonlyArray<{
  value: ChunkerKind;
  label: string;
  description: string;
  /** 切换到该策略时建议的默认 chunk_size（caller 可读取后写到 form 默认值）。 */
  defaultChunkSize: number;
}> = [
  {
    value: 'recursive',
    label: '递归 Markdown 切片',
    description: '按 H1/H2 → 段落 → 句子递归切分。Markdown 友好，通用首选。',
    defaultChunkSize: 512,
  },
  {
    value: 'fixed',
    label: '定长 Token 切片',
    description: '纯按 token 数硬切，不识别 Markdown 结构。对纯文本可用。',
    defaultChunkSize: 512,
  },
  {
    value: 'markdown',
    label: 'Markdown 标题切片',
    description: '与 recursive 等价（保留扩展位）。',
    defaultChunkSize: 512,
  },
  {
    value: 'qa',
    label: 'Q&A 对切片',
    description: '识别 "问：/答：" / "Q:/A:" 等模式，每对作为一个 chunk。FAQ / 技术问答博文最优。',
    defaultChunkSize: 512,
  },
  {
    value: 'parent_child',
    label: '父子段切片',
    description: 'Child(小, 高精度) + Parent(大, 高上下文)。RAG 检索召回更稳。',
    defaultChunkSize: 256,
  },
];

interface ChunkerKindSelectorProps {
  value: ChunkerKind;
  onChange: (next: ChunkerKind, suggestedChunkSize: number) => void;
  disabled?: boolean;
}

export function ChunkerKindSelector({ value, onChange, disabled }: ChunkerKindSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = CHUNKER_KINDS.find((k) => k.value === value) ?? CHUNKER_KINDS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg',
          'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
          'text-sm text-[var(--text-primary)] text-left',
          'hover:border-[var(--aurora-1)]/40 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus:ring-1 focus:ring-[var(--aurora-1)]/40'
        )}
      >
        <div className="flex flex-col min-w-0">
          <span className="font-medium truncate">{current.label}</span>
          <span className="text-xs text-[var(--text-muted)] truncate">
            {current.description}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-[var(--text-muted)] shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          className={cn(
            'absolute z-50 mt-1 w-full rounded-xl overflow-hidden',
            'surface-overlay !rounded-xl',
            'shadow-2xl'
          )}
        >
          <ul className="py-1 max-h-80 overflow-y-auto">
            {CHUNKER_KINDS.map((k) => {
              const active = k.value === value;
              return (
                <li key={k.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(k.value, k.defaultChunkSize);
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-start gap-3 px-3 py-2.5 text-left',
                      'hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]',
                      'transition-colors'
                    )}
                  >
                    <Check
                      className={cn(
                        'w-4 h-4 mt-0.5 shrink-0',
                        active ? 'text-[var(--aurora-1)]' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {k.label}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] mt-0.5">
                        {k.description}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
