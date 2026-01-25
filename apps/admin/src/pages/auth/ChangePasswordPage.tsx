import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Lock, ShieldCheck, ArrowRight, AlertCircle, Sparkles, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import CryptoJS from 'crypto-js';

// 加密密钥 - 必须与后端匹配
const ENCRYPTION_KEY = 'AetherBlog@2026!SecureKey#Auth';

// 发送前加密密码
const encryptPassword = (password: string): string => {
  const timestamp = Date.now().toString();
  const data = JSON.stringify({ password, timestamp });
  return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
};

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  
  // 检查是否为首次登录强制修改密码
  const isFirstLogin = location.state?.firstLogin === true;

  const validatePasswords = () => {
    if (newPassword.length < 8) {
      setError('新密码长度至少为8位');
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return false;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validatePasswords()) {
      return;
    }

    setIsLoading(true);

    try {
      // 发送前加密密码
      const res = await authService.changePassword({
        currentPassword: encryptPassword(currentPassword),
        newPassword: encryptPassword(newPassword),
        encrypted: true,
      });
      
      if (res.code === 200) {
        setSuccess(true);
        // 修改密码成功后，登出并重定向到登录页
        setTimeout(() => {
          logout();
          navigate('/login', { 
            state: { message: '密码修改成功，请使用新密码登录' } 
          });
        }, 2000);
      } else {
        setError(res.message || '密码修改失败');
      }
    } catch (err: any) {
      logger.error('Change password failed:', err);
      setError(err.message || '密码修改异常，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex bg-black text-white selection:bg-amber-500/30 overflow-hidden font-sans relative">
      {/* 背景层 - 共享 */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] bg-amber-600/10 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-orange-600/5 rounded-full blur-[100px] mix-blend-screen animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
        {/* 网格图案 */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]"></div>
      </div>

      {/* 左侧：品牌/艺术区域 (仅桌面端) */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden border-r border-white/5"
      >
        {/* 品牌内容 */}
        <div className="relative z-10">
           <div className="inline-flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
               <Sparkles className="w-6 h-6 text-white" />
             </div>
             <span className="text-xl font-bold tracking-tight text-white">AetherBlog</span>
           </div>
        </div>

        <div className="relative z-10 max-w-lg">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/30 mb-8">
            <KeyRound className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-5xl font-bold leading-tight mb-6 bg-clip-text text-transparent bg-gradient-to-br from-white via-white/90 to-white/50">
            Account Security First.
          </h2>
          <p className="text-lg text-slate-400 font-medium leading-relaxed">
            Your security is our top priority. 
            A strong password helps protect your account from unauthorized access.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-sm text-slate-500 font-medium">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
          <span>Security Update Required</span>
        </div>
      </motion.div>

      {/* 右侧：表单区域 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-8 relative z-10"
      >
        <div className="w-full max-w-[420px] space-y-8">
          {/* 移动端品牌 */}
          <div className="lg:hidden flex flex-col items-center mb-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-amber-500/20 mb-4">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Security Center</h1>
            <p className="text-amber-500/70 text-[10px] mt-1 font-bold tracking-[0.2em] uppercase">Identity Protection</p>
          </div>

          <div className="text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight text-white mb-2">
              {isFirstLogin ? 'Set New Password' : 'Change Password'}
            </h1>
            <p className="text-slate-400 text-sm">
              {isFirstLogin 
                ? 'For security, please set a new password before continuing.' 
                : 'Enter your current password and choose a new one.'}
            </p>
          </div>

          {/* 成功状态 */}
          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-12"
            >
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-tr from-green-500 to-emerald-600 flex items-center justify-center shadow-xl shadow-green-500/30">
                <ShieldCheck className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-3">Password Updated!</h2>
              <p className="text-slate-400 text-sm">Redirecting to login page...</p>
              <div className="mt-6 flex justify-center">
                <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
              </div>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 首次登录警告 */}
              {isFirstLogin && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm flex items-start gap-3"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-semibold text-amber-300">Security Notice</p>
                    <p className="text-amber-200/70 mt-1 leading-relaxed">
                      First login detected. Please update your credentials.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* 错误消息 */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex items-center gap-3"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  {error}
                </motion.div>
              )}

              {/* 表单字段 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 ml-1">Current Password</label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-3.5 w-5 h-5 text-slate-500 group-focus-within:text-amber-400 transition-colors" />
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-[16px] placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all hover:bg-white/[0.08]"
                      placeholder="Current password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                      tabIndex={-1}
                    >
                      {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 ml-1">New Password</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-3.5 w-5 h-5 text-slate-500 group-focus-within:text-amber-400 transition-colors" />
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-[16px] placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all hover:bg-white/[0.08]"
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                      tabIndex={-1}
                    >
                      {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 ml-1">Confirm New Password</label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-4 top-3.5 w-5 h-5 text-slate-500 group-focus-within:text-amber-400 transition-colors" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-[16px] placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent transition-all hover:bg-white/[0.08]"
                      placeholder="Confirm new password"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* 密码要求 */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Password Health</p>
                <ul className="space-y-2">
                  <li className={cn(
                    "text-xs flex items-center gap-2 transition-colors",
                    newPassword.length >= 8 ? "text-green-400" : "text-slate-500"
                  )}>
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]",
                      newPassword.length >= 8 ? "bg-green-400 shadow-green-400/50" : "bg-slate-700"
                    )} />
                    Minimum length of 8 characters
                  </li>
                  <li className={cn(
                    "text-xs flex items-center gap-2 transition-colors",
                    newPassword === confirmPassword && newPassword.length > 0 ? "text-green-400" : "text-slate-500"
                  )}>
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]",
                      newPassword === confirmPassword && newPassword.length > 0 ? "bg-green-400 shadow-green-400/50" : "bg-slate-700"
                    )} />
                    Password confirmation matches
                  </li>
                </ul>
              </div>

              {/* 提交按钮 */}
              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  "w-full py-4 rounded-xl bg-white text-black font-bold text-sm tracking-widest shadow-2xl shadow-white/5 flex items-center justify-center gap-2 transition-all hover:bg-slate-200 active:scale-[0.98]",
                  isLoading && "opacity-70 cursor-not-allowed"
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Updating...</span>
                  </>
                ) : (
                  <>
                    <span>UPDATE PASSWORD</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {/* 返回链接 */}
              {!isFirstLogin && (
                <div className="text-center">
                  <button 
                    type="button"
                    onClick={() => navigate(-1)}
                    className="text-xs text-slate-500 hover:text-white transition-colors flex items-center justify-center gap-2 mx-auto"
                  >
                    <span>← Return to Security</span>
                  </button>
                </div>
              )}
            </form>
          )}

          <p className="text-center text-[10px] text-slate-600 tracking-wider">
            Your credentials are protected by industrial-grade encryption.
          </p>

          {/* 移动端状态 */}
          <div className="lg:hidden flex justify-center items-center gap-2 pt-8 opacity-40">
            <div className="w-1 h-1 bg-amber-500 rounded-full" />
            <span className="text-[10px] text-slate-500 font-medium tracking-widest uppercase">Secured Environment</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default ChangePasswordPage;
