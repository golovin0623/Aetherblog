import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Lock, ShieldCheck, ArrowRight, AlertCircle, Sparkles, KeyRound, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { spring, transition, variants } from '@aetherblog/ui';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/authService';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

// 设计语言锚定 Aether Codex (/design, /about) —— 与 LoginPage 配套。
// 首次登录（isFirstLogin）会叠加一层 signal-warn 语境:aurora-3 橙向渲染,
// 让用户意识到这是强制步骤；普通修改走默认 aurora-1 语境。
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

  const isFirstLogin = location.state?.firstLogin === true;

  const validatePasswords = () => {
    if (newPassword.length < 8) {
      setError('新密码长度至少为 8 位');
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
      const res = await authService.changePassword({
        currentPassword,
        newPassword,
      });

      if (res.code === 200) {
        setSuccess(true);
        setTimeout(() => {
          logout();
          navigate('/login', {
            state: { message: '密码修改成功，请使用新密码登录' },
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

  // 密码健康校验信号 —— 两条都满足 aurora-1 绿色,否则 signal-warn / ink-muted
  const lengthOk = newPassword.length >= 8;
  const matchOk = newPassword.length > 0 && newPassword === confirmPassword;

  return (
    <div className="relative w-full min-h-screen flex bg-[var(--bg-void)] text-[var(--ink-primary)] font-sans overflow-hidden selection:bg-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]">
      {/* Ambient —— 首登场景用 warn 极光 (aurora-3 橙),强调"强制"语境 */}
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-[-25%] left-[-15%] w-[70%] h-[70%] rounded-full blur-[140px] opacity-70"
          style={{
            background: isFirstLogin
              ? 'radial-gradient(circle, color-mix(in oklch, var(--aurora-3) 22%, transparent) 0%, transparent 70%)'
              : 'radial-gradient(circle, color-mix(in oklch, var(--aurora-1) 22%, transparent) 0%, transparent 70%)',
            animation: 'breath 12s var(--ease-in-out, ease-in-out) infinite',
          }}
        />
        <div
          className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-60"
          style={{
            background: isFirstLogin
              ? 'radial-gradient(circle, color-mix(in oklch, var(--aurora-4) 18%, transparent) 0%, transparent 70%)'
              : 'radial-gradient(circle, color-mix(in oklch, var(--aurora-2) 20%, transparent) 0%, transparent 70%)',
            animation: 'breath 14s var(--ease-in-out, ease-in-out) 2s infinite',
          }}
        />
        <div className="absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)] bg-[linear-gradient(var(--ink-primary)_1px,transparent_1px),linear-gradient(90deg,var(--ink-primary)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* 左侧:安全宣言 */}
      <motion.div
        variants={variants.fadeUp}
        initial="initial"
        animate="animate"
        transition={transition.flow}
        className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden border-r border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
      >
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: `color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 20%, transparent)`,
                boxShadow: `0 0 32px color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 40%, transparent), 0 1px 0 inset color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 30%, transparent)`,
              }}
            >
              <Sparkles
                className="w-5 h-5"
                style={{ color: `var(${isFirstLogin ? '--aurora-3' : '--aurora-1'})` }}
                strokeWidth={1.75}
              />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-[var(--ink-primary)]">AetherBlog</span>
          </div>
        </div>

        <div className="relative z-10 max-w-xl space-y-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 28%, transparent), color-mix(in oklch, var(${isFirstLogin ? '--aurora-4' : '--aurora-2'}) 16%, transparent))`,
              border: `1px solid color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 40%, transparent)`,
              boxShadow: `0 0 40px color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 35%, transparent)`,
            }}
          >
            <KeyRound className="w-8 h-8" style={{ color: `var(${isFirstLogin ? '--aurora-3' : '--aurora-1'})` }} strokeWidth={1.5} />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            {isFirstLogin ? 'First Login · Required' : 'Identity · Protection'}
          </p>
          <h2
            className="font-display text-[clamp(3rem,5.2vw,4.8rem)] leading-[1.02] tracking-[-0.02em] text-[var(--ink-primary)]"
            style={{ textWrap: 'balance' as any }}
          >
            {isFirstLogin ? 'Secure your' : 'Account security'}
            <br />
            <span className="italic font-editorial" style={{ color: `var(${isFirstLogin ? '--aurora-3' : '--aurora-1'})` }}>
              {isFirstLogin ? 'access first.' : 'is non-negotiable.'}
            </span>
          </h2>
          <p className="font-editorial text-[1.15rem] leading-relaxed text-[var(--ink-secondary)] max-w-lg italic">
            {isFirstLogin
              ? 'First login detected. Please replace the default credential with a strong password before continuing.'
              : 'A strong password is the first line of defense. Choose something long, unique, and unguessable.'}
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2.5">
          <span className="relative inline-flex w-2 h-2">
            <span
              className="absolute inset-0 rounded-full opacity-60 animate-ping"
              style={{ background: `var(${isFirstLogin ? '--signal-warn' : '--signal-success'})` }}
            />
            <span
              className="relative inline-block w-2 h-2 rounded-full"
              style={{ background: `var(${isFirstLogin ? '--signal-warn' : '--signal-success'})` }}
            />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            {isFirstLogin ? 'Security update required' : 'Secure environment'}
          </span>
        </div>
      </motion.div>

      {/* 右侧:表单 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.flow, delay: 0.1 }}
        className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-10 relative z-10"
      >
        <div className="w-full max-w-[460px]">
          {/* 移动端 wordmark */}
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
                background: `linear-gradient(135deg, color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 28%, transparent), color-mix(in oklch, var(${isFirstLogin ? '--aurora-4' : '--aurora-2'}) 16%, transparent))`,
                border: `1px solid color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 40%, transparent)`,
                boxShadow: `0 0 32px color-mix(in oklch, var(${isFirstLogin ? '--aurora-3' : '--aurora-1'}) 40%, transparent)`,
              }}
            >
              <KeyRound className="w-7 h-7" style={{ color: `var(${isFirstLogin ? '--aurora-3' : '--aurora-1'})` }} strokeWidth={1.5} />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--ink-primary)]">Security Center</h1>
            <p className="font-mono text-[10px] mt-1.5 uppercase tracking-[0.22em] text-[var(--ink-muted)]">
              {isFirstLogin ? 'First Login' : 'Change Password'}
            </p>
          </motion.div>

          <motion.div
            variants={variants.scaleIn}
            initial="initial"
            animate="animate"
            transition={spring.soft}
            className="surface-overlay p-7 md:p-9 space-y-6"
          >
            {success ? (
              <motion.div
                variants={variants.fadeUp}
                initial="initial"
                animate="animate"
                transition={spring.soft}
                className="py-8 text-center space-y-6"
              >
                <div
                  className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, color-mix(in oklch, var(--signal-success) 30%, transparent), color-mix(in oklch, var(--aurora-1) 18%, transparent))',
                    border: '1px solid color-mix(in oklch, var(--signal-success) 40%, transparent)',
                    boxShadow: '0 0 40px color-mix(in oklch, var(--signal-success) 35%, transparent)',
                  }}
                >
                  <ShieldCheck className="w-8 h-8 text-[var(--signal-success)]" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">§ Updated</p>
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-[var(--ink-primary)]">Password renewed</h2>
                  <p className="text-sm text-[var(--ink-secondary)]">Redirecting to login — please sign in with the new credential.</p>
                </div>
                <div
                  className="w-6 h-6 mx-auto rounded-full animate-spin"
                  style={{
                    border: '2px solid color-mix(in oklch, var(--signal-success) 20%, transparent)',
                    borderTopColor: 'var(--signal-success)',
                  }}
                />
              </motion.div>
            ) : (
              <>
                {/* 标题组 */}
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                    {isFirstLogin ? 'Mandatory' : 'Change Password'}
                  </p>
                  <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--ink-primary)] leading-tight">
                    {isFirstLogin ? 'Set a new password' : 'Update password'}
                  </h1>
                  <p className="text-sm text-[var(--ink-secondary)]">
                    {isFirstLogin
                      ? 'For security, please set a new password before continuing.'
                      : 'Enter your current password and choose a new one.'}
                  </p>
                </div>

                {/* First-login warning banner */}
                <AnimatePresence>
                  {isFirstLogin && (
                    <motion.div
                      variants={variants.fadeUp}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={transition.quick}
                    >
                      <div
                        className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm"
                        style={{
                          background: 'color-mix(in oklch, var(--signal-warn) 10%, transparent)',
                          border: '1px solid color-mix(in oklch, var(--signal-warn) 25%, transparent)',
                        }}
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--signal-warn)]" strokeWidth={2} />
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--signal-warn)] font-semibold">
                            Security Notice
                          </p>
                          <p className="text-[var(--ink-secondary)] mt-1 leading-relaxed">
                            First login detected — default credential must be replaced.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error banner */}
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
                  <PasswordField
                    label="Current Password"
                    icon={<Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] group-focus-within:text-[var(--aurora-1)] transition-colors" strokeWidth={1.75} />}
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    show={showCurrentPassword}
                    onToggle={() => setShowCurrentPassword(!showCurrentPassword)}
                    placeholder="Your current password"
                    autoComplete="current-password"
                  />

                  <PasswordField
                    label="New Password"
                    icon={<ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] group-focus-within:text-[var(--aurora-1)] transition-colors" strokeWidth={1.75} />}
                    value={newPassword}
                    onChange={setNewPassword}
                    show={showNewPassword}
                    onToggle={() => setShowNewPassword(!showNewPassword)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                  />

                  <PasswordField
                    label="Confirm New Password"
                    icon={<ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)] group-focus-within:text-[var(--aurora-1)] transition-colors" strokeWidth={1.75} />}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    show={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                    minLength={8}
                  />

                  {/* Password Health panel —— 两条校验信号,命中切到 signal-success */}
                  <div
                    className="px-4 py-3.5 rounded-xl"
                    style={{
                      background: 'rgb(from var(--bg-leaf) r g b / 0.5)',
                      border: '1px solid rgb(from var(--ink-primary) r g b / 0.06)',
                    }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--ink-muted)] mb-2.5">
                      § Password Health
                    </p>
                    <ul className="space-y-1.5">
                      <HealthCheck ok={lengthOk} label="Minimum length of 8 characters" />
                      <HealthCheck ok={matchOk} label="Password confirmation matches" />
                    </ul>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isLoading}
                    whileTap={{ scale: 0.985 }}
                    transition={spring.precise}
                    className={cn(
                      'codex-submit-btn mt-1',
                      isLoading && 'opacity-70 cursor-not-allowed'
                    )}
                    data-first-login={isFirstLogin ? 'true' : undefined}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                        <span>Updating</span>
                      </>
                    ) : (
                      <>
                        <span>Update Password</span>
                        <ArrowRight className="w-4 h-4" strokeWidth={2} />
                      </>
                    )}
                  </motion.button>

                  {/* Return link —— 非首登才显示,避免用户绕过 */}
                  {!isFirstLogin && (
                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] transition-colors"
                      >
                        <ArrowLeft className="w-3 h-3" strokeWidth={2} />
                        <span>Return</span>
                      </button>
                    </div>
                  )}
                </form>

                <div className="aurora-divider" />
                <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  Credentials protected in transit by HTTPS
                </p>
              </>
            )}
          </motion.div>

          <div className="lg:hidden flex justify-center items-center gap-2 pt-8 opacity-60">
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: `var(${isFirstLogin ? '--signal-warn' : '--signal-success'})` }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {isFirstLogin ? 'Security update required' : 'Secure environment'}
            </span>
          </div>
        </div>
      </motion.div>

      {/* 同 LoginPage 的 codex-input / codex-submit-btn 样式,集中放这里避免重复。
          长远看应抽成 packages/ui 的公共样式层，先就近维护。 */}
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
          background: rgb(from var(--bg-leaf) r g b / 0.6);
          border: 1px solid rgb(from var(--ink-primary) r g b / 0.1);
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
          background: rgb(from var(--bg-leaf) r g b / 0.72);
          border-color: rgb(from var(--ink-primary) r g b / 0.16);
        }
        .codex-input:focus {
          border-color: color-mix(in oklch, var(--aurora-1) 55%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklch, var(--aurora-1) 18%, transparent);
          background: rgb(from var(--bg-leaf) r g b / 0.8);
        }
        :root.light .codex-input {
          background: rgba(255, 255, 255, 0.8);
          border-color: rgb(from var(--ink-primary) r g b / 0.14);
        }
        :root.light .codex-input:hover { background: #ffffff; }
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
            0 1px 0 inset rgba(255, 255, 255, 0.3),
            0 8px 24px -8px color-mix(in oklch, var(--aurora-1) 50%, transparent);
          transition: transform var(--dur-quick) var(--ease-out),
                      box-shadow var(--dur-quick) var(--ease-out),
                      filter var(--dur-quick) var(--ease-out);
          cursor: pointer;
        }
        /* 首登语境换成 aurora-3/4 的暖橙渐变,暗示"强制安全步骤" */
        .codex-submit-btn[data-first-login="true"] {
          background: linear-gradient(135deg, var(--aurora-3) 0%, var(--aurora-4) 100%);
          border-color: color-mix(in oklch, var(--aurora-3) 55%, transparent);
          box-shadow:
            0 1px 0 inset rgba(255, 255, 255, 0.3),
            0 8px 24px -8px color-mix(in oklch, var(--aurora-3) 55%, transparent);
        }
        .codex-submit-btn:hover:not(:disabled) {
          filter: brightness(1.08);
          box-shadow:
            0 1px 0 inset rgba(255, 255, 255, 0.4),
            0 12px 36px -8px color-mix(in oklch, var(--aurora-1) 65%, transparent);
        }
        .codex-submit-btn[data-first-login="true"]:hover:not(:disabled) {
          box-shadow:
            0 1px 0 inset rgba(255, 255, 255, 0.4),
            0 12px 36px -8px color-mix(in oklch, var(--aurora-3) 70%, transparent);
        }
        .codex-submit-btn:disabled { cursor: not-allowed; }
        :root.light .codex-submit-btn { color: #FAFAFA; }
      `}</style>
    </div>
  );
}

// 三个 password 字段结构一致,抽成内部小组件避免 120 行重复 JSX
function PasswordField({
  label,
  icon,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
  minLength,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
  minLength?: number;
}) {
  return (
    <div className="space-y-2">
      <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] px-0.5 block">
        {label}
      </label>
      <div className="relative group">
        {icon}
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          className="codex-input pr-12"
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
        >
          {show ? <EyeOff className="w-4 h-4" strokeWidth={1.75} /> : <Eye className="w-4 h-4" strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

function HealthCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className="flex items-center gap-2 text-xs transition-colors"
      style={{ color: ok ? 'var(--signal-success)' : 'var(--ink-muted)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full transition-all"
        style={{
          background: ok ? 'var(--signal-success)' : 'rgb(from var(--ink-primary) r g b / 0.2)',
          boxShadow: ok ? '0 0 8px color-mix(in oklch, var(--signal-success) 50%, transparent)' : 'none',
        }}
      />
      {label}
    </li>
  );
}

export default ChangePasswordPage;
