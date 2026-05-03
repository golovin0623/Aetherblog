import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Layers, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import {
  useSearchProfiles,
  useDeprecateProfile,
  useDeleteProfile,
} from '@/hooks/useSearchProfiles';
import type { SearchProfile } from '@/services/searchProfileService';
import { ProfileListCard } from './ProfileListCard';
import { CreateProfileModal } from './CreateProfileModal';

interface ProfileManagementSectionProps {
  /** 由父组件注入的激活向导触发器；未传则禁用激活按钮（向上一个 commit 兼容）。 */
  onRequestActivate?: (p: SearchProfile) => void;
  /** 由父组件注入的"详情抽屉"触发器；未传则点击行时直接 noop。 */
  onSelectProfile?: (p: SearchProfile) => void;
}

/**
 * Search Profile 管理面板。
 *
 * 嵌入位置：``SearchConfigPage`` 的"向量化状态"卡片与"搜索功能开关"卡片之间。
 * 不开新路由 —— 所有 profile 操作都在搜索配置页完成，避免 admin 在多个页面
 * 之间跳转。
 *
 * 子组件分工：
 *   - ProfileListCard：单条 profile 行（状态徽章 + meta + 操作菜单）
 *   - CreateProfileModal：创建 profile 表单
 *   - ProfileActivationFlow（下个 commit 接入）：多步向导（confirm → SSE reindex → activate）
 *   - ProfileDetailDrawer（下个 commit 接入）：右侧抽屉，展示完整元数据 + 删除确认
 */
export function ProfileManagementSection({
  onRequestActivate,
  onSelectProfile,
}: ProfileManagementSectionProps) {
  const profilesQuery = useSearchProfiles();
  const deprecateMut = useDeprecateProfile();
  const deleteMut = useDeleteProfile();

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SearchProfile | null>(null);

  const profiles = profilesQuery.data ?? [];

  const onDeprecate = async (p: SearchProfile) => {
    try {
      await deprecateMut.mutateAsync(p.code);
      toast.success(`Profile "${p.code}" 已 deprecated`);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || '操作失败';
      toast.error(msg);
    }
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.code);
      toast.success(`Profile "${pendingDelete.code}" 已删除`);
      setPendingDelete(null);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || '删除失败';
      toast.error(msg);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="surface-leaf surface-admin-panel p-6 space-y-5 lg:col-span-2"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <Layers className="w-5 h-5 text-[var(--text-muted)] mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              搜索配置文件管理
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Profile 把 model + chunker + chunk_size + overlap 绑成一个完整索引单元，
              支持蓝绿切换、随时回滚。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => profilesQuery.refetch()}
            disabled={profilesQuery.isFetching}
            className={cn(
              'p-2 rounded-lg text-sm',
              'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              'transition-colors disabled:opacity-50'
            )}
            title="刷新列表"
          >
            <RefreshCw
              className={cn('w-4 h-4', profilesQuery.isFetching && 'animate-spin')}
            />
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm',
              'bg-[var(--aurora-1)] text-white',
              'hover:bg-[color-mix(in_oklch,var(--aurora-1)_85%,white)]',
              'transition-colors shadow-lg shadow-[var(--aurora-1)]/20'
            )}
          >
            <Plus className="w-4 h-4" />
            创建 profile
          </button>
        </div>
      </div>

      {profilesQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 surface-leaf surface-admin-item !rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : profilesQuery.isError ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-300">
            <p className="font-medium">无法加载 profile 列表</p>
            <p className="text-xs text-red-300/80 mt-1">
              {(profilesQuery.error as Error)?.message ?? '请检查 ai-service 是否正常运行'}
            </p>
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-10 text-sm text-[var(--text-muted)]">
          <p className="mb-2">暂无 profile。</p>
          <p className="text-xs">
            点"创建 profile"开始 —— 创建后处于 shadow 状态，需先全量 reindex 再激活。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profiles.map((p) => (
            <ProfileListCard
              key={p.id}
              profile={p}
              onActivate={(prof) => onRequestActivate?.(prof)}
              onDeprecate={onDeprecate}
              onDelete={(prof) => setPendingDelete(prof)}
              onSelect={(prof) => onSelectProfile?.(prof)}
            />
          ))}
        </div>
      )}

      <CreateProfileModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmModal
        isOpen={pendingDelete !== null}
        title="删除 profile"
        variant="danger"
        confirmText={deleteMut.isPending ? '删除中…' : '确认删除'}
        cancelText="取消"
        message={
          pendingDelete
            ? `确定要删除 profile "${pendingDelete.code}" 吗？此操作不可逆。\n\n` +
              '若该 profile 仍有向量行，删除会被后端拒绝（先清空 post_embeddings）。'
            : ''
        }
        onConfirm={onDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {(deprecateMut.isPending || deleteMut.isPending) && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          操作进行中…
        </div>
      )}
    </motion.div>
  );
}
