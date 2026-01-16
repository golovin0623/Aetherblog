import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, User as UserIcon, Lock, Sparkles, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import CryptoJS from 'crypto-js';

// Encryption key - in production this should come from server or env
const ENCRYPTION_KEY = 'AetherBlog@2026!SecureKey#Auth';

// Encrypt password before sending
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
      // Encrypt password before sending
      const encryptedPassword = encryptPassword(password);
      
      const res = await authService.login({ 
        username, 
        password: encryptedPassword,
        encrypted: true // Flag to tell backend this is encrypted
      });
      
      if (res.code === 200 && res.data) {
         const { accessToken, userInfo, mustChangePassword } = res.data;
         const roleStr = (userInfo.roles && userInfo.roles.length > 0) ? userInfo.roles[0] : 'USER';
         // Validate role is one of the allowed values
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
         
         // Check if user must change password on first login
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
    <div className="w-full min-h-screen flex bg-[var(--bg-page)] text-[var(--text-primary)] selection:bg-primary/30 overflow-hidden font-sans">
      {/* Left: Brand/Art Section */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden bg-black"
      >
        {/* Animated Background Mesh */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] bg-indigo-600/20 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-600/10 rounded-full blur-[100px] mix-blend-screen animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay"></div>
          {/* Grid Pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]"></div>
        </div>

        {/* Brand Content */}
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

      {/* Right: Login Form Section */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-8 bg-[var(--bg-card)]/40 backdrop-blur-sm border-l border-[var(--border-subtle)]"
      >
        <div className="w-full max-w-[420px] space-y-8">
          <div className="text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] mb-2">Welcome back</h1>
            <p className="text-[var(--text-secondary)] text-sm">Enter your credentials to access the admin panel.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center gap-2"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {error}
              </motion.div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-primary)] ml-1">Username</label>
                <div className="relative group">
                  <UserIcon className="absolute left-3.5 top-3.5 w-5 h-5 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-primary)] text-[16px] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all hover:bg-[var(--bg-card-hover)]"
                    placeholder="Enter your username"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                 <div className="flex items-center justify-between ml-1">
                   <label className="text-sm font-medium text-[var(--text-primary)]">Password</label>
                   <a href="#" className="text-xs text-primary hover:text-primary/80 transition-colors">Forgot password?</a>
                 </div>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-3.5 w-5 h-5 text-[var(--text-muted)] group-focus-within:text-primary transition-colors" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-12 py-3 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-primary)] text-[16px] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent transition-all hover:bg-[var(--bg-card-hover)]"
                    placeholder="Enter your password"
                    required
                  />
                  {/* Password visibility toggle button */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 w-5 h-5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors focus:outline-none"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "w-full py-3.5 rounded-xl bg-[var(--text-primary)] text-[var(--bg-page)] font-bold text-sm tracking-wide shadow-xl shadow-black/5 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]",
                isLoading && "opacity-70 cursor-not-allowed"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="px-8 text-center text-xs text-[var(--text-muted)]">
            By clicking continue, you agree to our <a href="#" className="underline hover:text-[var(--text-secondary)]">Terms of Service</a> and <a href="#" className="underline hover:text-[var(--text-secondary)]">Privacy Policy</a>.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default LoginPage;
