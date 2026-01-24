import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, User as UserIcon, Lock, Sparkles, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import CryptoJS from 'crypto-js';

// 加密密钥 - 在生产环境中应来自服务器或环境变量
const ENCRYPTION_KEY = 'AetherBlog@2026!SecureKey#Auth';

// 发送前加密密码
const encryptPassword = (password: string): string => {
  const timestamp = Date.now().toString();
  const data = JSON.stringify({ password, timestamp });
  return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
};

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 发送前加密密码
      const encryptedPassword = encryptPassword(password);
      
      const res = await authService.login({ 
        username, 
        password: encryptedPassword,
        encrypted: true // 告知后端此密码已加密的标志
      });
      
      if (res.code === 200 && res.data) {
         const { accessToken, userInfo, mustChangePassword } = res.data;
         const roleStr = (userInfo.roles && userInfo.roles.length > 0) ? userInfo.roles[0] : 'USER';
         // 验证角色是否为允许值之一
         const validRoles = ['ADMIN', 'EDITOR', 'USER'] as const;
         const role = validRoles.includes(roleStr as typeof validRoles[number]) 
           ? (roleStr as 'ADMIN' | 'EDITOR' | 'USER') 
           : 'USER';
         
         const user = {
            id: String(userInfo.id),
            username: userInfo.username,
            nickname: userInfo.nickname,
            avatar: userInfo.avatar || '',
            role
         };
         
         login(user, accessToken);
         
         // 检查用户是否需要在首次登录时更改密码
         if (mustChangePassword) {
            navigate('/change-password', { state: { firstLogin: true } });
         } else {
            navigate('/');
         }
      } else {
         setError(res.message || '登录失败');
      }
    } catch (err: any) {
      logger.error('Login failed:', err);
      setError(err.message || '登录异常，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex bg-black text-white selection:bg-primary/30 overflow-hidden font-sans relative">
      {/* 背景层 - 所有视图共享 */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] bg-indigo-600/15 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-600/10 rounded-full blur-[100px] mix-blend-screen animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
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
             <span className="text-xl font-bold tracking-tight">AetherBlog</span>
           </div>
        </div>

        <div className="relative z-10 max-w-lg">
          <h2 className="text-5xl font-bold leading-tight mb-6 bg-clip-text text-transparent bg-gradient-to-br from-white via-white/90 to-white/50">
            Cognitive Elegance for Your Content.
          </h2>
          <p className="text-lg text-slate-400 font-medium leading-relaxed">
            Experience the next generation of blog management. 
            AI-driven insights, seamless editing, and a design language that inspires.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-sm text-slate-500 font-medium">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>System Operational v1.0.0</span>
        </div>
      </motion.div>

      {/* 右侧：登录表单区域 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-8 relative z-10"
      >
        <div className="w-full max-w-[420px] space-y-8">
          {/* 移动端品牌 */}
          <div className="lg:hidden flex flex-col items-center mb-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/30 mb-4">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">AetherBlog</h1>
            <p className="text-slate-400 text-xs mt-1 font-medium tracking-widest uppercase">Cognitive Elegance</p>
          </div>

          <div className="text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight text-white mb-2">Welcome back</h1>
            <p className="text-slate-400 text-sm">Enter your credentials to access the admin panel.</p>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-6">


            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 ml-1">Username</label>
                <div className="relative group">
                  <UserIcon className="absolute left-4 top-3.5 w-5 h-5 text-slate-500 group-focus-within:text-primary transition-colors" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-[16px] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all hover:bg-white/[0.08]"
                    placeholder="Enter your username"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                 <div className="flex items-center justify-between ml-1">
                   <label className="text-sm font-medium text-slate-300">Password</label>
                   <a href="#" className="text-xs text-primary hover:text-primary/80 transition-colors">Forgot password?</a>
                 </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-3.5 w-5 h-5 text-slate-500 group-focus-within:text-primary transition-colors" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-[16px] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all hover:bg-white/[0.08]"
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "w-full py-4 rounded-xl bg-primary text-white font-bold text-sm tracking-widest shadow-2xl shadow-primary/30 flex items-center justify-center gap-2 transition-all hover:bg-primary/90 active:scale-[0.98]",
                isLoading && "opacity-70 cursor-not-allowed"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span>SIGN IN</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="pt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-transparent px-2 text-slate-500">Secure Access</span></div>
            </div>
          </div>

          <p className="text-center text-[10px] text-slate-500 tracking-wider">
            By continuing, you agree to our <a href="#" className="underline text-slate-400 hover:text-white">Terms</a> and <a href="#" className="underline text-slate-400 hover:text-white">Privacy</a>.
          </p>

          {/* 移动端系统状态 */}
          <div className="lg:hidden flex justify-center items-center gap-2 pt-8 opacity-50">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-slate-500 font-medium tracking-tight">System Operational v1.0.0</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default LoginPage;
