import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Check, X, Settings, Trash2, TestTube } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { storageProviderService, CreateStorageProviderRequest } from '@/services/storageProviderService';
import type { StorageProvider, StorageProviderType } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@aetherblog/utils';
import { toast } from 'sonner';

/**
 * 存储提供商设置页面
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 */

const PROVIDER_TYPES: { value: StorageProviderType; label: string; description: string }[] = [
  { value: 'LOCAL', label: '本地存储', description: '存储在服务器本地文件系统' },
  { value: 'S3', label: 'AWS S3', description: 'Amazon S3对象存储' },
  { value: 'MINIO', label: 'MinIO', description: '开源对象存储服务' },
  { value: 'OSS', label: '阿里云OSS', description: '阿里云对象存储服务' },
  { value: 'COS', label: '腾讯云COS', description: '腾讯云对象存储' },
];

export default function StorageProviderSettings() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // 获取所有存储提供商
  const { data: providersResponse, isLoading } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
  });

  const providers = providersResponse?.data || [];

  // 删除
  const deleteMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('删除成功');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '删除失败');
    },
  });

  // 设置为默认
  const setDefaultMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.setAsDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
      toast.success('已设置为默认存储');
    },
  });

  // 测试连接
  const testMutation = useMutation({
    mutationFn: (id: number) => storageProviderService.testConnection(id),
    onSuccess: (response) => {
      if (response.data.success) {
        toast.success(response.data.message || '连接测试成功');
      } else {
        toast.error(response.data.message || '连接测试失败');
      }
    },
  });

  const handleDelete = (id: number) => {
    if (confirm('确定要删除这个存储提供商吗？')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
              存储提供商配置
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              管理云存储提供商，支持本地、S3、MinIO、OSS、COS等多种存储方式
            </p>
          </div>

          <Button
            onClick={() => setIsCreating(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            添加存储提供商
          </Button>
        </div>
      </div>

      {/* Provider List */}
      <div className="max-w-6xl mx-auto space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-[var(--text-muted)]">
            加载中...
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <p className="text-[var(--text-muted)]">暂无存储提供商</p>
          </div>
        ) : (
          providers.map((provider) => (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Server className="w-5 h-5 text-primary" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                      {provider.name}
                    </h3>

                    {provider.isDefault && (
                      <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs font-medium rounded-full">
                        默认
                      </span>
                    )}

                    {!provider.isEnabled && (
                      <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-medium rounded-full">
                        已禁用
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm text-[var(--text-secondary)]">
                      类型: {PROVIDER_TYPES.find(t => t.value === provider.providerType)?.label}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      优先级: {provider.priority}
                    </p>
                  </div>

                  {/* Config Preview */}
                  <div className="mt-3 p-3 bg-black/20 rounded-lg">
                    <pre className="text-xs text-[var(--text-muted)] overflow-x-auto">
                      {JSON.stringify(JSON.parse(provider.configJson), null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => testMutation.mutate(provider.id)}
                    disabled={testMutation.isPending}
                    className="p-2 text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="测试连接"
                  >
                    <TestTube className="w-4 h-4" />
                  </button>

                  {!provider.isDefault && (
                    <button
                      onClick={() => setDefaultMutation.mutate(provider.id)}
                      disabled={setDefaultMutation.isPending}
                      className="p-2 text-[var(--text-secondary)] hover:text-green-400 hover:bg-green-400/10 rounded-lg transition-colors"
                      title="设为默认"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(provider.id)}
                    disabled={provider.isDefault || deleteMutation.isPending}
                    className="p-2 text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Create Dialog */}
      <AnimatePresence>
        {isCreating && (
          <CreateProviderDialog
            onClose={() => setIsCreating(false)}
            onSuccess={() => {
              setIsCreating(false);
              queryClient.invalidateQueries({ queryKey: ['storage-providers'] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Create Provider Dialog Component
function CreateProviderDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    providerType: 'LOCAL' as StorageProviderType,
    configJson: '{}',
    isDefault: false,
    isEnabled: true,
    priority: 0,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateStorageProviderRequest) => storageProviderService.create(data),
    onSuccess: () => {
      toast.success('创建成功');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '创建失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  // 根据类型生成默认配置
  const getDefaultConfig = (type: StorageProviderType) => {
    switch (type) {
      case 'LOCAL':
        return JSON.stringify({ basePath: './uploads', urlPrefix: '/uploads' }, null, 2);
      case 'S3':
        return JSON.stringify({
          endpoint: 's3.amazonaws.com',
          bucket: 'my-bucket',
          accessKey: '',
          secretKey: '',
          region: 'us-east-1',
        }, null, 2);
      case 'MINIO':
        return JSON.stringify({
          endpoint: 'localhost:9000',
          bucket: 'aetherblog',
          accessKey: '',
          secretKey: '',
          useSSL: false,
        }, null, 2);
      case 'OSS':
        return JSON.stringify({
          endpoint: 'oss-cn-hangzhou.aliyuncs.com',
          bucket: 'my-bucket',
          accessKeyId: '',
          accessKeySecret: '',
        }, null, 2);
      case 'COS':
        return JSON.stringify({
          region: 'ap-guangzhou',
          bucket: 'my-bucket-1234567890',
          secretId: '',
          secretKey: '',
        }, null, 2);
      default:
        return '{}';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">
          添加存储提供商
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              名称
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
              required
            />
          </div>

          {/* Provider Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              存储类型
            </label>
            <select
              value={formData.providerType}
              onChange={(e) => {
                const type = e.target.value as StorageProviderType;
                setFormData({
                  ...formData,
                  providerType: type,
                  configJson: getDefaultConfig(type),
                });
              }}
              className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
            >
              {PROVIDER_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label} - {type.description}
                </option>
              ))}
            </select>
          </div>

          {/* Config JSON */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              配置 (JSON)
            </label>
            <textarea
              value={formData.configJson}
              onChange={(e) => setFormData({ ...formData, configJson: e.target.value })}
              className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-primary/50"
              rows={10}
              required
            />
          </div>

          {/* Options */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-[var(--text-secondary)]">设为默认</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isEnabled}
                onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-[var(--text-secondary)]">启用</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1"
            >
              {createMutation.isPending ? '创建中...' : '创建'}
            </Button>
            <Button
              type="button"
              onClick={onClose}
              variant="secondary"
              className="flex-1"
            >
              取消
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
