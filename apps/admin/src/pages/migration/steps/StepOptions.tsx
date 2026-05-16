import { Toggle } from '@aetherblog/ui';
import type { WizardState } from '../useMigrationWizard';
import type { ImportOptions } from '@/services/migrationService';

interface Props {
  state: WizardState;
  onChange: (o: Partial<ImportOptions>) => void;
  onBack: () => void;
  onNext: () => void;
}

/** Step 2：冲突策略单选 + 5 个开关。 */
export function StepOptions({ state, onChange, onBack, onNext }: Props) {
  const o = state.options;
  return (
    <div className="migration-step-stack">
      <section className="migration-config-section">
        <h3 className="migration-section-title">冲突策略</h3>
        <div className="migration-strategy-grid">
          <StrategyCard
            active={o.conflictStrategy === 'skip'}
            code="Skip"
            title="跳过重复"
            desc="source_key 已存在时不写入新数据，适合首次迁移后的复跑校验。"
            hint="默认推荐"
            onClick={() => onChange({ conflictStrategy: 'skip' })}
          />
          <StrategyCard
            active={o.conflictStrategy === 'overwrite'}
            code="Overwrite"
            title="覆盖现有"
            desc="用 VanBlog 内容更新命中文章，分类、标签和正文会重新对齐。"
            hint="谨慎使用"
            onClick={() => onChange({ conflictStrategy: 'overwrite' })}
          />
          <StrategyCard
            active={o.conflictStrategy === 'rename'}
            code="Rename"
            title="另存新记录"
            desc="重复文章以新的 source_key 导入，适合保留两份历史版本。"
            hint="保留副本"
            onClick={() => onChange({ conflictStrategy: 'rename' })}
          />
        </div>
      </section>

      <section className="migration-config-section">
        <h3 className="migration-section-title">导入选项</h3>
        <div className="migration-toggle-grid">
          <ToggleRow
            label="保留 createdAt / updatedAt"
            desc="关闭则导入时全部取 NOW()。"
            checked={!!o.preserveTimestamps}
            onChange={(v) => onChange({ preserveTimestamps: v })}
          />
          <ToggleRow
            label="导入隐藏文章 (hidden=true)"
            desc="VanBlog 的隐藏文章会写入但标记 is_hidden=true。"
            checked={!!o.importHidden}
            onChange={(v) => onChange({ importHidden: v })}
          />
          <ToggleRow
            label="导入草稿"
            desc="drafts[] 中的条目以 status=DRAFT 导入。"
            checked={!!o.importDrafts}
            onChange={(v) => onChange({ importDrafts: v })}
          />
          <ToggleRow
            label="导入已删除文章 (deleted=true)"
            desc="当前 VanBlog 版本未暴露 deleted 字段，作为向前兼容开关。"
            checked={!!o.importDeleted}
            onChange={(v) => onChange({ importDeleted: v })}
          />
          <ToggleRow
            label="overwrite 时保留旧密码"
            desc="目标已有 bcrypt 密码时，不用 VanBlog 明文覆盖。"
            checked={!!o.preservePasswords}
            onChange={(v) => onChange({ preservePasswords: v })}
          />
        </div>
      </section>

      <div className="migration-wizard-actions migration-wizard-actions-between">
        <button
          onClick={onBack}
          className="migration-button migration-button-secondary"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="migration-button migration-button-primary"
        >
          下一步：预览分析
        </button>
      </div>
    </div>
  );
}

function StrategyCard({
  active,
  code,
  title,
  desc,
  hint,
  onClick,
}: {
  active: boolean;
  code: string;
  title: string;
  desc: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-active={active}
      className="migration-strategy-card"
    >
      <div className="migration-strategy-topline">
        <span className="migration-strategy-code">{code}</span>
        <span className="migration-strategy-hint">{hint}</span>
      </div>
      <div className="migration-strategy-title">{title}</div>
      <div className="migration-strategy-desc">{desc}</div>
    </button>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="migration-toggle-row">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[var(--text-primary)]">{label}</div>
        <div className="mt-0.5 text-xs text-[var(--text-muted)] leading-relaxed">{desc}</div>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}
