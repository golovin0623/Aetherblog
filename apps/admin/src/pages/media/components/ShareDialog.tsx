import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Share2, Copy, Lock, Calendar, Hash, X, Check } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import type { AccessType } from '@aetherblog/types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { shareService } from '../../../services/shareService';

/**
 * 分享对话框组件
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 */

interface ShareDialogProps {
  fileId?: number;
  folderId?: number;
  onClose: () => void;
}

export function ShareDialog({ fileId, folderId, onClose }: ShareDialogProps) {
  const [shareConfig, setShareConfig] = useState({
    accessType: 'VIEW' as AccessType,
    password: '',
    expiresAt: '',
    maxAccessCount: '',
  });

  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // 创建分享
  const createShareMutation = useMutation({
    mutationFn: async (config: typeof shareConfig) => {
      const apiConfig = {
        accessType: (config.password ? 'password' : 'public') as 'password' | 'public',
        password: config.password || undefined,
        expiresAt: config.expiresAt || undefined,
        maxAccessCount: config.maxAccessCount ? parseInt(config.maxAccessCount) : undefined,
      };

      if (fileId) {
        const response = await shareService.createFileShare(fileId, apiConfig);
        return response.data;
      } else if (folderId) {
        const response = await shareService.createFolderShare(folderId, apiConfig);
        return response.data;
      }
      throw new Error('需要提供 fileId 或 folderId');
    },
    onSuccess: (data) => {
      if (data) {
        setShareLink(data.shareUrl);
        toast.success('分享链接已生成');
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '生成分享链接失败');
    },
  });

  const handleCreateShare = () => {
    createShareMutation.mutate(shareConfig);
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      toast.success('链接已复制到剪贴板');
    }
  };

  const handleCopyPassword = () => {
    if (shareConfig.password) {
      navigator.clipboard.writeText(shareConfig.password);
      toast.success('密码已复制到剪贴板');
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Share2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                创建分享链接
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {fileId ? '分享文件' : '分享文件夹'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!shareLink ? (
          /* Configuration Form */
          <div className="space-y-4">
            {/* Access Type */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                访问权限
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShareConfig({ ...shareConfig, accessType: 'VIEW' })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    shareConfig.accessType === 'VIEW'
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-white/5 text-[var(--text-secondary)] border border-white/10 hover:bg-white/10'
                  }`}
                >
                  仅查看
                </button>
                <button
                  onClick={() => setShareConfig({ ...shareConfig, accessType: 'DOWNLOAD' })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    shareConfig.accessType === 'DOWNLOAD'
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-white/5 text-[var(--text-secondary)] border border-white/10 hover:bg-white/10'
                  }`}
                >
                  允许下载
                </button>
              </div>
            </div>

            {/* Password Protection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
                <Lock className="w-4 h-4" />
                密码保护 (可选)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={shareConfig.password}
                  onChange={(e) => setShareConfig({ ...shareConfig, password: e.target.value })}
                  placeholder="留空则不设置密码"
                  className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </div>

            {/* Expiration Date */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
                <Calendar className="w-4 h-4" />
                过期时间 (可选)
              </label>
              <input
                type="datetime-local"
                value={shareConfig.expiresAt}
                onChange={(e) => setShareConfig({ ...shareConfig, expiresAt: e.target.value })}
                className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Max Access Count */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
                <Hash className="w-4 h-4" />
                最大访问次数 (可选)
              </label>
              <input
                type="number"
                value={shareConfig.maxAccessCount}
                onChange={(e) => setShareConfig({ ...shareConfig, maxAccessCount: e.target.value })}
                placeholder="留空则不限制"
                min="1"
                className="w-full px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4">
              <Button
                onClick={handleCreateShare}
                disabled={createShareMutation.isPending}
                className="flex-1"
              >
                {createShareMutation.isPending ? '生成中...' : '生成分享链接'}
              </Button>
              <Button
                onClick={onClose}
                variant="secondary"
                className="flex-1"
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          /* Share Link Result */
          <div className="space-y-4">
            {/* Success Message */}
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <Check className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-sm font-medium text-green-400">分享链接已生成</p>
                <p className="text-xs text-green-400/70">链接已复制到剪贴板</p>
              </div>
            </div>

            {/* Share Link */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                分享链接
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] text-sm"
                />
                <Button
                  onClick={handleCopyLink}
                  variant="secondary"
                  size="sm"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Password (if set) */}
            {shareConfig.password && (
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  访问密码
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareConfig.password}
                    readOnly
                    className="flex-1 px-4 py-2 bg-[var(--bg-secondary)] border border-white/10 rounded-lg text-[var(--text-primary)] text-sm font-mono"
                  />
                  <Button
                    onClick={handleCopyPassword}
                    variant="secondary"
                    size="sm"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Share Info */}
            <div className="p-4 bg-white/5 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">访问权限:</span>
                <span className="text-[var(--text-primary)]">
                  {shareConfig.accessType === 'VIEW' ? '仅查看' : '允许下载'}
                </span>
              </div>
              {shareConfig.expiresAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-muted)]">过期时间:</span>
                  <span className="text-[var(--text-primary)]">
                    {new Date(shareConfig.expiresAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              )}
              {shareConfig.maxAccessCount && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-muted)]">最大访问次数:</span>
                  <span className="text-[var(--text-primary)]">
                    {shareConfig.maxAccessCount}
                  </span>
                </div>
              )}
            </div>

            {/* Close Button */}
            <Button
              onClick={onClose}
              className="w-full"
            >
              完成
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}
