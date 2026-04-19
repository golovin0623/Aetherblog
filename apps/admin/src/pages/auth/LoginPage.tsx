import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, User as UserIcon, Lock, Sparkles, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { spring, transition, variants } from '@aetherblog/ui';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

// NOTE: 本页设计语言锚定 `apps/blog/app/design/` + `apps/blog/app/about/` 里建立的
// Aether Codex 规范 —— surface-overlay / --ink-* / --aurora-* / Fraunces display.
// 双主题由 tokens 自动适配（:root.light 在 packages/ui/src/styles/tokens.css
// 反转 ink / bg / signal 色），不在本文件里手写 dark: variant.
export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await authService.login({
        username,
        password,
      });

      if (res.code === 200 && res.data) {
        const { userInfo, mustChangePassword } = res.data;
        const roleStr = (userInfo.roles && userInfo.roles.length > 0) ? userInfo.roles[0] : 'USER';
        const validRoles = ['ADMIN', 'EDITOR', 'USER'] as const;
        const role = validRoles.includes(roleStr as typeof validRoles[number])
          ? (roleStr as 'ADMIN' | 'EDITOR' | 'USER')
          : 'USER';

        const user = {
          id: String(userInfo.id),
          username: userInfo.username,
          nickname: userInfo.nickname,
          avatar: userInfo.avatar || '',
          role,
        };

        login(user);

        if (mustChangePassword) {
          navigate('/change-password', { state: { firstLogin: true } });
        } else {
          const from = (location.state as any)?.from?.pathname || '/';
          navigate(from, { replace: true });
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
    <div className="relative w-full min-h-screen flex bg-[var(--bg-void)] text-[var(--ink-primary)] font-sans overflow-hidden selection:bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]">
      {/* Ambient 背景:极光辉光 + 微噪点 + 网格(只在暗模式可见)
          所有色值用 aurora tokens —— 暗/亮模式自动渐变,无需 dark: variant. */}
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-[-25%] left-[-15%] w-[70%] h-[70%] rounded-full blur-[140px] opacity-70"
          style={{
            background: 'radial-gradient(circle, color-mix(in oklch, var(--aurora-1) 22%, transparent) 0%, transparent 70%)',
            animation: 'breath 12s var(--ease-in-out, ease-in-out) infinite',
          }}
        />
        <div
          className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-60"
          style={{
            background: 'radial-gradient(circle, color-mix(in oklch, var(--aurora-2) 20%, transparent) 0%, transparent 70%)',
            animation: 'breath 14s var(--ease-in-out, ease-in-out) 2s infinite',
          }}
        />
        <div className="absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)] bg-[linear-gradient(var(--ink-primary)_1px,transparent_1px),linear-gradient(90deg,var(--ink-primary)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* 左侧:品牌/宣言区(桌面端) —— 参考 /about Hero + /design S1 排版语言 */}
      <motion.div
        variants={variants.fadeUp}
        initial="initial"
        animate="animate"
        transition={transition.flow}
        className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden border-r border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
      >
        {/* Wordmark */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'color-mix(in oklch, var(--aurora-1) 20%, transparent)',
                boxShadow: '0 0 32px color-mix(in oklch, var(--aurora-1) 40%, transparent), 0 1px 0 inset color-mix(in oklch, var(--aurora-1) 30%, transparent)',
              }}
            >
              <Sparkles className="w-5 h-5 text-[var(--aurora-1)]" strokeWidth={1.75} />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-[var(--ink-primary)]">AetherBlog</span>
          </div>
        </div>

        {/* 宣言 —— Fraunces display + Instrument Serif 副标 */}
        <div className="relative z-10 max-w-xl space-y-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Admin · Console</p>
          <h2
            className="font-display text-[clamp(3rem,5.2vw,4.8rem)] leading-[1.02] tracking-[-0.02em] text-[var(--ink-primary)]"
            style={{ textWrap: 'balance' as any }}
          >
            Cognitive Elegance
            <br />
            <span className="italic font-editorial text-[var(--aurora-1)]">for Your Content.</span>
          </h2>
          <p className="font-editorial text-[1.15rem] leading-relaxed text-[var(--ink-secondary)] max-w-lg italic">
            AI-driven insights, seamless editing, and a design language that
            inspires — engineered for the modern editorial workflow.
          </p>
        </div>

        {/* 底部系统状态 */}
        <div className="relative z-10 flex items-center gap-2.5">
          <span className="relative inline-flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-[var(--signal-success)] opacity-50 animate-ping" />
            <span className="relative inline-block w-2 h-2 rounded-full bg-[var(--signal-success)]" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">System Operational · v1.0.0</span>
        </div>
      </motion.div>

      {/* 右侧:登录表单 —— surface-overlay 承载,整体是"漂浮在夜空中的发光典籍"的单页实例 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.flow, delay: 0.1 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-10 relative z-10"
      >
        <div className="w-full max-w-[440px]">
          {/* 移动端简版 wordmark */}
          <motion.div
            variants={variants.fadeUp}
            initial="initial"
            animate="animate"
            transition={transition.quick}
            className="lg:hidden flex flex-col items-center mb-8 text-center"
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: 'color-mix(in oklch, var(--aurora-1) 20%, transparent)',
                boxShadow: '0 0 32px color-mix(in oklch, var(--aurora-1) 40%, transparent), 0 1px 0 inset color-mix(in oklch, var(--aurora-1) 30%, transparent)',
              }}
            >
              <Sparkles className="w-7 h-7 text-[var(--aurora-1)]" strokeWidth={1.75} />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--ink-primary)]">AetherBlog</h1>
            <p className="font-mono text-[10px] mt-1.5 uppercase tracking-[0.22em] text-[var(--ink-muted)]">Cognitive Elegance</p>
          </motion.div>

          <motion.div
            variants={variants.scaleIn}
            initial="initial"
            animate="animate"
            transition={spring.soft}
            className="surface-overlay p-7 md:p-9 space-y-7"
          >
            {/* 标题组 */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Sign In</p>
              <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--ink-primary)] leading-tight">
                Welcome back
              </h1>
              <p className="text-sm text-[var(--ink-secondary)]">
                Enter your credentials to access the admin console.
              </p>
            </div>

            {/* Error banner —— signal-danger token,双主题自动 */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transition.quick}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
                    style={{
                      background: 'color-mix(in oklch, var(--signal-danger) 10%, transparent)',
                      border: '1px solid color-mix(in oklch, var(--signal-danger) 25%, transparent)',
                      color: 'var(--signal-danger)',
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--signal-danger)] shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <div className="space-y-2">
                <label htmlFor="username" className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] px-0.5">
                  Username
                </label>
                <div className="relative group">
                  <UserIcon
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] group-focus-within:text-[var(--aurora-1)] transition-colors"
                    strokeWidth={1.75}
                  />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="admin"
                    className="codex-input"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <label htmlFor="password" className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                    Password
                  </label>
                  {/* VULN-106: 真实 reset 流未实现，保留占位禁用按钮。实装时挂到 /auth/reset. */}
                  <button
                    type="button"
                    disabled
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] opacity-50 cursor-not-allowed"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative group">
                  <Lock
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] group-focus-within:text-[var(--aurora-1)] transition-colors"
                    strokeWidth={1.75}
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="codex-input pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" strokeWidth={1.75} /> : <Eye className="w-4 h-4" strokeWidth={1.75} />}
                  </button>
                </div>
              </div>

              {/* Submit —— aurora 实心按钮 + 轻微光晕 */}
              <motion.button
                type="submit"
                disabled={isLoading}
                whileTap={{ scale: 0.985 }}
                transition={spring.precise}
                className={cn(
                  'codex-submit-btn mt-2',
                  isLoading && 'opacity-70 cursor-not-allowed'
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                    <span>Verifying</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={2} />
                  </>
                )}
              </motion.button>
            </form>

            {/* Aurora divider */}
            <div className="aurora-divider" />

            {/* Secure Access section mark */}
            <div className="flex items-center justify-center gap-3">
              <div className="h-px flex-1 bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">§ Secure Access</span>
              <div className="h-px flex-1 bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
            </div>

            <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              By continuing you agree to the{' '}
              <a href="#" className="text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] transition-colors underline-offset-2 underline decoration-[var(--aurora-1)]/30">Terms</a>
              {' · '}
              <a href="#" className="text-[var(--ink-secondary)] hover:text-[var(--aurora-1)] transition-colors underline-offset-2 underline decoration-[var(--aurora-1)]/30">Privacy</a>
            </p>
          </motion.div>

          {/* 移动端系统状态 */}
          <div className="lg:hidden flex justify-center items-center gap-2 pt-8 opacity-60">
            <div className="w-1.5 h-1.5 bg-[var(--signal-success)] rounded-full animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">System Operational · v1.0.0</span>
          </div>
        </div>
      </motion.div>

      {/* 局部样式：codex-input / codex-submit-btn —— 抽出是为了让 hover/focus/填充状态的
          token 组合集中在一处,避免 inline 变量字符串污染 JSX 可读性. */}
      <style>{`
        @keyframes breath {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.75; transform: scale(1.05); }
        }
        .codex-input {
          width: 100%;
          padding: 0.85rem 1rem 0.85rem 2.75rem;
          font-size: 15px;
          color: var(--ink-primary);
          background: color-mix(in oklch, var(--bg-leaf) 60%, transparent);
          border: 1px solid color-mix(in oklch, var(--ink-primary) 10%, transparent);
          border-radius: 0.75rem;
          transition: border-color var(--dur-quick) var(--ease-out),
                      box-shadow var(--dur-quick) var(--ease-out),
                      background var(--dur-quick) var(--ease-out);
          outline: none;
        }
        .codex-input::placeholder {
          color: var(--ink-muted);
          font-family: var(--font-sans);
        }
        .codex-input:hover {
          background: color-mix(in oklch, var(--bg-leaf) 72%, transparent);
          border-color: color-mix(in oklch, var(--ink-primary) 16%, transparent);
        }
        .codex-input:focus {
          border-color: color-mix(in oklch, var(--aurora-1) 55%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--aurora-1) 18%, transparent);
          background: color-mix(in oklch, var(--bg-leaf) 80%, transparent);
        }
        :root.light .codex-input {
          background: color-mix(in oklch, #ffffff 80%, transparent);
          border-color: color-mix(in oklch, var(--ink-primary) 14%, transparent);
        }
        :root.light .codex-input:hover {
          background: #ffffff;
        }
        :root.light .codex-input:focus {
          background: #ffffff;
          border-color: color-mix(in oklch, var(--aurora-1) 65%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--aurora-1) 22%, transparent);
        }

        .codex-submit-btn {
          display: inline-flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
          padding: 0.95rem 1.5rem;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--bg-void);
          background: linear-gradient(135deg, var(--aurora-1) 0%, var(--aurora-2) 100%);
          border: 1px solid color-mix(in oklch, var(--aurora-1) 50%, transparent);
          border-radius: 0.75rem;
          box-shadow:
            0 1px 0 inset color-mix(in oklch, white 30%, transparent),
            0 8px 24px -8px color-mix(in oklch, var(--aurora-1) 50%, transparent);
          transition: transform var(--dur-quick) var(--ease-out),
                      box-shadow var(--dur-quick) var(--ease-out),
                      filter var(--dur-quick) var(--ease-out);
          cursor: pointer;
        }
        .codex-submit-btn:hover:not(:disabled) {
          filter: brightness(1.08);
          box-shadow:
            0 1px 0 inset color-mix(in oklch, white 40%, transparent),
            0 12px 36px -8px color-mix(in oklch, var(--aurora-1) 65%, transparent);
        }
        .codex-submit-btn:disabled {
          cursor: not-allowed;
        }
        /* 亮模式按钮：保持 aurora 渐变但改写文字颜色（白底 aurora 文字不够通透 → 深底 + 白字更稳） */
        :root.light .codex-submit-btn {
          color: #FAFAFA;
        }
      `}</style>
    </div>
  );
}

export default LoginPage;
