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
  Sparkles
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
}

type TabType = 'profile' | 'security';

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user, updateUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [isLoading, setIsLoading] = useState(false);
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

    setIsLoading(true);
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
      setIsLoading(false);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="个人面板" size="md">
      <div className="flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex p-1 bg-white/5 rounded-xl border border-white/10">
          <button
            onClick={() => setActiveTab('profile')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all",
              activeTab === 'profile'
                ? "bg-primary text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <UserCircle className="w-4 h-4" />
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all",
              activeTab === 'security'
                ? "bg-primary text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Lock className="w-4 h-4" />
            安全设置
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'profile' ? (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Avatar Section */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                  <div className="w-24 h-24 rounded-full border-2 border-white/10 overflow-hidden bg-white/5 flex items-center justify-center group-hover:border-primary/50 transition-all">
                    {avatar ? (
                      <img src={getMediaUrl(avatar)} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-gray-500" />
                    )}
                  </div>
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                  {isLoading && (
                    <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
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
                <p className="text-xs text-gray-500">点击更换头像，支持 JPG/PNG，最大 2MB</p>
              </div>

              {/* Profile Form */}
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={user?.username}
                      disabled
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-500 text-sm cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">昵称</label>
                  <div className="relative group">
                    <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-primary transition-colors" />
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="输入昵称"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">邮箱</label>
                  <div className="relative group">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-primary transition-colors" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="输入邮箱"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
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
              className="space-y-6"
            >
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">当前密码</label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-primary transition-colors" />
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="输入当前密码"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">新密码</label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-primary transition-colors" />
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="输入新密码 (至少8位)"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 ml-1">确认新密码</label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-primary transition-colors" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="再次输入新密码"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    修改密码后，您的当前会话将保持有效。为了安全，建议定期更换密码。
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  修改密码
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
