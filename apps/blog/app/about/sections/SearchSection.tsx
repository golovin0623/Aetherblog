'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
}

export default function SearchSection({ isVisible }: Props) {
  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">SEMANTIC SEARCH</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          语义即理解
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          用自然语言提问，而不只是关键词匹配
        </p>
      </motion.div>

      {/* Search panel mockup */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={isVisible ? { opacity: 1, scale: 1 } : {}}
        transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-2xl mx-auto"
      >
        <div className="surface-raised rounded-2xl border border-[var(--ink-subtle)]/20 overflow-hidden shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--ink-subtle)]/10">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <div className="flex items-center gap-2 flex-1">
              <span className="cmd-chip">?</span>
              <span className="text-body text-[var(--ink-secondary)]">
                如何部署到生产环境
              </span>
              <span className="ink-cursor" aria-hidden="true" />
            </div>
            <kbd className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-leaf)] border border-[var(--ink-subtle)]/20 text-micro text-[var(--ink-muted)] font-mono">
              ESC
            </kbd>
          </div>

          {/* Prefix routing hints */}
          <div className="px-5 py-3 border-b border-[var(--ink-subtle)]/10 flex gap-4">
            <span className="text-caption text-[var(--ink-muted)]">
              <span className="cmd-chip mr-1.5">&gt;</span>命令
            </span>
            <span className="text-caption text-[var(--ink-muted)]">
              <span className="cmd-chip mr-1.5">/</span>标签
            </span>
            <span className="text-caption text-[var(--aurora-1)]">
              <span className="cmd-chip mr-1.5">?</span>AI 问答
            </span>
          </div>

          {/* Result skeleton lines */}
          <div className="p-5 space-y-4">
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={isVisible ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                className="flex items-center gap-3"
              >
                <div
                  className="w-1 h-8 rounded-full"
                  style={{
                    background: `linear-gradient(180deg, var(--aurora-${Math.min(i, 4)}), transparent)`,
                  }}
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-1.5">
                  <div
                    className="h-3.5 rounded bg-[var(--ink-subtle)]/20"
                    style={{ width: `${85 - i * 12}%` }}
                  />
                  <div
                    className="h-2.5 rounded bg-[var(--ink-subtle)]/10"
                    style={{ width: `${65 - i * 8}%` }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
