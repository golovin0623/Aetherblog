import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, User as UserIcon, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { spring, transition, variants, AetherMark } from '@aetherblog/ui';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

// NOTE: 本页设计语言锚定 `apps/blog/app/design/` + `apps/blog/app/about/` 里建立的
// Aether Codex 规范 —— surface-overlay / --ink-* / --aurora-* / Fraunces display.
// 双主题由 tokens 自动适配（:root.light 在 packages/ui/src/styles/tokens.css
// 反转 ink / bg / signal 色），不在本文件里手写 dark: variant.

// AetherMark —— 品牌图形,来自 @aetherblog/ui 共享组件,双主题跟随 --aurora-* tokens 自动切换.

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
    <div className="auth-codex-page relative w-full min-h-screen flex bg-[var(--bg-void)] text-[var(--ink-primary)] font-sans overflow-hidden selection:bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]">
      {/* Ambient 背景:
          ★ 亮主题:干脆不要 aurora 软色光晕 —— admin 的 --color-primary 是近黑,
            无论怎么 override specificity,渲染到暖米白底上都会是一块"灰污渍"。
            改用:极淡网格 + 底部横向 aurora 渐变线条(参考 /design 分隔)。干净克制。
          ★ 暗主题:保留原三层 aurora blob,"漂浮在夜空的发光典籍"的签名语言。
          用 .codex-ambient-* 类在下方 <style> 按主题分支控制,不再在 style 里硬写 bg。 */}
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div className="codex-ambient-blob codex-ambient-blob-1" />
        <div className="codex-ambient-blob codex-ambient-blob-2" />
        <div className="codex-ambient-blob codex-ambient-blob-3" />
        <div className="codex-ambient-grid" />
        <div className="codex-ambient-aurora-line" />
      </div>

      {/* 左侧:品牌/宣言区(桌面端)
          去掉 border-r + overflow-hidden:之前这两条一起制造了视觉上的"中缝"——
          border 画出硬竖线,overflow 又把 aurora 辉光裁在 50% 外侧,导致中间垂直条
          变成一个没有 aurora wash 的"灰色死角",红框问题就是这个. */}
      <motion.div
        variants={variants.fadeUp}
        initial="initial"
        animate="animate"
        transition={transition.flow}
        className="hidden lg:flex w-1/2 relative flex-col justify-between p-12"
      >
        {/* Wordmark —— AetherMark + Fraunces 字标 */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3.5">
            <span className="aether-mark-wrap" aria-hidden="true">
              <AetherMark size={32} />
            </span>
            <span
              className="font-display text-[1.35rem] tracking-[-0.01em] text-[var(--ink-primary)]"
              style={{ fontWeight: 500, fontVariationSettings: '"opsz" 16, "SOFT" 50, "WONK" 0' }}
            >
              AetherBlog
            </span>
          </div>
        </div>

        {/* 宣言 —— Fraunces display + Instrument Serif 副标
            font-size 收紧到 clamp(2.6rem, 4.4vw, 4rem) 避免在 1280-1440 宽度下挤 4 行。
            aurora-text 是 typography.css 预设的渐变文字工具类,用 aurora-1→3 描绘斜体副标。 */}
        <div className="relative z-10 max-w-xl space-y-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            Admin · Console
          </p>
          <h2
            className="font-display leading-[1.04] tracking-[-0.018em] text-[var(--ink-primary)]"
            style={{
              fontSize: 'clamp(2.6rem, 4.4vw, 4rem)',
              textWrap: 'balance' as any,
              fontWeight: 500,
            }}
          >
            Cognitive Elegance
            <br />
            <em className="not-italic font-editorial font-normal" style={{
              fontStyle: 'italic',
              background: 'linear-gradient(135deg, var(--aurora-1) 0%, var(--aurora-2) 60%, var(--aurora-3) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}>
              for Your Content.
            </em>
          </h2>
          <p
            className="font-editorial leading-relaxed text-[var(--ink-secondary)] max-w-lg"
            style={{ fontSize: '1.1rem', fontStyle: 'italic' }}
          >
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
            <span className="aether-mark-wrap mb-4" aria-hidden="true">
              <AetherMark size={44} />
            </span>
            <h1 className="font-display text-2xl tracking-[-0.01em] text-[var(--ink-primary)]" style={{ fontWeight: 500 }}>AetherBlog</h1>
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

      {/* 局部样式集
          ★ Aurora 令牌 scoped override:admin 的 --color-primary 是 #18181b (近黑),
          tokens.css 亮主题走 OKLCH 从 primary 派生 aurora,结果 --aurora-1..4 全部
          退化为黑色系。本页面在 .auth-codex-page scope 下显式给出"真正的极光色",
          让 Sparkles glow、SIGN IN 渐变、hero 斜体渐变文字在亮/暗两个主题都可见。
          ★ Autofill fix:Chrome 的 :-webkit-autofill 会用自己的蓝紫底色覆盖输入框,
          必须用大号 inset box-shadow hack 伪装成 codex-input 的背景。
          ★ codex-brand-mark:品牌图标盒,aurora-1 纸片玻璃 + 外圈柔光晕,双主题显著. */}
      <style>{`
        /* Aurora 令牌策略:
           ★ 亮主题:不 override,让 tokens.css 的 :root.light OKLCH 派生从
             --color-primary (#18181b) 生成"近黑 + 微小色相偏移"的单色序列,
             与博客头页、admin Dashboard 的单色冷淡审美一致 (/design §2 规范)。
           ★ 暗主题:tokens.css :root 默认已提供 #818CF8/A78BFA/FBBF24/FCA5A5
             (indigo→violet→amber→rose) 的真极光色,也不需要 override。
           —— 所以之前的 aurora 显式覆盖已删除,完全走 token 派生链。 */

        @keyframes codex-breath {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.06); }
        }

        /* === Ambient 背景 ===
           亮主题:隐藏 aurora blob,避免彩色渐变在白底上变成"污渍";改用极淡网格 +
                   一条水平 aurora 分隔线(在底部三分之一处),参考 /design 章节分隔.
           暗主题:三层 aurora blob 正常 breathe,产出"发光典籍漂浮夜空"签名语言. */
        .codex-ambient-blob {
          position: absolute;
          border-radius: 9999px;
          filter: blur(140px);
          pointer-events: none;
        }
        :root.light .codex-ambient-blob { display: none; }
        .codex-ambient-blob-1 {
          top: -30%; left: -20%;
          width: 85%; height: 85%;
          background: radial-gradient(circle, color-mix(in oklch, var(--aurora-1) 40%, transparent) 0%, transparent 65%);
          animation: codex-breath 12s var(--ease-in-out, ease-in-out) infinite;
        }
        .codex-ambient-blob-2 {
          bottom: -25%; right: -15%;
          width: 70%; height: 70%;
          background: radial-gradient(circle, color-mix(in oklch, var(--aurora-2) 35%, transparent) 0%, transparent 65%);
          animation: codex-breath 14s 2s var(--ease-in-out, ease-in-out) infinite;
        }
        .codex-ambient-blob-3 {
          top: 40%; left: 30%;
          width: 45%; height: 45%;
          opacity: 0.5;
          background: radial-gradient(circle, color-mix(in oklch, var(--aurora-3) 30%, transparent) 0%, transparent 65%);
          animation: codex-breath 16s 4s var(--ease-in-out, ease-in-out) infinite;
        }
        .codex-ambient-grid {
          position: absolute;
          inset: 0;
          opacity: 0.06;
          -webkit-mask-image: radial-gradient(ellipse at center, black 35%, transparent 90%);
          mask-image: radial-gradient(ellipse at center, black 35%, transparent 90%);
          background-image:
            linear-gradient(var(--ink-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--ink-primary) 1px, transparent 1px);
          background-size: 56px 56px;
          pointer-events: none;
        }
        :root.light .codex-ambient-grid { opacity: 0.035; }

        .codex-ambient-aurora-line {
          display: none;  /* only light mode */
          position: absolute;
          bottom: 22%;
          left: 0;
          right: 0;
          height: 1px;
          pointer-events: none;
          background: linear-gradient(90deg,
            transparent 0%,
            color-mix(in oklch, var(--aurora-1) 28%, transparent) 25%,
            color-mix(in oklch, var(--aurora-2) 32%, transparent) 50%,
            color-mix(in oklch, var(--aurora-3) 24%, transparent) 75%,
            transparent 100%);
          filter: blur(0.5px);
        }
        :root.light .codex-ambient-aurora-line { display: block; }

        /* AetherMark:自定义 logo mark 的外层光晕(相对简单,避免每次闪动) */
        .aether-mark-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .aether-mark-wrap::before {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 9999px;
          background: radial-gradient(circle, color-mix(in oklch, var(--aurora-1) 25%, transparent) 0%, transparent 70%);
          filter: blur(10px);
          z-index: -1;
          opacity: 0.7;
        }
        :root.light .aether-mark-wrap::before { opacity: 0.5; }

        /* Brand mark:Sparkles 图标盒,带 aurora-1 光晕 */
        .codex-brand-mark {
          background: linear-gradient(135deg,
            color-mix(in oklch, var(--aurora-1) 22%, transparent) 0%,
            color-mix(in oklch, var(--aurora-2) 14%, transparent) 100%);
          border: 1px solid color-mix(in oklch, var(--aurora-1) 35%, transparent);
          box-shadow:
            0 0 0 1px inset color-mix(in oklch, var(--aurora-1) 20%, transparent),
            0 0 24px color-mix(in oklch, var(--aurora-1) 35%, transparent),
            0 8px 20px -6px color-mix(in oklch, var(--aurora-1) 40%, transparent);
          backdrop-filter: blur(8px) saturate(140%);
          -webkit-backdrop-filter: blur(8px) saturate(140%);
        }
        :root.light .codex-brand-mark {
          background: linear-gradient(135deg,
            color-mix(in oklch, var(--aurora-1) 16%, white) 0%,
            color-mix(in oklch, var(--aurora-2) 8%, white) 100%);
          border-color: color-mix(in oklch, var(--aurora-1) 30%, transparent);
          box-shadow:
            0 0 0 1px inset color-mix(in oklch, var(--aurora-1) 18%, transparent),
            0 0 32px color-mix(in oklch, var(--aurora-1) 24%, transparent),
            0 6px 18px -6px color-mix(in oklch, var(--aurora-1) 30%, transparent);
        }

        /* Input:codex token 驱动,双主题自适应 */
        .codex-input {
          width: 100%;
          padding: 0.9rem 1rem 0.9rem 2.75rem;
          font-size: 15px;
          font-family: var(--font-sans);
          color: var(--ink-primary);
          background: color-mix(in oklch, var(--bg-leaf) 55%, transparent);
          border: 1px solid color-mix(in oklch, var(--ink-primary) 10%, transparent);
          border-radius: 0.75rem;
          transition: border-color var(--dur-quick) var(--ease-out),
                      box-shadow var(--dur-quick) var(--ease-out),
                      background var(--dur-quick) var(--ease-out);
          outline: none;
        }
        .codex-input::placeholder {
          color: color-mix(in oklch, var(--ink-muted) 70%, transparent);
          font-family: var(--font-sans);
        }
        .codex-input:hover {
          background: color-mix(in oklch, var(--bg-leaf) 72%, transparent);
          border-color: color-mix(in oklch, var(--ink-primary) 16%, transparent);
        }
        .codex-input:focus {
          border-color: color-mix(in oklch, var(--aurora-1) 55%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--aurora-1) 18%, transparent);
          background: color-mix(in oklch, var(--bg-leaf) 82%, transparent);
        }
        :root.light .codex-input {
          background: color-mix(in oklch, white 82%, transparent);
          border-color: color-mix(in oklch, var(--ink-primary) 14%, transparent);
        }
        :root.light .codex-input:hover { background: white; }
        :root.light .codex-input:focus {
          background: white;
          border-color: color-mix(in oklch, var(--aurora-1) 65%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--aurora-1) 22%, transparent);
        }

        /* Chrome autofill hijack:大号 inset box-shadow 盖掉浏览器默认蓝紫填充 */
        .auth-codex-page input:-webkit-autofill,
        .auth-codex-page input:-webkit-autofill:hover,
        .auth-codex-page input:-webkit-autofill:focus,
        .auth-codex-page input:-webkit-autofill:active {
          -webkit-text-fill-color: var(--ink-primary);
          -webkit-box-shadow: 0 0 0 1000px color-mix(in oklch, var(--bg-leaf) 55%, transparent) inset !important;
          box-shadow: 0 0 0 1000px color-mix(in oklch, var(--bg-leaf) 55%, transparent) inset !important;
          caret-color: var(--aurora-1);
          transition: background-color 5000s ease-in-out 0s;
        }
        :root.light .auth-codex-page input:-webkit-autofill,
        :root.light .auth-codex-page input:-webkit-autofill:hover,
        :root.light .auth-codex-page input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px color-mix(in oklch, white 90%, transparent) inset !important;
          box-shadow: 0 0 0 1000px color-mix(in oklch, white 90%, transparent) inset !important;
        }

        /* Submit button:aurora-1 → aurora-2 实色渐变 */
        .codex-submit-btn {
          display: inline-flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
          padding: 1rem 1.5rem;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: white;
          background: linear-gradient(135deg, var(--aurora-1) 0%, var(--aurora-2) 100%);
          border: 1px solid color-mix(in oklch, var(--aurora-1) 50%, transparent);
          border-radius: 0.75rem;
          box-shadow:
            0 1px 0 inset color-mix(in oklch, white 40%, transparent),
            0 8px 24px -8px color-mix(in oklch, var(--aurora-1) 55%, transparent);
          transition: transform var(--dur-quick) var(--ease-out),
                      box-shadow var(--dur-quick) var(--ease-out),
                      filter var(--dur-quick) var(--ease-out);
          cursor: pointer;
        }
        .codex-submit-btn:hover:not(:disabled) {
          filter: brightness(1.06);
          box-shadow:
            0 1px 0 inset color-mix(in oklch, white 50%, transparent),
            0 14px 36px -8px color-mix(in oklch, var(--aurora-1) 65%, transparent);
        }
        .codex-submit-btn:disabled { cursor: not-allowed; }
      `}</style>
    </div>
  );
}

export default LoginPage;
