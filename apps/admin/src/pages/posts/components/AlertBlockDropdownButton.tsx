import React from 'react';
import { Tooltip, Dropdown, DropdownItem } from '@aetherblog/ui';
import { MessageSquareWarning } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AlertBlockDropdownButtonProps {
  onInsertMarkdown: (prefix: string, suffix?: string, customMode?: 'insert' | 'wrap' | 'lineStart') => void;
  className?: string;
}

const ALERT_TYPES = [
  { id: 'info', label: 'info' },
  { id: 'note', label: 'note' },
  { id: 'warning', label: 'warning' },
  { id: 'danger', label: 'danger' },
  { id: 'tip', label: 'tip' },
];

export function AlertBlockDropdownButton({ onInsertMarkdown, className }: AlertBlockDropdownButtonProps) {
  const handleInsert = (typeStr: string) => {
    let title = typeStr;
    if (typeStr === 'info') title = '提示';
    if (typeStr === 'note') title = '注';
    if (typeStr === 'warning') title = '警告';
    if (typeStr === 'danger') title = '危险';
    if (typeStr === 'tip') title = '提示';

    onInsertMarkdown(`:::${typeStr}{title="${title}"}\n`, '\n:::\n', 'wrap');
  };

  const trigger = (
    <Tooltip content="自定义高亮块" side="top" delay={0}>
      <button
        className={cn(
          'relative inline-flex items-center justify-center appearance-none p-1.5 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors',
          className
        )}
      >
        <span className="inline-flex items-center justify-center gap-1 transition-transform active:scale-90">
          <MessageSquareWarning className="w-4 h-4" />
        </span>
      </button>
    </Tooltip>
  );

  return (
    <Dropdown trigger={trigger} align="left" className="!inline-flex z-50">
      <div className="w-[140px] p-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-md shadow-xl">
        <div className="text-xs font-semibold text-[var(--text-muted)] mb-2 px-2 pb-1 border-b border-[var(--border-subtle)]">
          自定义高亮块
        </div>
        {ALERT_TYPES.map((t) => (
          <DropdownItem
            key={t.id}
            onClick={() => handleInsert(t.id)}
            className="cursor-pointer px-2 py-1.5 rounded hover:bg-[var(--bg-card-hover)] text-[14px] !justify-start !text-[var(--text-secondary)] hover:!text-[var(--text-primary)]"
          >
            {t.label}
          </DropdownItem>
        ))}
      </div>
    </Dropdown>
  );
}
