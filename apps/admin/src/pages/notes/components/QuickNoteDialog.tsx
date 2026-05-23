import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { noteService } from '@/services/noteService';
import type { NoteFolderItem, NoteDetail } from '@/types/note';
import { toast } from 'sonner';

interface QuickNoteDialogProps {
  isOpen: boolean;
  folders: NoteFolderItem[];
  onClose: () => void;
  onCreated?: (note: NoteDetail) => void;
}

export function QuickNoteDialog({ isOpen, folders, onClose, onCreated }: QuickNoteDialogProps) {
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => contentRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [isOpen]);

  const resetText = useCallback(() => {
    setTitle('');
    setContent('');
    setTags('');
  }, []);

  const handleSave = useCallback(async (keepOpen: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await noteService.create({
        title: title.trim() || undefined,
        contentMarkdown: content,
        folderId: folderId ? Number(folderId) : undefined,
        tagNames: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        sourceType: 'manual',
      });
      toast.success('笔记已保存');
      onCreated?.(res.data);
      if (keepOpen) {
        resetText();
        requestAnimationFrame(() => contentRef.current?.focus());
      } else {
        onClose();
        resetText();
      }
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '保存笔记失败'));
    } finally {
      setSaving(false);
    }
  }, [content, folderId, onClose, onCreated, resetText, saving, tags, title]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSave(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-center md:p-4">
      <button className="absolute inset-0 cursor-default" aria-label="关闭快速记录" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="快速记录"
        className={cn(
          'relative w-full overflow-hidden border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] shadow-2xl',
          'rounded-t-2xl md:max-w-2xl md:rounded-xl',
          'max-h-[66vh] md:max-h-[78vh]',
        )}
      >
        <header className="flex items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--ink-primary)]">快速记录</h2>
            <p className="text-xs text-[var(--ink-muted)]">先记下来, 稍后再整理</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto px-4 py-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="标题可选"
            className="h-11 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[var(--aurora-1)]"
          />
          <textarea
            ref={contentRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="写下一段想法、一个链接或一条待办..."
            rows={8}
            className="min-h-36 w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 py-3 text-sm leading-6 text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[var(--aurora-1)]"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              className="h-11 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[var(--aurora-1)]"
            >
              <option value="">未整理</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="标签, 用逗号分隔"
              className="h-11 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-card)] px-3 text-sm text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--aurora-1)]"
            />
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:flex-row md:justify-end">
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-4 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:opacity-60"
          >
            保存并继续
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--ink-primary)] px-4 text-sm font-semibold text-[var(--bg-void)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}

export default QuickNoteDialog;
