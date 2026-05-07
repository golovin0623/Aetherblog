import { useRef } from 'react';
import { Upload, FileJson, XCircle } from 'lucide-react';
import type { WizardState } from '../useMigrationWizard';

interface Props {
  state: WizardState;
  onFileChange: (file: File | null) => void;
  onNext: () => void;
}

/** Step 1：拖放上传 + 客户端解析出概览，用户确认后进入 Step 2。 */
export function StepUpload({ state, onFileChange, onNext }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5 sm:space-y-6">
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] surface-raised px-4 py-8 sm:px-6 sm:py-12 text-center hover:border-[var(--aurora-1)] active:border-[var(--aurora-1)]"
        data-interactive
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) onFileChange(f);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <Upload className="mb-3 h-8 w-8 sm:h-10 sm:w-10 text-[var(--aurora-1)]" />
        <p className="text-sm sm:text-base text-[var(--text-primary)] font-display break-all px-2">
          {state.file ? state.file.name : '拖放 VanBlog 导出文件到此处'}
        </p>
        <p className="mt-1 text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-muted)]">
          或点击选择文件（单文件 JSON，最大 500MB）
        </p>
      </label>

      {state.filePreview && (
        <div className="relative rounded-2xl surface-leaf p-4 sm:p-6">
          <button
            onClick={() => onFileChange(null)}
            className="absolute right-3 top-3 sm:right-4 sm:top-4 rounded-full p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] active:bg-[var(--bg-secondary)] touch-manipulation"
            aria-label="移除文件"
          >
            <XCircle className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 sm:gap-3 pr-10">
            <FileJson className="h-5 w-5 text-[var(--aurora-1)] shrink-0" />
            <h3 className="text-xs sm:text-sm uppercase tracking-wide text-[var(--text-muted)]">备份概览</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-3 md:grid-cols-5">
            <PreviewCell label="文章" value={state.filePreview.articles} />
            <PreviewCell label="草稿" value={state.filePreview.drafts} />
            <PreviewCell label="分类" value={state.filePreview.categories} />
            <PreviewCell label="标签" value={state.filePreview.tags} />
            <PreviewCell label="文件大小 KB" value={state.filePreview.sizeKB} />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          disabled={!state.file}
          onClick={onNext}
          className="w-full sm:w-auto rounded-xl bg-[var(--aurora-1)] px-6 py-3 sm:py-2.5 text-sm font-medium text-white disabled:opacity-50 active:scale-[0.98] transition-transform touch-manipulation"
        >
          下一步：配置选项
        </button>
      </div>
    </div>
  );
}

function PreviewCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-muted)] truncate">{label}</div>
      <div className="mt-1 text-xl sm:text-2xl font-display tnum text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
