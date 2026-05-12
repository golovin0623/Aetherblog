'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SlashSquare, Search } from 'lucide-react';
import PickerPopover from './PickerPopover';
import { filterSlashCommands, type SlashCommand } from '../../lib/agentResources';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (cmd: SlashCommand) => void;
}

/**
 * / 斜杠命令选择器
 *
 * 命令清单是模块本地静态数组（``SLASH_COMMANDS``）。
 *
 *   - kind: 'local'  —— /clear、/regen 这类前端语义动作；
 *   - kind: 'remote' —— /summarize、/explain、/translate 这类把模板插入 composer
 *     让用户补全后再发给 LLM 的命令。
 *
 * 现在主要由父级 WorkspaceClient 在 onPick 中分发执行。
 */
export default function SlashCommandPicker({ open, onClose, anchorRef, onPick }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filterSlashCommands(query), [query]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择命令"
      className="w-full max-w-[calc(100vw-1.25rem)] sm:w-[min(320px,calc(100vw-1.25rem))]"
    >
      <div className="p-3 border-b border-[var(--ink-subtle)]/15">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令…"
            className="w-full pl-8 pr-2 py-2 rounded-lg bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/15 text-[var(--ink-secondary)] placeholder-[var(--ink-muted)]/60 text-[12.5px] outline-none focus:border-[var(--aurora-1)]/40 focus:ring-1 focus:ring-[var(--aurora-1)]/15"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
          § Commands
        </div>
      </div>

      <div className="agent-thumb-scroll max-h-[min(320px,52dvh)] overflow-y-auto py-1 sm:max-h-[320px]">
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的命令
          </div>
        )}
        {visible.map((cmd) => (
          <button
            key={cmd.command}
            type="button"
            onClick={() => onPick(cmd)}
            className="w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors text-[var(--ink-secondary)] hover:bg-[var(--bg-raised)]/70 hover:text-[var(--ink-primary)]"
          >
            <SlashSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-80" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12.5px] tracking-[-0.01em]">{cmd.command}</div>
              <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5 leading-snug">
                {cmd.description}
              </div>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] flex-shrink-0 mt-0.5 text-[var(--ink-muted)]">
              {cmd.kind === 'local' ? '本地' : '模板'}
            </span>
          </button>
        ))}
      </div>
    </PickerPopover>
  );
}
