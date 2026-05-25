// pages/knowledge/KnowledgeBaseDetailPage.tsx — 知识库详情
//
// 路由：/intelligence/knowledge/:slug
// 三 Tab：
//   - files     文件列表 + 上传（CUSTOM）/ 仅查看（SYSTEM_POSTS）
//   - profiles  Profile 列表 + 创建 + 激活（仅 CUSTOM；SYSTEM 库只展示默认 profile）
//   - members   成员授权（仅 CUSTOM；SYSTEM 库不显示该 tab）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';

import { IntelligenceHeader, IntelligenceShell } from '@/components/intelligence';
import { cn } from '@/lib/utils';
import {
  knowledgeBaseService,
  type CreateKbProfileRequest,
  type KbChunkerKind,
  type KnowledgeBase,
  type KnowledgeBaseFile,
  type KnowledgeBaseMember,
  type KnowledgeBaseProfile,
  type KnowledgeBaseStats,
  type KbVectorStatus,
} from '@/services/knowledgeBaseService';
import { accessService } from '@/services/accessService';
import type { ManagedUser, Role, Team } from '@aetherblog/types';

type Tab = 'files' | 'profiles' | 'members';

export default function KnowledgeBaseDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [stats, setStats] = useState<KnowledgeBaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('files');

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      // 列表通过 slug 找 id —— 用 list+filter（轻量）
      const all = await knowledgeBaseService.list();
      const target = (all.data || []).find((x) => x.slug === slug);
      if (!target) {
        toast.error('知识库不存在或无权访问');
        navigate('/intelligence/knowledge');
        return;
      }
      const [detail, st] = await Promise.all([
        knowledgeBaseService.get(target.id),
        knowledgeBaseService.stats(target.id),
      ]);
      setKb(detail.data);
      setStats(st.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '加载知识库失败');
    } finally {
      setLoading(false);
    }
  }, [slug, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = kb?.effectivePermission === 'MANAGE';
  const canEdit = canManage || kb?.effectivePermission === 'EDIT';
  const isSystem = kb?.kind === 'SYSTEM_POSTS';

  return (
    <IntelligenceShell mode="standard">
      <IntelligenceHeader
        eyebrow="INTELLIGENCE · KNOWLEDGE BASE"
        title={kb?.name || '加载中…'}
        description={kb?.description || ''}
        icon={isSystem ? ShieldCheck : FileText}
        currentLabel={kb?.slug ? `slug: ${kb.slug}` : undefined}
        activeSummary={
          stats
            ? `${stats.fileCount} 文件 · ${stats.chunkCount} 分块 · ${stats.vectorizedCount} 已索引${
                stats.failedCount > 0 ? ` · ${stats.failedCount} 失败` : ''
              }`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/intelligence/knowledge')}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
            >
              <ArrowLeft className="h-4 w-4" /> 返回
            </button>
            {canEdit && !isSystem && (
              <button
                type="button"
                onClick={async () => {
                  if (!kb) return;
                  try {
                    await knowledgeBaseService.reindexAll(kb.id);
                    toast.success('已请求全库重建（请稍后刷新）');
                  } catch (err: any) {
                    toast.error(err?.response?.data?.message || '重建失败');
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
              >
                <RefreshCcw className="h-4 w-4" /> 重建索引
              </button>
            )}
            {isSystem && (
              <button
                type="button"
                onClick={() => navigate('/search-config')}
                title="文章索引库的向量由搜索配置模块管理"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
              >
                <RefreshCcw className="h-4 w-4" /> 到搜索配置重建
              </button>
            )}
          </div>
        }
      />

      {loading || !kb ? (
        <DetailSkeleton />
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} hideMembers={isSystem} />
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {tab === 'files' && (
                <FilesTab kb={kb} canEdit={!!canEdit && !isSystem} onChanged={load} />
              )}
              {tab === 'profiles' && (
                <ProfilesTab kb={kb} canManage={!!canManage} onChanged={load} />
              )}
              {tab === 'members' && !isSystem && (
                <MembersTab kb={kb} canManage={!!canManage} />
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </IntelligenceShell>
  );
}

// ============================================================
// Tabs
// ============================================================

function Tabs({
  value,
  onChange,
  hideMembers,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
  hideMembers: boolean;
}) {
  const items: Array<{ key: Tab; label: string; icon: React.ComponentType<any> }> = [
    { key: 'files', label: '资料文件', icon: FileText },
    { key: 'profiles', label: '索引档案', icon: Wrench },
  ];
  if (!hideMembers) items.push({ key: 'members', label: '成员授权', icon: Users });

  return (
    <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-[var(--bg-card)] p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === it.key
              ? 'bg-primary/10 text-primary'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          <it.icon className="h-4 w-4" /> {it.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Tab: Files
// ============================================================

function FilesTab({
  kb,
  canEdit,
  onChanged,
}: {
  kb: KnowledgeBase;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<KnowledgeBaseFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDialog, setErrorDialog] = useState<KnowledgeBaseFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<KbVectorStatus | ''>('');
  const [bucket, setBucket] = useState<{ year: number; month: number } | null>(null);
  const [stats, setStats] = useState<KnowledgeBaseStats | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof knowledgeBaseService.listFiles>[1] = {
        page: 1,
        pageSize: 50,
      };
      if (statusFilter) params.status = statusFilter;
      if (bucket) {
        params.year = bucket.year;
        params.month = bucket.month;
      }
      const [res, st] = await Promise.all([
        knowledgeBaseService.listFiles(kb.id, params),
        knowledgeBaseService.stats(kb.id),
      ]);
      setFiles(res.data.items || []);
      setStats(st.data);
    } catch (err: any) {
      toast.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  }, [kb.id, statusFilter, bucket]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    const files = Array.from(list);
    // review gemini medium：并发上传（最多 3 路），保持每个 KB 的写桶安全。
    // 完成后统计成功 / 失败，让用户看到部分成功的实际结果而非整体失败。
    const concurrency = 3;
    let succeeded = 0;
    let failed = 0;
    let errMsg = '';
    const queue = files.slice();
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;
        try {
          await knowledgeBaseService.uploadFile(kb.id, file);
          succeeded += 1;
        } catch (err: any) {
          failed += 1;
          if (!errMsg) errMsg = err?.response?.data?.message || `${file.name} 上传失败`;
        }
      }
    });
    try {
      await Promise.all(workers);
      if (failed === 0) {
        toast.success(`已上传 ${succeeded} 个文件，正在向量化…`);
      } else if (succeeded === 0) {
        toast.error(errMsg || '上传全部失败');
      } else {
        toast.warning(`部分成功：${succeeded} 成功 / ${failed} 失败：${errMsg}`);
      }
      await load();
      onChanged();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="mt-4 space-y-4 pb-16 md:pb-0">
      {/* 移动端 sticky 上传按钮（md 以下浮动在底部） */}
      {canEdit && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 md:hidden"
        >
          <CloudUpload className="h-4 w-4" /> 上传
        </button>
      )}
      {canEdit && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'surface-leaf hidden cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/30 p-8 text-center transition-colors hover:border-primary/60 md:flex',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          <CloudUpload className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="text-sm font-medium text-[var(--text-primary)]">
            拖拽文件到此处，或点击选择
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            支持 txt / md / json / csv / pdf / docx（单文件 ≤ 10MB；HTML 出于 XSS 风险已禁用，请先转 markdown）
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* 过滤工具栏：状态 + 时间桶（Phase 2） */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          过滤
        </span>
        {([
          { v: '' as KbVectorStatus | '', label: '全部', tone: 'muted' },
          { v: 'SUCCEEDED' as KbVectorStatus, label: '已索引', tone: 'success' },
          { v: 'PENDING' as KbVectorStatus, label: '排队/处理', tone: 'info' },
          { v: 'FAILED' as KbVectorStatus, label: '失败', tone: 'danger' },
        ] as const).map((opt) => (
          <button
            key={opt.v || 'all'}
            type="button"
            onClick={() => setStatusFilter(opt.v)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              statusFilter === opt.v
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-[var(--text-secondary)] hover:border-primary/40'
            )}
          >
            {opt.label}
          </button>
        ))}
        {bucket && (
          <button
            type="button"
            onClick={() => setBucket(null)}
            className="rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs text-status-warning hover:bg-status-warning/15"
          >
            {bucket.year}-{String(bucket.month).padStart(2, '0')} ×
          </button>
        )}
      </div>

      {stats?.timelineBuckets && stats.timelineBuckets.length > 0 && (
        <div className="surface-leaf overflow-x-auto rounded-xl p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            时间轴 · 近 {stats.timelineBuckets.length} 个月
          </p>
          <div className="flex items-end gap-2">
            {[...stats.timelineBuckets].reverse().map((b) => {
              const active = bucket?.year === b.year && bucket.month === b.month;
              const max = Math.max(...stats.timelineBuckets!.map((x) => x.count));
              const h = Math.max(8, Math.round((b.count / max) * 56));
              return (
                <button
                  type="button"
                  key={`${b.year}-${b.month}`}
                  onClick={() =>
                    setBucket(active ? null : { year: b.year, month: b.month })
                  }
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md px-2 py-1 transition-colors',
                    active ? 'bg-primary/10' : 'hover:bg-[var(--bg-card-hover)]'
                  )}
                  title={`${b.year}-${b.month} · ${b.count} 文件`}
                >
                  <div
                    className={cn(
                      'w-6 rounded-sm',
                      active ? 'bg-primary' : 'bg-[var(--text-tertiary)]/40'
                    )}
                    style={{ height: `${h}px` }}
                  />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    {String(b.month).padStart(2, '0')}/{String(b.year).slice(-2)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="surface-leaf rounded-2xl">
        {loading ? (
          <TableSkeleton />
        ) : files.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--text-muted)]">
            {kb.kind === 'SYSTEM_POSTS' ? '尚无文章可索引' : '尚无文件，点击上方上传开始'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left">文件 / 文章</th>
                <th className="hidden px-4 py-2 text-right md:table-cell">分块</th>
                <th className="px-4 py-2 text-right">状态</th>
                <th className="hidden px-4 py-2 text-right lg:table-cell">时间</th>
                {canEdit && kb.kind !== 'SYSTEM_POSTS' && <th className="w-24 px-4 py-2 text-right">操作</th>}
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <FileRow
                  key={`${f.kbId}-${f.id}`}
                  file={f}
                  kb={kb}
                  canEdit={canEdit}
                  onDelete={async () => {
                    if (!confirm(`确定删除「${f.title || f.filename}」？`)) return;
                    try {
                      await knowledgeBaseService.deleteFile(kb.id, f.id);
                      toast.success('已删除');
                      await load();
                      onChanged();
                    } catch (err: any) {
                      toast.error(err?.response?.data?.message || '删除失败');
                    }
                  }}
                  onReindex={async () => {
                    try {
                      await knowledgeBaseService.reindexFile(kb.id, f.id);
                      toast.success('已触发重建');
                      await load();
                    } catch (err: any) {
                      toast.error(err?.response?.data?.message || '重建失败');
                    }
                  }}
                  onShowError={() => setErrorDialog(f)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {errorDialog && (
        <ErrorDialog file={errorDialog} onClose={() => setErrorDialog(null)} />
      )}
    </div>
  );
}

function FileRow({
  file,
  kb,
  canEdit,
  onDelete,
  onReindex,
  onShowError,
}: {
  file: KnowledgeBaseFile;
  kb: KnowledgeBase;
  canEdit: boolean;
  onDelete: () => void;
  onReindex: () => void;
  onShowError: () => void;
}) {
  const isSystem = kb.kind === 'SYSTEM_POSTS';
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium text-[var(--text-primary)]">
          {file.title || file.filename || `#${file.id}`}
        </div>
        {file.sourceUrl && (
          <a
            href={file.sourceUrl}
            target={isSystem ? '_self' : '_blank'}
            rel="noopener noreferrer"
            className="text-xs text-[var(--text-muted)] hover:text-primary"
          >
            {file.sourceUrl}
          </a>
        )}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">{file.chunkCount}</td>
      <td className="px-4 py-3 text-right">
        <StatusBadge status={file.vectorStatus} onClick={file.vectorError ? onShowError : undefined} />
      </td>
      <td className="hidden px-4 py-3 text-right text-xs text-[var(--text-muted)] lg:table-cell">
        {new Date(file.updatedAt).toLocaleString('zh-CN')}
      </td>
      {canEdit && !isSystem && (
        // review chatgpt-codex P2：SYSTEM_POSTS 行的 id 是 post_id 而非 kb_files.id，
        // 这些按钮调到后端会 404 / no-op，徒增困惑。系统库的索引由「搜索配置」管理，
        // 顶部已经有「到搜索配置重建」入口；行内不再展示重建/删除。
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={onReindex}
              className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-primary"
              title="重建索引"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-status-danger"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function StatusBadge({
  status,
  onClick,
}: {
  status: KbVectorStatus;
  onClick?: () => void;
}) {
  const map: Record<KbVectorStatus, { label: string; tone: string; icon: React.ComponentType<any> }> = {
    PENDING: { label: '排队', tone: 'info', icon: Loader2 },
    RUNNING: { label: '处理中', tone: 'info', icon: Loader2 },
    SUCCEEDED: { label: '已索引', tone: 'success', icon: CheckCircle2 },
    FAILED: { label: '失败', tone: 'danger', icon: AlertTriangle },
    STALE: { label: '过期', tone: 'warn', icon: AlertTriangle },
  };
  const cfg = map[status] || map.PENDING;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        cfg.tone === 'success' && 'bg-status-success/10 text-status-success',
        cfg.tone === 'danger' && 'bg-status-danger/10 text-status-danger',
        cfg.tone === 'warn' && 'bg-status-warning/10 text-status-warning',
        cfg.tone === 'info' && 'bg-primary/10 text-primary',
        onClick && 'cursor-pointer hover:opacity-80'
      )}
    >
      <cfg.icon className={cn('h-3 w-3', status === 'PENDING' || status === 'RUNNING' ? 'animate-spin' : '')} />
      {cfg.label}
    </button>
  );
}

function ErrorDialog({ file, onClose }: { file: KnowledgeBaseFile; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.vectorError || '');
      toast.success('错误内容已复制');
    } catch {
      toast.error('复制失败');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="surface-overlay max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">向量化失败详情</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                文件: <span className="text-[var(--text-secondary)]">{file.title || file.filename}</span>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-status-danger/10 px-2 py-0.5 text-xs font-medium text-status-danger">
              <AlertTriangle className="h-3 w-3" /> FAILED
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Spec label="重试次数" value={file.attemptCount} />
            <Spec label="profile id" value={file.vectorProfileId ?? '-'} />
            <Spec label="文件大小" value={file.fileSize ? `${(file.fileSize / 1024).toFixed(1)} KB` : '-'} />
            <Spec label="最近更新" value={new Date(file.updatedAt).toLocaleString('zh-CN')} />
          </dl>
        </div>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap bg-[var(--bg-card-hover)] p-5 font-mono text-[12px] text-[var(--text-secondary)]">
          {file.vectorError || '（未记录详细错误）'}
        </pre>
        <div className="flex justify-end gap-2 border-t border-border p-3">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-border px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
          >
            复制错误
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
          >
            关闭
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--bg-card-hover)]" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4 space-y-4">
      <div className="h-10 w-64 animate-pulse rounded-lg bg-[var(--bg-card-hover)]" />
      <div className="h-80 animate-pulse rounded-2xl bg-[var(--bg-card-hover)]" />
    </div>
  );
}

// ============================================================
// Tab: Profiles
// ============================================================

function ProfilesTab({
  kb,
  canManage,
  onChanged,
}: {
  kb: KnowledgeBase;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [profiles, setProfiles] = useState<KnowledgeBaseProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseService.listProfiles(kb.id);
      setProfiles(res.data || []);
    } catch {
      toast.error('加载档案失败');
    } finally {
      setLoading(false);
    }
  }, [kb.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          每个档案 = 模型 + 切片策略 + 召回参数。同一时刻只有一个可激活，灵境对话会用 active 档案做召回。
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> 新建档案
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="surface-leaf h-32 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="surface-leaf rounded-2xl p-10 text-center text-sm text-[var(--text-muted)]">
          尚无档案
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              canManage={canManage}
              onActivate={async () => {
                try {
                  await knowledgeBaseService.activateProfile(kb.id, p.id);
                  toast.success(`已激活档案「${p.name}」（指针切换，旧 embeddings 仍保留）`);
                  await load();
                  onChanged();
                } catch (err: any) {
                  toast.error(err?.response?.data?.message || '激活失败');
                }
              }}
              onMigrate={async () => {
                if (!confirm(
                  `蓝绿迁移会用「${p.name}」全量重建当前知识库的索引，整库文件较多时需要数十秒到几分钟。\n` +
                  `期间用户仍走旧 profile 检索；全部 shadow 写入完成后原子切换 active。\n\n继续吗？`,
                )) return;
                try {
                  // 后端 MigrateProfile 已改为异步 goroutine 调度，HTTP 立即返回 ack。
                  // review chatgpt-codex P2 修复：toast 文案必须反映异步语义，不再写"已迁移并激活"
                  // 否则 admin 看到该提示会误以为已完成，实际可能正在 reindex 或失败回滚。
                  await knowledgeBaseService.migrateProfile(kb.id, p.id);
                  toast.success(
                    `已开始迁移到「${p.name}」（后台 reindex 中）。请稍后在「索引档案」与文件列表观察 active 状态切换与文件向量化进度。`,
                    { id: `mig-${p.id}`, duration: 6000 },
                  );
                  await load();
                  onChanged();
                } catch (err: any) {
                  toast.error(err?.response?.data?.message || '迁移启动失败', { id: `mig-${p.id}` });
                }
              }}
              onDelete={async () => {
                if (!confirm(`确定删除档案「${p.name}」？`)) return;
                try {
                  await knowledgeBaseService.deleteProfile(kb.id, p.id);
                  toast.success('已删除');
                  await load();
                } catch (err: any) {
                  toast.error(err?.response?.data?.message || '删除失败');
                }
              }}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateProfileModal
          kbId={kb.id}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            toast.success('档案已创建（status=shadow）');
            await load();
          }}
        />
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  canManage,
  onActivate,
  onMigrate,
  onDelete,
}: {
  profile: KnowledgeBaseProfile;
  canManage: boolean;
  onActivate: () => void;
  onMigrate: () => void;
  onDelete: () => void;
}) {
  const tone =
    profile.status === 'active' ? 'success' : profile.status === 'deprecated' ? 'muted' : 'info';
  return (
    <div className="surface-leaf rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-[var(--text-primary)]">{profile.name}</h4>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            code: {profile.code}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]',
            tone === 'success' && 'bg-status-success/10 text-status-success',
            tone === 'info' && 'bg-primary/10 text-primary',
            tone === 'muted' && 'bg-[var(--bg-card-hover)] text-[var(--text-muted)]'
          )}
        >
          {profile.status}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Spec label="模型" value={profile.modelId} />
        <Spec label="切片" value={profile.chunkerKind} />
        <Spec label="size/overlap" value={`${profile.chunkSizeTokens}/${profile.chunkOverlapTokens}`} />
        <Spec label="top_k / 阈值" value={`${profile.topK} / ${profile.scoreThreshold}`} />
      </dl>
      {canManage && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {profile.status === 'shadow' && (
            <>
              <button
                type="button"
                onClick={onActivate}
                title="仅指针切换：保留旧 embeddings，新 profile 立刻接管检索；不重新计算向量"
                className="rounded-md border border-[var(--text-secondary)]/30 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
              >
                直接激活
              </button>
              <button
                type="button"
                onClick={onMigrate}
                title="蓝绿迁移：用新 profile 全量 reindex，全部成功后原子切换"
                className="rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10"
              >
                迁移并激活
              </button>
            </>
          )}
          {profile.status === 'deprecated' && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-status-danger/40 px-2.5 py-1 text-xs text-status-danger hover:bg-status-danger/10"
            >
              删除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</dt>
      <dd className="truncate text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function CreateProfileModal({
  kbId,
  onClose,
  onCreated,
}: {
  kbId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateKbProfileRequest>({
    code: '',
    name: '',
    description: '',
    modelId: 'text-embedding-3-large',
    chunkerKind: 'recursive',
    chunkSizeTokens: 512,
    chunkOverlapTokens: 64,
    topK: 6,
    scoreThreshold: 0.2,
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim() || !form.modelId.trim()) {
      toast.error('请填写 code / name / modelId');
      return;
    }
    setSubmitting(true);
    try {
      await knowledgeBaseService.createProfile(kbId, form);
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="surface-overlay w-full max-w-xl rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">新建索引档案</h2>
        <form onSubmit={submit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <FieldInput label="code" required value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="例如：high-precision" />
          <FieldInput label="name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="高精度策略" />
          <FieldInput label="modelId" required value={form.modelId} onChange={(v) => setForm({ ...form, modelId: v })} className="md:col-span-2" />
          <FieldSelect
            label="chunkerKind"
            value={form.chunkerKind}
            options={['recursive', 'fixed', 'markdown', 'qa', 'parent_child']}
            onChange={(v) => setForm({ ...form, chunkerKind: v as KbChunkerKind })}
          />
          <FieldNumber label="chunkSizeTokens" value={form.chunkSizeTokens} onChange={(v) => setForm({ ...form, chunkSizeTokens: v })} min={64} max={8192} />
          <FieldNumber label="chunkOverlapTokens" value={form.chunkOverlapTokens} onChange={(v) => setForm({ ...form, chunkOverlapTokens: v })} min={0} max={4096} />
          <FieldNumber label="topK" value={form.topK ?? 6} onChange={(v) => setForm({ ...form, topK: v })} min={1} max={50} />
          <FieldNumber label="scoreThreshold" value={form.scoreThreshold ?? 0.2} onChange={(v) => setForm({ ...form, scoreThreshold: v })} step={0.05} min={0} max={1} />
          <div className="md:col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]">
              取消
            </button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60">
              {submitting ? '创建中…' : '创建（shadow）'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

const inputClass =
  'h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-primary/50 focus:ring-2 focus:ring-primary/15';

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="ml-0.5 text-status-danger">*</span>}
      </span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
    </label>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} min={min} max={max} step={step} className={inputClass} />
    </label>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

// ============================================================
// Tab: Members
// ============================================================

function MembersTab({ kb, canManage }: { kb: KnowledgeBase; canManage: boolean }) {
  const [members, setMembers] = useState<KnowledgeBaseMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseService.listMembers(kb.id);
      setMembers(res.data || []);
    } catch {
      toast.error('加载成员失败');
    } finally {
      setLoading(false);
    }
  }, [kb.id]);

  useEffect(() => {
    load();
  }, [load]);

  const ownerLabel = useMemo(() => {
    if (kb.ownerId) return `User #${kb.ownerId}（隐式 MANAGE）`;
    return '系统库（无 owner）';
  }, [kb.ownerId]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          所有者：<span className="font-medium text-[var(--text-primary)]">{ownerLabel}</span>
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> 添加成员
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--bg-card-hover)]" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="surface-leaf rounded-2xl p-10 text-center text-sm text-[var(--text-muted)]">
          尚未授予其他成员；自己作为所有者拥有完全权限。
        </div>
      ) : (
        <div className="surface-leaf rounded-2xl">
          <table className="w-full text-sm">
            <thead className="text-xs font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left">主体</th>
                <th className="px-4 py-2 text-left">权限</th>
                <th className="hidden px-4 py-2 text-left md:table-cell">到期</th>
                {canManage && <th className="w-24 px-4 py-2 text-right">操作</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-[var(--text-primary)]">
                    <div className="font-medium">{m.principalName || `${m.principalType} #${m.principalId}`}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {m.principalType} · #{m.principalId}
                      {m.grantedByName && ` · 授权人: ${m.grantedByName}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{m.permissionLevel}</td>
                  <td className="hidden px-4 py-3 text-[var(--text-muted)] md:table-cell">
                    {m.expiresAt ? new Date(m.expiresAt).toLocaleString('zh-CN') : '永久'}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm('确定撤销该成员？')) return;
                          try {
                            await knowledgeBaseService.deleteMember(kb.id, m.id);
                            toast.success('已撤销');
                            await load();
                          } catch (err: any) {
                            toast.error(err?.response?.data?.message || '撤销失败');
                          }
                        }}
                        className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-status-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddMemberModal
          kbId={kb.id}
          onClose={() => setAddOpen(false)}
          onAdded={async () => {
            setAddOpen(false);
            toast.success('已授权');
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddMemberModal({
  kbId,
  onClose,
  onAdded,
}: {
  kbId: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [type, setType] = useState<'USER' | 'TEAM' | 'ROLE'>('USER');
  const [principal, setPrincipal] = useState<{ id: number; label: string } | null>(null);
  const [level, setLevel] = useState<'VIEW' | 'USE' | 'EDIT' | 'MANAGE'>('USE');
  const [submitting, setSubmitting] = useState(false);

  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [keyword, setKeyword] = useState('');

  // 切换 principal type 时按需懒加载各自的下拉数据；已加载则直接复用缓存。
  // 故意忽略 users / teams / roles 作为 deps —— 它们由 effect 内部赋值，
  // 加进来会触发重复请求。借助 ref 模式让 lint 不抱怨。
  const cacheRef = useRef({
    USER: false as boolean,
    TEAM: false as boolean,
    ROLE: false as boolean,
  });
  useEffect(() => {
    setPrincipal(null);
    setKeyword('');
    if (type === 'USER' && !cacheRef.current.USER) {
      cacheRef.current.USER = true;
      accessService.listUsers({ pageSize: 200 }).then((r) => setUsers(r.data.list || [])).catch(() => setUsers([]));
    } else if (type === 'TEAM' && !cacheRef.current.TEAM) {
      cacheRef.current.TEAM = true;
      accessService.listTeams().then((r) => setTeams(r.data || [])).catch(() => setTeams([]));
    } else if (type === 'ROLE' && !cacheRef.current.ROLE) {
      cacheRef.current.ROLE = true;
      accessService.listRoles().then((r) => setRoles(r.data || [])).catch(() => setRoles([]));
    }
  }, [type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!principal) {
      toast.error('请选择一个主体');
      return;
    }
    setSubmitting(true);
    try {
      await knowledgeBaseService.upsertMember(kbId, {
        principalType: type,
        principalId: principal.id,
        permissionLevel: level,
      });
      onAdded();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredOptions = (): Array<{ id: number; label: string; sub?: string }> => {
    const kw = keyword.trim().toLowerCase();
    if (type === 'USER') {
      return (users || [])
        .filter((u) => !kw || u.username.toLowerCase().includes(kw) || (u.nickname || '').toLowerCase().includes(kw) || (u.email || '').toLowerCase().includes(kw))
        .slice(0, 50)
        .map((u) => ({ id: u.id, label: u.nickname || u.username, sub: u.email }));
    }
    if (type === 'TEAM') {
      return (teams || [])
        .filter((t) => !kw || t.name.toLowerCase().includes(kw) || t.slug.toLowerCase().includes(kw))
        .map((t) => ({ id: t.id, label: t.name, sub: `${t.memberCount} 成员` }));
    }
    if (type === 'ROLE') {
      return (roles || [])
        .filter((r) => !kw || r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw))
        .map((r) => ({ id: r.id, label: r.name, sub: r.code }));
    }
    return [];
  };

  const loaded = type === 'USER' ? users !== null : type === 'TEAM' ? teams !== null : roles !== null;
  const options = filteredOptions();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="surface-overlay w-full max-w-md rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">添加成员</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          为用户、团队或角色授予知识库权限；owner 隐式 MANAGE 不必再加。
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">类型</span>
            <div className="flex gap-2">
              {(['USER', 'TEAM', 'ROLE'] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setType(v)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    type === v
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-[var(--text-secondary)] hover:border-primary/40'
                  )}
                >
                  {v === 'USER' ? '用户' : v === 'TEAM' ? '团队' : '角色'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">选择 {type === 'USER' ? '用户' : type === 'TEAM' ? '团队' : '角色'}</span>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索…"
              className={inputClass}
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
              {!loaded && (
                <div className="px-3 py-3 text-center text-xs text-[var(--text-muted)]">加载中…</div>
              )}
              {loaded && options.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-[var(--text-muted)]">无匹配结果</div>
              )}
              {loaded && options.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setPrincipal({ id: opt.id, label: opt.label })}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                    principal?.id === opt.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{opt.label}</div>
                    {opt.sub && (
                      <div className="truncate text-[11px] text-[var(--text-muted)]">{opt.sub}</div>
                    )}
                  </div>
                  {principal?.id === opt.id && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </div>
            {principal && (
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                已选：<span className="font-medium text-[var(--text-primary)]">{principal.label}</span>（#{principal.id}）
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">权限等级</span>
            <select value={level} onChange={(e) => setLevel(e.target.value as any)} className={inputClass}>
              <option value="VIEW">VIEW · 只看清单</option>
              <option value="USE">USE · 灵境对话可用</option>
              <option value="EDIT">EDIT · 上传/删除文件</option>
              <option value="MANAGE">MANAGE · 完全控制</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]">
              取消
            </button>
            <button type="submit" disabled={submitting || !principal} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60">
              {submitting ? '提交中…' : '添加'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
