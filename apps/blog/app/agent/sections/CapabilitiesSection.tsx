'use client';

import { motion } from 'framer-motion';
import { MessageSquare, Wand2, Search, BookText, Code2, Quote } from 'lucide-react';

interface Props {
  isVisible: boolean;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const capabilities = [
  { icon: MessageSquare, label: '上下文对话', body: '基于会话内的多轮记忆，引用前文不再要复述。', tag: 'Chat' },
  { icon: Search, label: '知识库检索', body: '语义检索 + 关键词匹配，在你的文章中找答案。', tag: 'RAG' },
  { icon: Wand2, label: '内容润色', body: '让它把段落改得更短、更克制、更像你的语气。', tag: 'Polish' },
  { icon: BookText, label: '大纲生成', body: '丢一段想法进去，输出可发表的文章骨架。', tag: 'Outline' },
  { icon: Code2, label: '代码协助', body: '附上文件或段落，让它阅读、解释、给出最小修改建议。', tag: 'Code' },
  { icon: Quote, label: '引文清单', body: '回答附引用，每一句都能溯源到文章原文。', tag: 'Cite' },
];

export default function CapabilitiesSection({ isVisible }: Props) {
  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.08 } } }}
        className="text-center space-y-4"
      >
        <motion.p variants={fadeUp} className="eyebrow">CAPABILITIES · 六大能力</motion.p>
        <motion.h2 variants={fadeUp} className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          它能替你做的事
        </motion.h2>
        <motion.p variants={fadeUp} className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl max-w-2xl mx-auto">
          每一项能力都接到同一套 AI 路由 —— 模型可换，提示词可调，使用记账可查。
        </motion.p>
      </motion.div>

      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.06, delayChildren: 0.18 } } }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {capabilities.map((c) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.label}
              variants={fadeUp}
              data-interactive
              className="group surface-leaf rounded-2xl border border-[var(--ink-subtle)]/15 p-5 md:p-6 transition-colors hover:border-[var(--aurora-1)]/40"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--bg-raised)] text-[var(--aurora-1)] border border-[var(--ink-subtle)]/20">
                  <Icon className="w-5 h-5" strokeWidth={1.6} />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">{c.tag}</span>
              </div>
              <h3 className="text-h5 font-display font-semibold text-[var(--ink-primary)] mb-1.5">{c.label}</h3>
              <p className="text-body text-[var(--ink-muted)] leading-relaxed">{c.body}</p>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
