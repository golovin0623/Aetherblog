// 添加读物对话框 —— Atlas 闭环「读 → 标 → 联 → 问」的统一入口。
//
// ref: docs/pm/atlas-redesign.md §4 P0-2
// 两种零依赖冷启动方式（不需要先去笔记/媒体/写作模块）：
//   1. 网页快照：填链接 → 抓正文 → 存为 web carrier → 进 Reader
//   2. 粘贴文本：贴 Markdown → 存为 markdown source → 进 Reader
// 保存成功后直接跳进对应 Reader，让用户立刻进入「标注」一步。

import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileText, Globe } from 'lucide-react';
import { Modal } from '@aetherblog/ui';
import { toast } from 'sonner';

import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

type Mode = 'web' | 'paste';

const initialWeb = { sourceUrl: '', title: '', contentMarkdown: '', author: '', language: '' };
const initialPaste = { title: '', contentMarkdown: '' };

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const inputClass =
  'h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 text-sm text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]';

export function AddReadingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('web');
  const [web, setWeb] = useState(initialWeb);
  const [paste, setPaste] = useState(initialPaste);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);

  const reset = () => {
    setWeb(initialWeb);
    setPaste(initialPaste);
    setMode('web');
  };

  const close = () => {
    if (saving || fetching) return;
    reset();
    onClose();
  };

  const handleFetch = async () => {
    const url = web.sourceUrl.trim();
    if (!isHttpUrl(url)) {
      toast.error('请填写完整的 http(s) 链接');
      return;
    }
    setFetching(true);
    try {
      const res = await atlasService.fetchWebClip({ sourceUrl: url });
      setWeb((form) => ({
        ...form,
        sourceUrl: res.data.sourceUrl || form.sourceUrl,
        title: res.data.title || form.title,
        contentMarkdown: res.data.contentMarkdown || form.contentMarkdown,
        author: res.data.author ?? form.author,
        language: res.data.language ?? form.language,
      }));
      toast.success('网页正文已抓取');
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '抓取网页正文失败'));
    } finally {
      setFetching(false);
    }
  };

  const handleWebSave = async (event: FormEvent) => {
    event.preventDefault();
    const url = web.sourceUrl.trim();
    if (!isHttpUrl(url)) {
      toast.error('请填写完整的 http(s) 链接');
      return;
    }
    if (!web.contentMarkdown.trim()) {
      toast.error('请填写或抓取网页正文');
      return;
    }
    setSaving(true);
    try {
      const res = await atlasService.ensureWebCarrier({
        sourceUrl: url,
        title: web.title.trim() || undefined,
        contentMarkdown: web.contentMarkdown,
        author: web.author.trim() || undefined,
        language: web.language.trim() || undefined,
      });
      toast.success('网页读物已保存');
      onCreated?.();
      reset();
      onClose();
      navigate(`/atlas/reader/web/${res.data.id}`);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '保存网页读物失败'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasteSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!paste.contentMarkdown.trim()) {
      toast.error('请粘贴正文内容');
      return;
    }
    setSaving(true);
    try {
      const res = await atlasService.createMarkdownSource({
        title: paste.title.trim() || undefined,
        contentMarkdown: paste.contentMarkdown,
      });
      toast.success('文本读物已保存');
      onCreated?.();
      reset();
      onClose();
      navigate(`/atlas/reader/note/${res.data.id}`);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '保存文本读物失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={close} title="添加读物" size="lg">
      <div className="space-y-4">
        <div className="inline-flex rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('web')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
              mode === 'web'
                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] text-[var(--ink-primary)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            网页快照
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
              mode === 'paste'
                ? 'bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] text-[var(--ink-primary)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]'
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            粘贴文本
          </button>
        </div>

        {mode === 'web' ? (
          <form className="space-y-4" onSubmit={(event) => void handleWebSave(event)}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">网页链接</span>
                <input
                  type="url"
                  value={web.sourceUrl}
                  onChange={(event) => setWeb((form) => ({ ...form, sourceUrl: event.target.value }))}
                  placeholder="https://example.com/article"
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                disabled={saving || fetching || !web.sourceUrl.trim()}
                onClick={() => void handleFetch()}
                className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--aurora-2)_28%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-2)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {fetching ? '抓取中' : '抓取正文'}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">标题（可选）</span>
                <input
                  value={web.title}
                  onChange={(event) => setWeb((form) => ({ ...form, title: event.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--ink-secondary)]">语言（可选）</span>
                <input
                  value={web.language}
                  onChange={(event) => setWeb((form) => ({ ...form, language: event.target.value }))}
                  placeholder="zh-CN"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">网页正文（抓取后可编辑）</span>
              <textarea
                value={web.contentMarkdown}
                onChange={(event) => setWeb((form) => ({ ...form, contentMarkdown: event.target.value }))}
                rows={9}
                placeholder="点击「抓取正文」自动填充，或手动粘贴正文。"
                className="w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm leading-6 text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving || fetching}
                onClick={close}
                className="inline-flex h-9 items-center rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-3 text-xs text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving || fetching}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存并开始标注'}
              </button>
            </div>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handlePasteSave(event)}>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">标题（可选）</span>
              <input
                value={paste.title}
                onChange={(event) => setPaste((form) => ({ ...form, title: event.target.value }))}
                placeholder="给这段文本起个名字"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">正文内容</span>
              <textarea
                value={paste.contentMarkdown}
                onChange={(event) => setPaste((form) => ({ ...form, contentMarkdown: event.target.value }))}
                rows={11}
                placeholder="粘贴任意文章 / 笔记 / Markdown 正文，保存后即可在阅读器里高亮、提炼知识点。"
                className="w-full resize-none rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-substrate)] px-3 py-2 text-sm leading-6 text-[var(--ink-primary)] outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={close}
                className="inline-flex h-9 items-center rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-3 text-xs text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)] disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存并开始标注'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
