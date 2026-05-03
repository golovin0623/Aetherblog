/**
 * JwtRotationCard —— JWT 签名密钥轮换的管理面板。
 *
 * 解决审计 §1.3 / §4.1.3:
 *   - rotate-jwt-secret 端点早就存在 (VULN-152 跟进), 但 admin 零 UI,
 *     curl-only。应急时刻 (LFI / commit 误推 / token 怀疑泄露) 找运维 SSH,
 *     错过黄金时间。
 *
 * UI 提供:
 *   - 当前 current 密钥的晋升时间 (绝对 + 相对)
 *   - 上一密钥宽限期到期时间 (若有 previous)
 *   - 自动轮换间隔 / 宽限期等配置展示
 *   - "立即轮换" 按钮 (带二次确认 + 轮换成功后自动刷新元数据)
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, KeyRound, Clock, AlertTriangle, RotateCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '@aetherblog/ui';
import { formatDate, formatRelativeTime } from '@aetherblog/utils';
import { authService, type JwtSecretMeta } from '@/services/authService';
import { logger } from '@/lib/logger';

interface MetaRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

function MetaRow({ icon: Icon, label, value, hint }: MetaRowProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--text-muted)]" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-[var(--text-muted)]">
          {label}
        </div>
        <div className="text-sm text-[var(--text-primary)] mt-0.5">{value}</div>
        {hint && <div className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

export function JwtRotationCard({ className }: { className?: string }) {
  const [meta, setMeta] = useState<JwtSecretMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authService.getJwtSecretMeta();
      if (resp.code === 200 && resp.data) {
        setMeta(resp.data);
      } else {
        toast.error(resp.message || '加载 JWT 元数据失败');
      }
    } catch (err) {
      logger.error('JwtRotationCard refresh error:', err);
      toast.error('加载 JWT 元数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRotate = useCallback(async () => {
    setConfirmOpen(false);
    setRotating(true);
    try {
      const resp = await authService.rotateJwtSecret();
      if (resp.code === 200 && resp.data) {
        toast.success(
          `已成功轮换签名密钥 (旧密钥 ${resp.data.previousGraceHours}h 内仍可验签)`,
        );
        await refresh();
      } else {
        toast.error(resp.message || '轮换失败');
      }
    } catch (err) {
      logger.error('JwtRotationCard rotate error:', err);
      toast.error('轮换失败');
    } finally {
      setRotating(false);
    }
  }, [refresh]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`surface-leaf p-6 ${className || ''}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]">
            <ShieldCheck className="w-5 h-5 text-[var(--aurora-1)]" />
          </div>
          <div>
            <h3 className="text-base font-display font-semibold text-[var(--text-primary)]">
              JWT 签名密钥
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              定时自动轮换 + 应急手动触发 · 永不在 UI 中暴露 secret 内容
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={loading || rotating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
            bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)]
            hover:bg-[color-mix(in_oklch,var(--signal-warn)_24%,transparent)]
            text-[var(--signal-warn)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-warn)]/40"
        >
          {rotating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
          {rotating ? '轮换中…' : '立即轮换'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 py-2">
              <div className="w-4 h-4 mt-0.5 rounded bg-[var(--bg-secondary)] animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2 w-24 rounded bg-[var(--bg-secondary)] animate-pulse" />
                <div className="h-3 w-48 rounded bg-[var(--bg-secondary)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : meta ? (
        <div className="divide-y divide-[var(--border-subtle)]">
          <MetaRow
            icon={KeyRound}
            label="当前密钥晋升于"
            value={formatDate(meta.currentPromotedAt, 'yyyy-MM-dd HH:mm:ss')}
            hint={formatRelativeTime(meta.currentPromotedAt)}
          />
          {meta.previousRetiresAt && (
            <MetaRow
              icon={AlertTriangle}
              label="上一密钥宽限期至"
              value={formatDate(meta.previousRetiresAt, 'yyyy-MM-dd HH:mm:ss')}
              hint={
                new Date(meta.previousRetiresAt) > new Date()
                  ? `${formatRelativeTime(meta.previousRetiresAt)} 失效 · 期间旧 token 仍可验签`
                  : '已过期 · 旧 token 已无法验签'
              }
            />
          )}
          <MetaRow
            icon={Clock}
            label="自动轮换间隔"
            value={meta.rotationIntervalDays > 0 ? `${meta.rotationIntervalDays} 天` : '已禁用'}
            hint={
              meta.rotationIntervalDays > 0
                ? `旧密钥宽限期 ${meta.previousGraceHours} 小时`
                : `自动轮换未开启 · 手动轮换仍使用 ${meta.previousGraceHours} 小时宽限期`
            }
          />
        </div>
      ) : (
        <div className="text-sm text-[var(--text-muted)] py-4">
          未能获取 JWT 元数据,请检查后端日志。
        </div>
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        title="确认轮换 JWT 签名密钥?"
        message={
          `这将立即生成一把新的签名密钥, 当前密钥被降级为 previous。\n\n` +
          `· 已发放的 token 在 ${meta?.previousGraceHours ?? 48} 小时宽限期内仍可验签, 用户不会被强制下线\n` +
          `· 操作记录到 activity_events (security.jwt_rotate)\n\n` +
          `仅在怀疑密钥泄露 / 历史 commit 含 token 等紧急情况下使用。`
        }
        confirmText="立即轮换"
        cancelText="取消"
        variant="warning"
        onConfirm={handleRotate}
        onCancel={() => setConfirmOpen(false)}
      />
    </motion.div>
  );
}

export default JwtRotationCard;
