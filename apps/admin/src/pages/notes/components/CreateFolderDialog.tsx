import { useEffect, useRef, useState } from 'react';
import { FolderPlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { noteService } from '@/services/noteService';
import type { NoteFolderItem } from '@/types/note';
import { cn, extractApiErrorMessage } from '@/lib/utils';

interface CreateFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (folder: NoteFolderItem) => void;
}

export function CreateFolderDialog({ isOpen, onClose, onCreated }: CreateFolderDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const res = await noteService.createFolder({ name: trimmed });
      toast.success('文件夹已创建');
      onCreated?.(res.data);
      setName('');
      onClose();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '创建文件夹失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-center md:p-4">
      <button className="absolute inset-0 cursor-default" aria-label="关闭新建文件夹" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="新建文件夹"
        className={cn(
          'relative w-full overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-popover)] shadow-2xl',
          'rounded-t-2xl md:max-w-md md:rounded-xl',
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">新建文件夹</h2>
            <p className="text-xs text-[var(--text-muted)]">用于整理智能笔记</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form
          className="space-y-4 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="文件夹名称"
            className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)] focus:border-[color-mix(in_oklch,var(--color-primary)_48%,transparent)] focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_16%,transparent)]"
          />
          <footer className="flex flex-col gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:flex-row md:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border-subtle)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              创建
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default CreateFolderDialog;
