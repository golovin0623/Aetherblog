import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, UserPlus, Trash2, Clock, User as UserIcon } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import type { FolderPermission, PermissionLevel } from '@aetherblog/types';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { permissionService } from '../../services/permissionService';

/**
 * 文件夹权限管理页面
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

interface FolderPermissionsPageProps {
  folderId: number;
  folderName: string;
}

const PERMISSION_LEVELS: { value: PermissionLevel; label: string; description: string }[] = [
  { value: 'VIEW', label: '查看', description: '只能查看文件' },
  { value: 'UPLOAD', label: '上传', description: '可以上传新文件' },
  { value: 'EDIT', label: '编辑', description: '可以编辑文件' },
  { value: 'DELETE', label: '删除', description: '可以删除文件' },
  { value: 'ADMIN', label: '管理员', description: '完全控制权限' },
];

export default function FolderPermissionsPage({ folderId, folderName }: FolderPermissionsPageProps) {
  const queryClient = useQueryClient();
  const [isGranting, setIsGranting] = useState(false);
  const [grantForm, setGrantForm] = useState({
    userId: '',
    permissionLevel: 'VIEW' as PermissionLevel,
    expiresAt: '',
  });

  // 获取权限列表
  const { data: permissionsResponse, isLoading } = useQuery({
    queryKey: ['folder-permissions', folderId],
    queryFn: async () => {
      const response = await permissionService.getPermissions(folderId);
      return response;
    },
  });

  const permissions = permissionsResponse?.data || [];

  // 授予权限
  const grantMutation = useMutation({
    mutationFn: async (data: typeof grantForm) => {
      return permissionService.grant(folderId, {
        userId: parseInt(data.userId),
        permissionLevel: data.permissionLevel,
        expiresAt: data.expiresAt || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-permissions', folderId] });
      toast.success('权限已授予');
      setIsGranting(false);
      setGrantForm({ userId: '', permissionLevel: 'VIEW', expiresAt: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '授予权限失败');
    },
  });

  // 撤销权限
  const revokeMutation = useMutation({
    mutationFn: async (permissionId: number) => {
      return permissionService.revoke(permissionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folder-permissions', folderId] });
      toast.success('权限已撤销');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '撤销权限失败');
    },
  });

  const handleGrant = () => {
    if (!grantForm.userId) {
      toast.error('请输入用户ID');
      return;
    }
    grantMutation.mutate(grantForm);
  };

  const handleRevoke = (permissionId: number) => {
    if (confirm('确定要撤销此权限吗?')) {
      revokeMutation.mutate(permissionId);
    }
  };

  const getPermissionLevelColor = (level: PermissionLevel) => {
    switch (level) {
      case 'VIEW':
        return 'text-blue-400 bg-blue-500/20';
      case 'UPLOAD':
        return 'text-green-400 bg-green-500/20';
      case 'EDIT':
        return 'text-yellow-400 bg-yellow-500/20';
      case 'DELETE':
        return 'text-orange-400 bg-orange-500/20';
      case 'ADMIN':
        return 'text-purple-400 bg-purple-500/20';
      default:
        return 'text-gray-400 bg-gray-500/20';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-muted)]">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">文件夹权限管理</h2>
            <p className="text-sm text-[var(--text-muted)]">{folderName}</p>
          </div>
        </div>

        <Button onClick={() => setIsGranting(!isGranting)} className="gap-2">
          <UserPlus className="w-4 h-4" />
          授予权限
        </Button>
      </div>

      {/* Grant Permission Form */}
      {isGranting && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="p-6 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl"
        >
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">授予新权限</h3>

          <div className="space-y-4">
            {/* User ID */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                用户ID
              </label>
              <input
                type="number"
                value={grantForm.userId}
                onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })}
                placeholder="输入用户ID"
                className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Permission Level */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                权限级别
              </label>
              <div className="grid grid-cols-5 gap-2">
                {PERMISSION_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setGrantForm({ ...grantForm, permissionLevel: level.value })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      grantForm.permissionLevel === level.value
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-white/5 text-[var(--text-secondary)] border border-white/10 hover:bg-white/10'
                    }`}
                    title={level.description}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Expiration Date */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                过期时间 (可选)
              </label>
              <input
                type="datetime-local"
                value={grantForm.expiresAt}
                onChange={(e) => setGrantForm({ ...grantForm, expiresAt: e.target.value })}
                className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleGrant} disabled={grantMutation.isPending} className="flex-1">
                {grantMutation.isPending ? '授予中...' : '授予权限'}
              </Button>
              <Button onClick={() => setIsGranting(false)} variant="secondary" className="flex-1">
                取消
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Permissions List */}
      <div className="space-y-3">
        {permissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Shield className="w-12 h-12 text-[var(--text-muted)] mb-4" />
            <p className="text-[var(--text-muted)]">暂无权限记录</p>
          </div>
        ) : (
          permissions.map((permission, index) => (
            <motion.div
              key={permission.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="relative p-4 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl hover:bg-white/10 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* User Info */}
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <UserIcon className="w-5 h-5 text-primary" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        用户 {permission.userId}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${getPermissionLevelColor(
                          permission.permissionLevel
                        )}`}
                      >
                        {PERMISSION_LEVELS.find((l) => l.value === permission.permissionLevel)?.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          授予于{' '}
                          {formatDistanceToNow(new Date(permission.grantedAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </span>
                      </div>

                      {permission.expiresAt && (
                        <div className="flex items-center gap-1">
                          <span>
                            过期于{' '}
                            {formatDistanceToNow(new Date(permission.expiresAt), {
                              addSuffix: true,
                              locale: zhCN,
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <Button
                  onClick={() => handleRevoke(permission.id)}
                  disabled={revokeMutation.isPending}
                  variant="secondary"
                  size="sm"
                  className="gap-2 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  撤销
                </Button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Info */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-xs text-blue-400">
          💡 提示: 权限按层级递增 (VIEW &lt; UPLOAD &lt; EDIT &lt; DELETE &lt; ADMIN),
          高级别权限包含低级别的所有权限。
        </p>
      </div>
    </div>
  );
}
