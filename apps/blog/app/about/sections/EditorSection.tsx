'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
}

const codeLines = [
  '# 部署指南',
  '',
  '## 前置条件',
  '',
  '确保安装以下依赖:',
  '',
  '```bash',
  'node >= 20.0.0',
  'pnpm >= 9.0.0',
  'go >= 1.24.1',
  '```',
  '',
  '## 快速开始',
  '',
  '运行 `./start.sh` 即可启动',
];

const previewLines = [
  { type: 'h1', text: '部署指南' },
  { type: 'h2', text: '前置条件' },
  { type: 'p', text: '确保安装以下依赖:' },
  { type: 'code', text: 'node >= 20.0.0' },
  { type: 'code', text: 'pnpm >= 9.0.0' },
  { type: 'code', text: 'go >= 1.24.1' },
  { type: 'h2', text: '快速开始' },
  { type: 'p', text: '运行 ./start.sh 即可启动' },
];

export default function EditorSection({ isVisible }: Props) {
  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-4"
      >
        <p className="eyebrow">EDITOR</p>
        <h2 className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          创作，不设限
        </h2>
        <p className="text-lede text-[var(--ink-secondary)] max-w-2xl mx-auto">
          CodeMirror 6 + LaTeX + Mermaid + 实时分屏预览
        </p>
      </motion.div>

      {/* Chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isVisible ? { opacity: 1 } : {}}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="flex flex-wrap justify-center gap-3"
      >
        {['CodeMirror 6', 'LaTeX', 'Mermaid', '40+ 语言'].map((chip) => (
          <span key={chip} className="cmd-chip">{chip}</span>
        ))}
      </motion.div>

      {/* Split editor mockup */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="surface-raised rounded-2xl border border-[var(--ink-subtle)]/20 overflow-hidden shadow-2xl"
      >
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--ink-subtle)]/10 bg-[var(--bg-leaf)]">
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="w-3 h-3 rounded-full bg-[var(--signal-danger)]/60" />
            <div className="w-3 h-3 rounded-full bg-[var(--signal-warn)]/60" />
            <div className="w-3 h-3 rounded-full bg-[var(--signal-success)]/60" />
          </div>
          <span className="text-caption text-[var(--ink-muted)] font-mono ml-2">deploy-guide.md</span>
          <div className="flex-1" />
          <span className="text-micro text-[var(--ink-muted)] font-mono uppercase tracking-wider">Split</span>
        </div>

        {/* Split panes */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-[var(--ink-subtle)]/10 min-h-[300px]">
          {/* Left: Source code */}
          <div className="p-4 font-mono text-caption leading-relaxed text-[var(--ink-secondary)] overflow-hidden">
            <motion.div
              initial="initial"
              animate={isVisible ? 'animate' : 'initial'}
              variants={{ animate: { transition: { staggerChildren: 0.03, delayChildren: 0.5 } } }}
            >
              {codeLines.map((line, i) => (
                <motion.div
                  key={i}
                  variants={{
                    initial: { opacity: 0 },
                    animate: { opacity: 1, transition: { duration: 0.3 } },
                  }}
                  className="min-h-[1.5em]"
                >
                  {line.startsWith('#') ? (
                    <span className="text-[var(--aurora-1)] font-semibold">{line}</span>
                  ) : line.startsWith('```') ? (
                    <span className="text-[var(--ink-muted)]">{line}</span>
                  ) : (
                    <span>{line}</span>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right: Preview */}
          <div className="p-4 space-y-2 overflow-hidden bg-[var(--bg-leaf)]">
            <motion.div
              initial="initial"
              animate={isVisible ? 'animate' : 'initial'}
              variants={{ animate: { transition: { staggerChildren: 0.04, delayChildren: 0.7 } } }}
            >
              {previewLines.map((line, i) => (
                <motion.div
                  key={i}
                  variants={{
                    initial: { opacity: 0, x: 8 },
                    animate: { opacity: 1, x: 0, transition: { duration: 0.4 } },
                  }}
                >
                  {line.type === 'h1' && (
                    <h3 className="text-h3 font-display font-bold text-[var(--ink-primary)] mb-2">{line.text}</h3>
                  )}
                  {line.type === 'h2' && (
                    <h4 className="text-h4 font-display font-semibold text-[var(--ink-primary)] mt-3 mb-1">{line.text}</h4>
                  )}
                  {line.type === 'p' && (
                    <p className="text-body text-[var(--ink-secondary)]">{line.text}</p>
                  )}
                  {line.type === 'code' && (
                    <code className="block font-mono text-caption text-[var(--aurora-1)] bg-[var(--bg-raised)] rounded px-2 py-0.5 my-0.5">
                      {line.text}
                    </code>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
