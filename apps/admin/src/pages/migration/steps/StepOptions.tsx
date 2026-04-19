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
    <div className="space-y-6">
      <section className="rounded-2xl surface-leaf p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">冲突策略</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StrategyCard
            active={o.conflictStrategy === 'skip'}
            title="Skip"
            desc="source_key 已存在时跳过，默认推荐。"
            onClick={() => onChange({ conflictStrategy: 'skip' })}
          />
          <StrategyCard
            active={o.conflictStrategy === 'overwrite'}
            title="Overwrite"
            desc="以 VanBlog 数据覆盖现有记录，标签重建。"
            onClick={() => onChange({ conflictStrategy: 'overwrite' })}
          />
          <StrategyCard
            active={o.conflictStrategy === 'rename'}
            title="Rename"
            desc="作为新记录导入（source_key 追加时间戳后缀）。"
            onClick={() => onChange({ conflictStrategy: 'rename' })}
          />
        </div>
      </section>

      <section className="rounded-2xl surface-leaf p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">开关</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded-xl bg-[var(--bg-secondary)] px-5 py-2.5 text-sm text-[var(--text-primary)]"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="rounded-xl bg-[var(--aurora-1)] px-6 py-2.5 text-sm font-medium text-white"
        >
          下一步：预览分析
        </button>
      </div>
    </div>
  );
}

function StrategyCard({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active
          ? 'border-[var(--aurora-1)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--aurora-1)]/50'
      }`}
    >
      <div className="font-display text-lg text-[var(--text-primary)]">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{desc}</div>
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
    <div className="flex items-start justify-between gap-4 rounded-xl bg-[var(--bg-secondary)] px-4 py-3">
      <div>
        <div className="text-sm text-[var(--text-primary)]">{label}</div>
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
