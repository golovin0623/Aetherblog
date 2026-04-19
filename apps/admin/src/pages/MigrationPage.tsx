import { useMigrationWizard, type WizardStep } from './migration/useMigrationWizard';
import { StepUpload } from './migration/steps/StepUpload';
import { StepOptions } from './migration/steps/StepOptions';
import { StepPreview } from './migration/steps/StepPreview';
import { StepExecute } from './migration/steps/StepExecute';
import { StepSummary } from './migration/steps/StepSummary';

/**
 * VanBlog 迁移向导外壳 —— 5 步：上传 → 配置 → 预览 → 执行 → 完成。
 * 嵌在 SettingsPage 的 "数据迁移" Tab 内（见 apps/admin/src/pages/SettingsPage.tsx:423）。
 */
export default function MigrationPage() {
  const wiz = useMigrationWizard();
  const { state } = wiz;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-[var(--text-primary)]">数据迁移 · VanBlog</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          五步向导：上传备份 JSON → 配置选项 → 预览计划 → 流式执行 → 查看结果。
          迁移幂等，重复运行会按 source_key 跳过已导入文章。
        </p>
      </header>

      <Stepper current={state.step} />

      {state.step === 'upload' && (
        <StepUpload
          state={state}
          onFileChange={wiz.setFile}
          onNext={() => wiz.setStep('options')}
        />
      )}

      {state.step === 'options' && (
        <StepOptions
          state={state}
          onChange={wiz.setOptions}
          onBack={() => wiz.setStep('upload')}
          onNext={() => wiz.setStep('preview')}
        />
      )}

      {state.step === 'preview' && (
        <StepPreview
          state={state}
          onAnalyzeStart={wiz.analyzeStart}
          onAnalyzeSuccess={wiz.analyzeSuccess}
          onAnalyzeFailure={wiz.analyzeFailure}
          onSelectedIdsChange={wiz.setSelectedIds}
          onBack={() => wiz.setStep('options')}
          onNext={() => wiz.setStep('execute')}
        />
      )}

      {state.step === 'execute' && (
        <StepExecute
          state={state}
          onExecuteStart={wiz.executeStart}
          onExecuteEvent={wiz.executeEvent}
          onExecuteEnd={wiz.executeEnd}
          onNext={() => wiz.setStep('summary')}
        />
      )}

      {state.step === 'summary' && <StepSummary state={state} onRestart={wiz.reset} />}
    </div>
  );
}

const STEP_LABELS: Record<WizardStep, string> = {
  upload: '上传',
  options: '配置',
  preview: '预览',
  execute: '执行',
  summary: '完成',
};
const STEP_ORDER: WizardStep[] = ['upload', 'options', 'preview', 'execute', 'summary'];

function Stepper({ current }: { current: WizardStep }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {STEP_ORDER.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm tnum ${
                active
                  ? 'border-[var(--aurora-1)] bg-[var(--aurora-1)] text-white'
                  : done
                    ? 'border-[var(--aurora-1)] text-[var(--aurora-1)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-xs uppercase tracking-wide ${
                active ? 'text-[var(--aurora-1)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && (
              <div
                className={`h-px w-6 ${
                  done ? 'bg-[var(--aurora-1)]' : 'bg-[var(--border-subtle)]'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
