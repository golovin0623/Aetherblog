// pages/knowledge/KnowledgeBasePage.tsx — 知识库列表（卡片网格）
//
// 路由：/intelligence/knowledge
// 设计：
//   - IntelligenceShell + IntelligenceHeader 复用 INTELLIGENCE 板块统一外壳
//   - 系统库（文章索引库）固定置顶并带 mono uppercase "系统" 徽章；不可删
//   - 用户库按 created_at DESC 排列，点卡片进详情
//   - Phase1 移动端 = 单列；桌面 ≥ lg 双列；超大屏 ≥ xl 三列
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Library, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { IntelligenceHeader, IntelligenceShell } from '@/components/intelligence';
import { cn } from '@/lib/utils';
import {
  knowledgeBaseService,
  type KnowledgeBase,
  type CreateKnowledgeBaseRequest,
} from '@/services/knowledgeBaseService';

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<KnowledgeBase[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseService.list();
      setItems(res.data || []);
    } catch (err) {
      toast.error('加载知识库失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <IntelligenceShell mode="standard">
      <IntelligenceHeader
        eyebrow="INTELLIGENCE · KNOWLEDGE"
        title="知识库"
        description="管理面向灵境对话的资源库：上传文档、维护向量索引、配置成员权限。"
        icon={Library}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> 新建知识库
          </button>
        }
      />

      {loading && <ListSkeleton />}

      {!loading && items && items.length === 0 && (
        <div className="surface-leaf rounded-xl p-12 text-center">
          <Library className="mx-auto mb-3 h-12 w-12 text-[var(--text-muted)]" />
          <p className="text-base font-medium text-[var(--text-primary)]">尚无知识库</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            创建第一个知识库，灵境对话即可基于你的资料作答。
          </p>
        </div>
      )}

      {!loading && items && items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((kb, i) => (
            <KBCard
              key={kb.id}
              kb={kb}
              index={i}
              onOpen={() => navigate(`/intelligence/knowledge/${kb.slug}`)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateKBModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (kb) => {
            setCreateOpen(false);
            toast.success(`知识库「${kb.name}」已创建`);
            await load();
            navigate(`/intelligence/knowledge/${kb.slug}`);
          }}
        />
      )}
    </IntelligenceShell>
  );
}

// ============================================================
// 卡片
// ============================================================

function KBCard({ kb, index, onOpen }: { kb: KnowledgeBase; index: number; onOpen: () => void }) {
  const isSystem = kb.kind === 'SYSTEM_POSTS';
  const statusTone =
    kb.failedCount > 0
      ? 'danger'
      : kb.vectorizedCount === kb.fileCount && kb.fileCount > 0
      ? 'success'
      : 'info';

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.18) }}
      className={cn(
        'group surface-leaf relative flex flex-col gap-3 rounded-2xl p-5 text-left transition-all',
        'hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
            style={{ background: kb.color || '#6366f1' }}
          >
            {isSystem ? <BookOpen className="h-5 w-5" /> : <Library className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{kb.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">
              {kb.description || '（暂无描述）'}
            </p>
          </div>
        </div>
        {isSystem && (
          <span className="inline-flex items-center gap-1 rounded-full border border-status-success/30 bg-status-success/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-status-success">
            <ShieldCheck className="h-3 w-3" /> 系统
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Stat label="文件" value={kb.fileCount} />
        <Stat label="分块" value={kb.chunkCount} />
        <Stat
          label="失败"
          value={kb.failedCount}
          tone={kb.failedCount > 0 ? 'danger' : 'muted'}
        />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
            statusTone === 'success' && 'bg-status-success/10 text-status-success',
            statusTone === 'danger' && 'bg-status-danger/10 text-status-danger',
            statusTone === 'info' && 'bg-[var(--bg-card-hover)] text-[var(--text-secondary)]'
          )}
        >
          {statusTone === 'success'
            ? '已索引'
            : statusTone === 'danger'
            ? '部分失败'
            : kb.fileCount === 0
            ? '空库'
            : '处理中'}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {kb.activeProfile?.code || 'default'}
        </span>
      </div>
    </motion.button>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'muted' | 'danger';
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-card-hover)] px-2 py-1.5 text-center">
      <div
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'danger' ? 'text-status-danger' : 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}

// ============================================================
// 骨骼
// ============================================================

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="surface-leaf animate-pulse space-y-3 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-[var(--bg-card-hover)]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[var(--bg-card-hover)]" />
              <div className="h-3 w-1/2 rounded bg-[var(--bg-card-hover)]" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-12 rounded-lg bg-[var(--bg-card-hover)]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 新建知识库弹窗
// ============================================================

function CreateKBModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (kb: KnowledgeBase) => void;
}) {
  const [form, setForm] = useState<CreateKnowledgeBaseRequest>({
    name: '',
    description: '',
    visibility: 'PRIVATE',
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('请填写名称');
      return;
    }
    setSubmitting(true);
    try {
      const res = await knowledgeBaseService.create(form);
      onCreated(res.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="surface-overlay w-full max-w-lg rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">新建知识库</h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          创建后会自动在媒体库的受控目录下分配归档空间，并生成默认索引档案。
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="名称" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：技术参考"
              className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              autoFocus
            />
          </Field>
          <Field label="标识 (slug)" hint="留空则从名称自动派生；仅小写字母数字和短横线">
            <input
              type="text"
              value={form.slug || ''}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="可选"
              className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </Field>
          <Field label="描述">
            <textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              placeholder="这个知识库的用途与范围"
            />
          </Field>
          <Field label="可见性">
            <div className="flex gap-2">
              {(['PRIVATE', 'TEAM', 'PUBLIC'] as const).map((v) => (
                <label
                  key={v}
                  className={cn(
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    form.visibility === v
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-[var(--text-secondary)] hover:border-primary/40'
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={form.visibility === v}
                    onChange={() => setForm({ ...form, visibility: v })}
                    className="sr-only"
                  />
                  {v === 'PRIVATE' ? '仅自己' : v === 'TEAM' ? '团队' : '公开'}
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-status-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}
