'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
}

const securityFeatures = [
  { title: 'JWT 认证', description: '双令牌机制，Access + Refresh Token 自动续期，安全无感登录。' },
  { title: 'RBAC 权限', description: '基于角色的细粒度访问控制，管理员、编辑者、访客权限分离。' },
  { title: '审计日志', description: '全链路操作追踪，关键行为实时记录，事后可溯可查。' },
];

export default function SecuritySection({ isVisible }: Props) {
  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">SECURITY</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          坚若磐石
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          从身份认证到数据存储，层层设防
        </p>
      </motion.div>

      {/* Shield + features */}
      <div className="flex flex-col items-center gap-10">
        {/* Shield icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isVisible ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="shield-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--aurora-1)" />
                <stop offset="50%" stopColor="var(--aurora-2)" />
                <stop offset="100%" stopColor="var(--aurora-4)" />
              </linearGradient>
            </defs>
            <path
              d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
              stroke="url(#shield-gradient)"
            />
            <path d="M9 12l2 2 4-4" stroke="url(#shield-gradient)" />
          </svg>
          {/* Glow behind shield */}
          <div
            className="absolute inset-0 blur-2xl opacity-30"
            style={{ background: 'radial-gradient(circle, var(--aurora-1), transparent 70%)' }}
            aria-hidden="true"
          />
        </motion.div>

        {/* Feature bars */}
        <motion.div
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          variants={{ animate: { transition: { staggerChildren: 0.06, delayChildren: 0.4 } } }}
          className="w-full max-w-lg space-y-4"
        >
          {securityFeatures.map((f) => (
            <motion.div
              key={f.title}
              variants={{
                initial: { opacity: 0, x: -16 },
                animate: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
              }}
              className="flex items-start gap-4 p-4 rounded-xl bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/10"
            >
              {/* Aurora left stripe */}
              <div
                className="w-1 self-stretch rounded-full shrink-0"
                style={{ background: 'linear-gradient(180deg, var(--aurora-1), var(--aurora-4))' }}
                aria-hidden="true"
              />
              <div>
                <h3 className="text-body font-semibold text-[var(--ink-primary)] mb-1">{f.title}</h3>
                <p className="text-caption text-[var(--ink-muted)] leading-relaxed">{f.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
