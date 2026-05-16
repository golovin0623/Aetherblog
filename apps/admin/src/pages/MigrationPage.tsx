import { AnimatePresence, motion } from 'framer-motion';
import type { CSSProperties } from 'react';
import { Activity, CheckCircle2, ClipboardCheck, SlidersHorizontal, Upload } from 'lucide-react';
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
  const activeMeta = STEP_META[state.step];
  const currentIndex = STEP_ORDER.indexOf(state.step);
  const ActiveIcon = activeMeta.icon;

  return (
    <div className="migration-workflow">
      <header className="migration-hero">
        <div className="migration-hero-copy">
          <div className="migration-eyebrow">VanBlog Migration</div>
          <h1>数据迁移</h1>
          <p>导入 VanBlog 备份，先预览计划，再按 source_key 幂等写入。</p>
        </div>
        <div className="migration-current-card" aria-label="当前迁移步骤">
          <span className="migration-current-index">{currentIndex + 1}/{STEP_ORDER.length}</span>
          <span className="migration-current-icon">
            <ActiveIcon className="h-4 w-4" />
          </span>
          <div>
            <span className="migration-current-label">{activeMeta.label}</span>
            <span className="migration-current-desc">{activeMeta.description}</span>
          </div>
        </div>
        <div className="migration-current-footer">
          <div className="migration-current-meter" aria-hidden="true">
            <span style={{ width: `${((currentIndex + 1) / STEP_ORDER.length) * 100}%` }} />
          </div>
          <div className="migration-current-rules">
            <span>预览后执行</span>
            <span>source_key 幂等</span>
            <span>SSE 进度</span>
          </div>
        </div>
      </header>

      <Stepper current={state.step} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={state.step}
          initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="migration-step-body"
        >
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const STEP_META: Record<WizardStep, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Upload;
}> = {
  upload: {
    label: '上传备份',
    shortLabel: '上传',
    description: '选择 VanBlog JSON 文件',
    icon: Upload,
  },
  options: {
    label: '配置策略',
    shortLabel: '配置',
    description: '确认冲突和保留规则',
    icon: SlidersHorizontal,
  },
  preview: {
    label: '预览计划',
    shortLabel: '预览',
    description: '核对导入、复用和跳过项',
    icon: ClipboardCheck,
  },
  execute: {
    label: '流式执行',
    shortLabel: '执行',
    description: '实时写入并追踪进度',
    icon: Activity,
  },
  summary: {
    label: '查看结果',
    shortLabel: '完成',
    description: '检查统计和异常记录',
    icon: CheckCircle2,
  },
};
const STEP_ORDER: WizardStep[] = ['upload', 'options', 'preview', 'execute', 'summary'];

function Stepper({ current }: { current: WizardStep }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <ol className="migration-stepper" style={{ '--migration-progress': `${(idx / (STEP_ORDER.length - 1)) * 100}%` } as CSSProperties}>
      <svg className="migration-step-connectors migration-step-connectors-expanded" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 16 27 H 50" data-lit={idx >= 1} />
        <path d="M 50 27 H 84" data-lit={idx >= 2} />
        <path d="M 84 27 C 92 27 92 73 50 73" data-lit={idx >= 3} />
        <path d="M 50 73 H 84" data-lit={idx >= 4} />
      </svg>
      <svg className="migration-step-connectors migration-step-connectors-compact" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 10 10 H 30" data-lit={idx >= 1} />
        <path d="M 30 10 H 50" data-lit={idx >= 2} />
        <path d="M 50 10 H 70" data-lit={idx >= 3} />
        <path d="M 70 10 H 90" data-lit={idx >= 4} />
      </svg>
      {STEP_ORDER.map((s, i) => {
        const meta = STEP_META[s];
        const Icon = meta.icon;
        const active = i === idx;
        const done = i < idx;
        return (
          <li
            key={s}
            className="migration-step"
            data-active={active}
            data-done={done}
          >
            <span className="migration-step-node">
              {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </span>
            <span className="migration-step-copy">
              <span className="migration-step-label">{meta.shortLabel}</span>
              <span className="migration-step-description">{meta.description}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
