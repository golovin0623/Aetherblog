'use client';

import { motion } from 'framer-motion';

interface Props {
  isVisible: boolean;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const principles = [
  {
    n: '01',
    title: '语境优先',
    body:
      '它读得懂你站点的每一篇文章、每一个标签、每一段评论。回答从这里出发，而不是从一个全互联网的平均答案出发。',
  },
  {
    n: '02',
    title: '对话即行动',
    body:
      '不只是问答框。@文章 让它进上下文，/命令 让它替你写摘要、生成大纲、改标题。对话即操作。',
  },
  {
    n: '03',
    title: '推理可见',
    body:
      'SSE 流式 token 一字一字地显现，think 段折叠展开，引用清单在右栏可点。中间过程公开，结论才值得信。',
  },
];

export default function ManifestoSection({ isVisible }: Props) {
  return (
    <div className="space-y-12 max-w-5xl mx-auto">
      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
        className="text-center space-y-4"
      >
        <motion.p variants={fadeUp} className="eyebrow">MANIFESTO · 三条原则</motion.p>
        <motion.h2 variants={fadeUp} className="text-h1 md:text-display font-display font-bold text-[var(--ink-primary)]">
          为什么 Agent 不是又一个聊天框
        </motion.h2>
        <motion.p variants={fadeUp} className="font-editorial italic text-[var(--ink-secondary)] text-lg md:text-xl max-w-2xl mx-auto">
          它的存在前提，是这座站点已经积攒下来的全部文字。
        </motion.p>
      </motion.div>

      <motion.div
        initial="initial"
        animate={isVisible ? 'animate' : 'initial'}
        variants={{ animate: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } } }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {principles.map((p) => (
          <motion.article
            key={p.n}
            variants={fadeUp}
            className="surface-leaf rounded-2xl border border-[var(--ink-subtle)]/15 p-6 md:p-7 space-y-3"
            data-interactive
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.3em] text-[var(--aurora-1)]/85">
                § {p.n}
              </span>
            </div>
            <h3 className="text-h4 font-display font-semibold text-[var(--ink-primary)]">{p.title}</h3>
            <p className="text-body text-[var(--ink-muted)] leading-relaxed">{p.body}</p>
          </motion.article>
        ))}
      </motion.div>
    </div>
  );
}
