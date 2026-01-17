import * as React from 'react';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Lock,
  Camera,
  Loader2,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Mail,
  UserCircle,
  Sparkles,
  X
} from 'lucide-react';
import { Modal } from '@aetherblog/ui';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { mediaService, getMediaUrl } from '@/services/mediaService';
import { cn } from '@/lib/utils';
import CryptoJS from 'crypto-js';

// Encryption key - must match backend
const ENCRYPTION_KEY = 'AetherBlog@2026!SecureKey#Auth';

// Encrypt password before sending
const encryptPassword = (password: string): string => {
  const timestamp = Date.now().toString();
  const data = JSON.stringify({ password, timestamp });
  return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
};

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  sidebarCollapsed: boolean;
}

type TabType = 'profile' | 'security';

export function UserProfileModal({ isOpen, onClose, sidebarCollapsed }: UserProfileModalProps) {
  const { user, updateUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile State
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [email, setEmail] = useState(user?.email || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');

  // Security State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片大小不能超过 2MB');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const mediaItem = await mediaService.upload(file);
      const res = await authService.updateAvatar(mediaItem.fileUrl);
      if (res.code === 200) {
        setAvatar(mediaItem.fileUrl);
        updateUser({ avatar: mediaItem.fileUrl });
        toast.success('头像更新成功');
      } else {
        toast.error(res.message || '头像更新失败');
      }
    } catch (err: any) {
      toast.error(err.message || '头像上传失败');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      toast.error('昵称不能为空');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authService.updateProfile({ nickname, email });
      if (res.code === 200) {
        updateUser({ nickname, email });
        toast.success('个人信息更新成功');
      } else {
        toast.error(res.message || '更新失败');
      }
    } catch (err: any) {
      toast.error(err.message || '更新异常');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error('新密码长度至少为8位');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('新密码不能与当前密码相同');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authService.changePassword({
        currentPassword: encryptPassword(currentPassword),
        newPassword: encryptPassword(newPassword),
        encrypted: true,
      });

      if (res.code === 200) {
        toast.success('密码修改成功');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(res.message || '密码修改失败');
      }
    } catch (err: any) {
      toast.error(err.message || '操作异常');
    } finally {
      setIsLoading(false);
    }
  };

  // Close on Escape key
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Remove early return to allow AnimatePresence to handle exit
  // if (!isOpen) return null;

  // Dynamic positioning - desktop only
  const leftPosition = sidebarCollapsed ? '70px' : '209px';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Invisible click-away layer */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100]"
            onClick={onClose}
          />

          {/* Premium Popover - Mac OS Dock Style Animation */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.5, y: 100, x: -50 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 100, x: -50 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8
            }}
            className={cn(
              "fixed z-[101] overflow-hidden rounded-2xl flex flex-col",
              // 移动端：全屏居中，留边距
              "inset-4 max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)]",
              // 桌面端：固定尺寸，左下角定位
              "md:bottom-4 md:inset-auto md:w-[380px] md:h-[650px] md:max-h-[calc(100vh-80px)]"
            )}
            style={{
              left: window.innerWidth >= 768 ? leftPosition : undefined,
              background: 'var(--bg-primary)',
              boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.14), 0 16px 32px -8px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--border-subtle)',
              backdropFilter: 'blur(20px)',
              transformOrigin: window.innerWidth >= 768 ? 'bottom left' : 'center'
            }}
          >
            {/* Gradient Top Border Accent */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary via-secondary to-primary/50" />
            
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <UserCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                </div>
                <h2 className="text-sm md:text-base font-semibold text-[var(--text-primary)]">个人面板</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 md:p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-all duration-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-4 md:p-6 overflow-y-auto min-h-0 custom-scrollbar">
              <div className="flex flex-col gap-4 md:gap-6">
                {/* Premium Tabs - Segmented Control */}
                <div className="flex p-1 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] relative isolate">
                  {/* Sliding indicator - absolute positioned */}
                  <motion.div
                    className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border-subtle)]"
                    animate={{ 
                      x: activeTab === 'profile' ? 4 : 'calc(100% + 4px)'
                    }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />

                  <button
                    onClick={() => setActiveTab('profile')}
                    className={cn(
                      "flex-1 relative z-10 flex items-center justify-center gap-1.5 md:gap-2.5 py-2 md:py-2.5 text-xs md:text-sm font-medium rounded-xl transition-colors duration-200",
                      activeTab === 'profile'
                        ? "text-primary"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <UserCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>基本信息</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('security')}
                    className={cn(
                      "flex-1 relative z-10 flex items-center justify-center gap-1.5 md:gap-2.5 py-2 md:py-2.5 text-xs md:text-sm font-medium rounded-xl transition-colors duration-200",
                      activeTab === 'security'
                        ? "text-primary"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Lock className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>安全设置</span>
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {activeTab === 'profile' ? (
                    <motion.div
                      key="profile"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4 md:space-y-6"
                    >
                      {/* Avatar Section - Premium Design */}
                      <div className="flex flex-col items-center gap-3 md:gap-4 py-2">
                        <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                          <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl border-2 border-[var(--border-subtle)] overflow-hidden bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-tertiary)] flex items-center justify-center group-hover:border-primary/50 transition-all duration-300 shadow-lg">
                            {avatar ? (
                              <img src={getMediaUrl(avatar)} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                              <User className="w-8 h-8 md:w-10 md:h-10 text-[var(--text-muted)]" />
                            )}
                          </div>
                          <div className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                            <Camera className="w-5 h-5 md:w-6 md:h-6 text-white" />
                          </div>
                          {isUploadingAvatar && (
                            <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center">
                              <Loader2 className="w-5 h-5 text-primary animate-spin" />
                            </div>
                          )}
                        </div>
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          className="hidden"
                          accept="image/*"
                        />
                        <p className="text-xs text-[var(--text-muted)]">点击更换头像</p>
                      </div>

                      {/* Profile Form */}
                      <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">用户名</label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                            <input
                              type="text"
                              value={user?.username}
                              disabled
                              className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-muted)] text-sm cursor-not-allowed opacity-70"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">昵称</label>
                          <div className="relative group">
                            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                            <input
                              type="text"
                              value={nickname}
                              onChange={(e) => setNickname(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                              placeholder="输入昵称"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">邮箱</label>
                          <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                            <input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                              placeholder="输入邮箱"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-full py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                          保存修改
                        </button>
                      </form>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="security"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 md:space-y-5"
                    >
                      <form onSubmit={handleChangePassword} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">当前密码</label>
                          <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                            <input
                              type={showCurrentPassword ? "text" : "password"}
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              className="w-full pl-10 pr-10 py-2 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                              placeholder="输入当前密码"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">新密码</label>
                          <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                            <input
                              type={showNewPassword ? "text" : "password"}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full pl-10 pr-10 py-2 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                              placeholder="输入新密码 (至少8位)"
                              required
                              minLength={8}
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)] ml-1">确认新密码</label>
                          <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="w-full pl-10 pr-10 py-2 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                              placeholder="再次输入新密码"
                              required
                              minLength={8}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-600 dark:text-amber-200/80 leading-relaxed">
                            修改密码后，当前会话保持有效。建议定期更换密码。
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-full py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                          修改密码
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

