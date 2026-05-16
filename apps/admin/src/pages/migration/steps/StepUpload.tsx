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
    <div className="migration-step-stack">
      <label
        className="migration-upload-zone"
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
        <p className="migration-upload-title">
          {state.file ? state.file.name : '拖放 VanBlog 导出文件到此处'}
        </p>
        <p className="migration-upload-subtitle">
          或点击选择文件（单文件 JSON，最大 500MB）
        </p>
      </label>

      {state.filePreview && (
        <div className="migration-file-preview">
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
          <div className="migration-preview-grid">
            <PreviewCell label="文章" value={state.filePreview.articles} />
            <PreviewCell label="草稿" value={state.filePreview.drafts} />
            <PreviewCell label="分类" value={state.filePreview.categories} />
            <PreviewCell label="标签" value={state.filePreview.tags} />
            <PreviewCell label="文件大小 KB" value={state.filePreview.sizeKB} />
          </div>
        </div>
      )}

      <div className="migration-wizard-actions">
        <button
          disabled={!state.file}
          onClick={onNext}
          className="migration-button migration-button-primary"
        >
          下一步：配置选项
        </button>
      </div>
    </div>
  );
}

function PreviewCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="migration-mini-stat">
      <div className="migration-mini-stat-label">{label}</div>
      <div className="migration-mini-stat-value">{value}</div>
    </div>
  );
}
