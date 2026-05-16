import { ShieldCheck } from 'lucide-react';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { JwtRotationCard } from '@/components/security/JwtRotationCard';

export default function SystemSecurityPage() {
  return (
    <div className="admin-grid-page security-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="系统安全"
          icon={ShieldCheck}
          currentLabel="密钥轮换"
          description="集中管理认证密钥、轮换策略与应急安全操作。"
          activeSummary="当前工作区：JWT 签名密钥轮换与凭证安全响应。"
        />

        <section className="w-full" aria-label="JWT 签名密钥轮换">
          <JwtRotationCard className="access-surface rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" />
        </section>
      </div>
    </div>
  );
}
