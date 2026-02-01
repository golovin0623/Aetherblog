import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Sparkles,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  Code,
  Table2,
  Minus,
  Hash,
  FileText,
  Languages,
  ListTree,
} from 'lucide-react';
import { EditorView } from '@aetherblog/editor';
import { cn } from '@/lib/utils';
import type { AiPanelAction } from './AiSidePanel';

interface SlashCommandMenuProps {
  editorViewRef: React.RefObject<EditorView | null>;
  onRunAiAction: (action: AiPanelAction) => void;
}

type SlashCommand = {
  id: string;
  label: string;
  description?: string;
  keywords: string[];
  icon: ComponentType<{ className?: string }>;
  action: (view: EditorView) => void;
};

type MenuAnchor = {
  x: number;
  y: number;
};

function getAnchorCoords(view: EditorView, pos: number): MenuAnchor | null {
  const coords = view.coordsAtPos(pos);
  if (!coords) return null;
  const x = Math.min(window.innerWidth - 16, Math.max(16, coords.left));
  const y = Math.min(window.innerHeight - 16, Math.max(16, coords.bottom + 6));
  return { x, y };
}

export function SlashCommandMenu({ editorViewRef, onRunAiAction }: SlashCommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const slashPosRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const commands = useMemo<SlashCommand[]>(() => [
    {
      id: 'ai-summary',
      label: 'AI 生成摘要',
      description: '提炼文章要点',
      keywords: ['ai', 'summary', '摘要'],
      icon: FileText,
      action: () => onRunAiAction('summary'),
    },
    {
      id: 'ai-outline',
      label: 'AI 生成大纲',
      description: '快速生成结构',
      keywords: ['ai', 'outline', '大纲'],
      icon: ListTree,
      action: () => onRunAiAction('outline'),
    },
    {
      id: 'ai-polish',
      label: 'AI 全文润色',
      description: '优化表达和结构',
      keywords: ['ai', 'polish', '润色'],
      icon: Sparkles,
      action: () => onRunAiAction('polish'),
    },
    {
      id: 'ai-tags',
      label: 'AI 智能标签',
      description: '推荐相关标签',
      keywords: ['ai', 'tags', '标签'],
      icon: Hash,
      action: () => onRunAiAction('tags'),
    },
    {
      id: 'ai-titles',
      label: 'AI 标题建议',
      description: '生成多个标题',
      keywords: ['ai', 'titles', '标题'],
      icon: Heading1,
      action: () => onRunAiAction('titles'),
    },
    {
      id: 'ai-translate',
      label: 'AI 全文翻译',
      description: '翻译为指定语言',
      keywords: ['ai', 'translate', '翻译'],
      icon: Languages,
      action: () => onRunAiAction('translate'),
    },
    {
      id: 'h1',
      label: '标题 1',
      keywords: ['heading', 'h1', '标题'],
      icon: Heading1,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '# ' } });
      },
    },
    {
      id: 'h2',
      label: '标题 2',
      keywords: ['heading', 'h2', '标题'],
      icon: Heading2,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '## ' } });
      },
    },
    {
      id: 'h3',
      label: '标题 3',
      keywords: ['heading', 'h3', '标题'],
      icon: Heading3,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '### ' } });
      },
    },
    {
      id: 'quote',
      label: '引用',
      keywords: ['quote', '引用'],
      icon: Quote,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '> ' } });
      },
    },
    {
      id: 'list',
      label: '无序列表',
      keywords: ['list', '列表'],
      icon: List,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '- ' } });
      },
    },
    {
      id: 'ordered-list',
      label: '有序列表',
      keywords: ['list', 'ordered', '列表'],
      icon: ListOrdered,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '1. ' } });
      },
    },
    {
      id: 'code',
      label: '代码块',
      keywords: ['code', '代码'],
      icon: Code,
      action: (view) => {
        const { from } = view.state.selection.main;
        const snippet = '```\n\n```';
        view.dispatch({
          changes: { from, to: from, insert: snippet },
          selection: { anchor: from + 4 },
        });
      },
    },
    {
      id: 'table',
      label: '表格',
      keywords: ['table', '表格'],
      icon: Table2,
      action: (view) => {
        const { from } = view.state.selection.main;
        const snippet = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
        view.dispatch({ changes: { from, to: from, insert: snippet } });
      },
    },
    {
      id: 'divider',
      label: '分割线',
      keywords: ['divider', 'hr', '分割线'],
      icon: Minus,
      action: (view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '\n---\n' } });
      },
    },
  ], [onRunAiAction]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.keywords.some(keyword => keyword.toLowerCase().includes(q))
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
    setAnchor(null);
    slashPosRef.current = null;
  }, []);

  const updateQuery = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || !isOpen) return;
    const slashPos = slashPosRef.current;
    if (slashPos === null) return;

    const cursor = view.state.selection.main.from;
    if (cursor <= slashPos) {
      closeMenu();
      return;
    }

    const slashChar = view.state.sliceDoc(slashPos, slashPos + 1);
    if (slashChar !== '/') {
      closeMenu();
      return;
    }

    const text = view.state.sliceDoc(slashPos + 1, cursor);
    if (text.includes('\n') || /\s/.test(text)) {
      closeMenu();
      return;
    }

    setQuery(text);
    const coords = getAnchorCoords(view, cursor);
    if (coords) setAnchor(coords);
  }, [closeMenu, editorViewRef, isOpen]);

  const removeSlashText = useCallback((view: EditorView) => {
    const slashPos = slashPosRef.current;
    if (slashPos === null) return;
    const cursor = view.state.selection.main.from;
    view.dispatch({
      changes: { from: slashPos, to: cursor, insert: '' },
      selection: { anchor: slashPos },
    });
  }, []);

  const executeCommand = useCallback((command: SlashCommand) => {
    const view = editorViewRef.current;
    if (!view) return;
    removeSlashText(view);
    command.action(view);
    view.focus();
    closeMenu();
  }, [closeMenu, editorViewRef, removeSlashText]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const attachListeners = () => {
      const view = editorViewRef.current;
      if (!view) {
        rafRef.current = requestAnimationFrame(attachListeners);
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (!isOpen) {
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            const selection = view.state.selection.main;
            if (selection.from !== selection.to) return;
            if (selection.from > 0) {
              const prevChar = view.state.sliceDoc(selection.from - 1, selection.from);
              if (prevChar && !/\s/.test(prevChar)) return;
            }
            slashPosRef.current = selection.from;
            setIsOpen(true);
            setQuery('');
            setActiveIndex(0);
            requestAnimationFrame(() => {
              const coords = getAnchorCoords(view, selection.from + 1);
              if (coords) setAnchor(coords);
            });
          }
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((prev) => (prev + 1) % Math.max(filteredCommands.length, 1));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(filteredCommands.length, 1));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const command = filteredCommands[activeIndex];
          if (command) executeCommand(command);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        }
      };

      const handleKeyUp = () => updateQuery();

      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          closeMenu();
        }
      };

      view.dom.addEventListener('keydown', handleKeyDown);
      view.dom.addEventListener('keyup', handleKeyUp);
      view.dom.addEventListener('blur', closeMenu);
      document.addEventListener('mousedown', handleClickOutside);

      cleanup = () => {
        view.dom.removeEventListener('keydown', handleKeyDown);
        view.dom.removeEventListener('keyup', handleKeyUp);
        view.dom.removeEventListener('blur', closeMenu);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    };

    attachListeners();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cleanup?.();
    };
  }, [editorViewRef, filteredCommands, activeIndex, closeMenu, executeCommand, isOpen, updateQuery]);

  if (!isOpen || !anchor) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[9998] w-[320px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
      style={{ left: anchor.x, top: anchor.y, transform: 'translateX(-10%)' }}
    >
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
        /{query || '输入命令或选择 AI 操作'}
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {filteredCommands.length === 0 ? (
          <div className="px-3 py-3 text-xs text-[var(--text-muted)]">没有匹配的命令</div>
        ) : (
          filteredCommands.map((command, index) => (
            <button
              key={command.id}
              onClick={() => executeCommand(command)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                index === activeIndex
                  ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              <command.icon className="w-4 h-4" />
              <div className="flex-1">
                <div className="text-sm">{command.label}</div>
                {command.description && (
                  <div className="text-[11px] text-[var(--text-muted)]">{command.description}</div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default SlashCommandMenu;
