import { useState } from 'react';
import { toast } from 'sonner';
import { postService, ImportVanBlogResult } from '@/services/postService';
import { Upload, FileJson, PlayCircle, FlaskConical } from 'lucide-react';

export default function MigrationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportVanBlogResult | null>(null);
  const [loadingMode, setLoadingMode] = useState<'dry-run' | 'execute' | null>(null);

  const handleImport = async (mode: 'dry-run' | 'execute') => {
    if (!file) {
      toast.error('请先选择 VanBlog 导出 JSON 文件');
      return;
    }
    setLoadingMode(mode);
    try {
      const res = await postService.importVanBlog(file, mode);
      if (res.code !== 200 || !res.data) {
        throw new Error(res.message || '导入失败');
      }
      setResult(res.data);
      toast.success(mode === 'dry-run' ? 'Dry-run 完成' : '正式导入完成');
    } catch (error: any) {
      toast.error(error.message || '导入失败');
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">数据迁移</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">上传 VanBlog 后台导出的 JSON，先执行 dry-run，再正式导入。</p>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-6 py-10 text-center hover:border-primary/50">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Upload className="mb-3 h-8 w-8 text-primary" />
          <p className="text-sm text-[var(--text-primary)]">{file ? file.name : '点击选择 VanBlog 导出文件'}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">支持后台整站导出 JSON</p>
        </label>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => handleImport('dry-run')}
            disabled={!file || !!loadingMode}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-4 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-subtle)] disabled:opacity-50"
          >
            <FlaskConical className="h-4 w-4" />
            {loadingMode === 'dry-run' ? '分析中...' : 'Dry-run'}
          </button>
          <button
            onClick={() => handleImport('execute')}
            disabled={!file || !!loadingMode}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            <PlayCircle className="h-4 w-4" />
            {loadingMode === 'execute' ? '导入中...' : '正式导入'}
          </button>
        </div>
      </div>

      {result && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
            <div className="mb-4 flex items-center gap-2">
              <FileJson className="h-4 w-4 text-primary" />
              <h2 className="text-base font-medium text-[var(--text-primary)]">迁移摘要</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {Object.entries(result.summary).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-[var(--bg-secondary)] px-4 py-3">
                  <div className="text-xs text-[var(--text-muted)]">{key}</div>
                  <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
              <h2 className="mb-3 text-base font-medium text-[var(--text-primary)]">Warnings</h2>
              <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                {result.warnings.length > 0 ? result.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">{warning}</div>
                )) : <div className="text-[var(--text-muted)]">无</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
              <h2 className="mb-3 text-base font-medium text-[var(--text-primary)]">Errors</h2>
              <div className="space-y-2 text-sm text-red-400">
                {result.errors.length > 0 ? result.errors.map((error, index) => (
                  <div key={`${error}-${index}`} className="rounded-lg bg-red-500/10 px-3 py-2">{error}</div>
                )) : <div className="text-[var(--text-muted)]">无</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
