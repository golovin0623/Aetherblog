'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

/**
 * 三种工作模式：同步问答 / 主动副手 / Agent 编排。
 *
 * 视觉做成 segmented control 的"展开版"：每个 tab 对应一个 surface-leaf 卡片，
 * 三张并排 + 每张里有一个迷你示意条。
 *
 * 重要：文案严格围绕"它是什么独立子系统"展开，不再使用"prompt 切换"或
 * "三种姿势"这类暗示模式只是语气差异的说法。Cowork / Code 标识为 Coming，
 * 引导到 docs/agent/*.md 完整设计路线。
 */
type ModeStatus = 'live' | 'coming';

const modes: {
  key: string;
  label: string;
  sub: string;
  status: ModeStatus;
  body: string;
  sample: string[];
}[] = [
  {
    key: 'chat',
    label: 'Chat',
    sub: '同步问答',
    status: 'live',
    body: '基于站点知识库的轻量问答 Agent。多轮上下文、Markdown 渲染、@ 引用文章、# 标签筛选、/ 调用命令。',
    sample: [
      'you · @这篇文章的核心论点',
      'agent · 总结为三点：…',
      'agent · 引用：3 篇相关文章',
    ],
  },
  {
    key: 'cowork',
    label: 'Cowork',
    sub: '主动副手 · Coming',
    status: 'coming',
    body: '会主动工作的异步副手：定时跑任务、调用多种工具、把成果以站内通知 / 草稿 / 图集形式推送回来。完整设计在 docs/agent/COWORK_ROADMAP.md。',
    sample: [
      'task · 每工作日 09:00 行业速览',
      'cowork · 调用 web_search × 5',
      'inbox · 已为你生成今日简报',
    ],
  },
  {
    key: 'code',
    label: 'Code',
    sub: 'Agent 编排 · Coming',
    status: 'coming',
    body: '最底层的 Agent 编排平台：注册工具、定义工作流（YAML / DAG / 自治）、节点级 trace、autonomous run 一键固化为复用模板。完整设计在 docs/agent/CODE_ROADMAP.md。',
    sample: [
      'tools · kb_search / web_fetch / my_ocr',
      'workflow · article_audit · v3',
      'run · 4 nodes · 12.4s · ✓ done',
    ],
  },
];

export default function ModesSection({ isVisible }: Props) {
  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
        className="text-center space-y-4"
      >
        <motion.p variants={fadeUp} className="eyebrow">MODES · 三个独立子系统</motion.p>
        <motion.h2 variants={fadeUp} className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          一个入口，三种 Agent 形态
        </motion.h2>
        <motion.p variants={fadeUp} className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl max-w-2xl mx-auto">
          Chat 是问答，Cowork 是副手，Code 是编排平台。它们不是 prompt 切换 —— 是三套不同的能力架构。
        </motion.p>
      </motion.div>

      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } } }}
        className="grid grid-cols-1 md:grid-cols-3 gap-5"
      >
        {modes.map((m) => {
          const isComing = m.status === 'coming';
          return (
            <motion.article
              key={m.key}
              variants={fadeUp}
              data-interactive
              className={`relative surface-leaf rounded-2xl border p-6 space-y-4 transition-colors ${
                isComing
                  ? 'border-[var(--ink-subtle)]/15 hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]'
                  : 'border-[var(--ink-subtle)]/15 hover:border-[var(--aurora-1)]/40'
              }`}
            >
              {isComing && (
                <span
                  aria-hidden="true"
                  className="absolute top-4 right-4 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-mono uppercase tracking-[0.22em] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]/85 border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]"
                >
                  Coming
                </span>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-h3 font-display font-semibold text-[var(--ink-primary)]">{m.label}</h3>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)] truncate">{m.sub}</span>
              </div>
              <p className="text-body text-[var(--ink-muted)] leading-relaxed min-h-[5.5rem]">{m.body}</p>
              <div className="bg-[var(--bg-raised)] rounded-xl border border-[var(--ink-subtle)]/15 p-3 space-y-1.5 font-mono text-[11px] text-[var(--ink-secondary)]">
                {m.sample.map((line) => (
                  <div key={line} className="truncate">
                    <span className="text-[var(--aurora-1)]/70 mr-2">›</span>
                    {line}
                  </div>
                ))}
              </div>
            </motion.article>
          );
        })}
      </motion.div>
    </div>
  );
}
