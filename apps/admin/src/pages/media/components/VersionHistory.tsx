import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, Trash2, Clock, User, FileText } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { versionService } from '@/services/versionService';

/**
 * 版本历史组件
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

interface VersionHistoryProps {
  fileId: number;
}

export function VersionHistory({ fileId }: VersionHistoryProps) {
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // 获取版本历史
  const { data: versionsResponse, isLoading } = useQuery({
    queryKey: ['media-versions', fileId],
    queryFn: async () => {
      const response = await versionService.getHistory(fileId);
      return response;
    },
  });

  const versions = versionsResponse?.data || [];

  // 恢复版本
  const restoreMutation = useMutation({
    mutationFn: async (versionNumber: number) => {
      return versionService.restore(fileId, versionNumber);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-versions', fileId] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      toast.success('版本已恢复');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '恢复版本失败');
    },
  });

  // 删除版本
  const deleteMutation = useMutation({
    mutationFn: async (versionId: number) => {
      return versionService.delete(versionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-versions', fileId] });
      toast.success('版本已删除');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '删除版本失败');
    },
  });

  const handleRestore = (versionNumber: number) => {
    if (confirm(`确定要恢复到版本 ${versionNumber} 吗？当前版本将被保存为新版本。`)) {
      restoreMutation.mutate(versionNumber);
    }
  };

  const handleDelete = (versionId: number) => {
    if (confirm('确定要删除这个版本吗？此操作无法撤销。')) {
      deleteMutation.mutate(versionId);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-muted)]">加载中...</div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <History className="w-12 h-12 text-[var(--text-muted)] mb-4" />
        <p className="text-[var(--text-muted)]">暂无版本历史</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            版本历史
          </h3>
          <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs font-medium rounded-full">
            {versions.length} 个版本
          </span>
        </div>
      </div>

      {/* 版本列表 */}
      <div className="space-y-3">
        {versions.map((version, index) => {
          const isLatest = index === 0;
          const isSelected = selectedVersion === version.id;

          return (
            <motion.div
              key={version.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`relative p-4 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
              onClick={() => setSelectedVersion(isSelected ? null : version.id)}
            >
              {/* 版本标识 */}
              {isLatest && (
                <div className="absolute top-2 right-2">
                  <span className="px-2 py-0.5 bg-status-success/20 text-status-success text-xs font-medium rounded-full">
                    当前版本
                  </span>
                </div>
              )}

              {/* 版本信息 */}
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        版本 {version.versionNumber}
                      </h4>
                      <p className="text-xs text-[var(--text-muted)]">
                        {formatFileSize(version.fileSize)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 变更描述 */}
                {version.changeDescription && (
                  <p className="text-sm text-[var(--text-secondary)] pl-11">
                    {version.changeDescription}
                  </p>
                )}

                {/* 元数据 */}
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] pl-11">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {formatDistanceToNow(new Date(version.createdAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </span>
                  </div>
                  {version.createdBy && (
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      <span>用户 {version.createdBy}</span>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                {isSelected && !isLatest && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 pt-3 border-t border-white/10 mt-3"
                  >
                    <Button
                      onClick={() => {
                        handleRestore(version.versionNumber);
                      }}
                      disabled={restoreMutation.isPending}
                      size="sm"
                      className="gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      恢复此版本
                    </Button>
                    <Button
                      onClick={() => {
                        handleDelete(version.id);
                      }}
                      disabled={deleteMutation.isPending}
                      variant="secondary"
                      size="sm"
                      className="gap-2 text-status-danger hover:text-status-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </Button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* 提示信息 */}
      <div className="p-4 bg-status-info-light border border-status-info-border rounded-lg">
        <p className="text-xs text-status-info">
          💡 提示: 恢复版本时，当前版本会自动保存为新版本，不会丢失数据。
        </p>
      </div>
    </div>
  );
}
