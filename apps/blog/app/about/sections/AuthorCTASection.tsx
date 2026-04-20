'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import AnimatedCounter from '../components/AnimatedCounter';
import { sanitizeImageUrl } from '@/app/lib/sanitizeUrl';
import type { SiteSettings } from '@/app/lib/services';

interface Props {
  isVisible: boolean;
  settings: SiteSettings;
  stats: any;
}

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

export default function AuthorCTASection({ isVisible, settings, stats }: Props) {
  const authorName = settings.authorName || settings.author_name || 'Admin';
  const authorBio = settings.authorBio || settings.author_bio || '';

  // 后端 /site/info 已对本地上传的头像 prefix 过 /api（site_handler.prefixLocal），
  // 所以这里只用 sanitizeImageUrl 通过协议白名单，不再叠加 /api ——
  // 否则会出现 /api/api/uploads/... 的双前缀导致 Next.js Image 加载失败。
  const authorAvatar = sanitizeImageUrl(
    settings.authorAvatar || settings.author_avatar || '',
    ''
  );
  const needsUnoptimized =
    authorAvatar.startsWith('/api/uploads') || authorAvatar.startsWith('/uploads');

  const statItems = [
    { label: '文章', value: stats.posts || 0 },
    { label: '分类', value: stats.categories || 0 },
    { label: '标签', value: stats.tags || 0 },
    ...(stats.words ? [{ label: '字数', value: stats.words }] : []),
    ...(stats.views ? [{ label: '访问', value: stats.views }] : []),
  ];

  return (
    <div className="space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center"
      >
        <p className="eyebrow">ABOUT THE AUTHOR</p>
      </motion.div>

      {/* Author card */}
      <div className="flex flex-col items-center gap-8">
        {/* Avatar：仅阴影层次，无边环/光晕 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isVisible ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="w-28 h-28 rounded-full overflow-hidden shadow-[0_14px_36px_-14px_rgba(15,23,42,0.28),0_6px_16px_-6px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_40px_-14px_rgba(0,0,0,0.65),0_6px_18px_-6px_rgba(0,0,0,0.45)]">
            {authorAvatar ? (
              <Image
                src={authorAvatar}
                alt={authorName}
                width={112}
                height={112}
                className="w-full h-full object-cover"
                unoptimized={needsUnoptimized}
              />
            ) : (
              <div className="w-full h-full bg-[var(--bg-raised)] flex items-center justify-center text-h2 font-display text-[var(--aurora-1)]">
                {authorName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </motion.div>

        {/* Name + Bio */}
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          className="text-center space-y-3 max-w-lg"
        >
          <h2 className="text-h2 font-display font-bold text-[var(--ink-primary)]">
            {authorName}
          </h2>
          {authorBio && (
            <p className="text-reading text-[var(--ink-secondary)] leading-relaxed">
              {authorBio}
            </p>
          )}
        </motion.div>

        {/* Stats counters */}
        <motion.div
          initial="initial"
          animate={isVisible ? 'animate' : 'initial'}
          variants={{ animate: { transition: { staggerChildren: 0.08, delayChildren: 0.4 } } }}
          className="flex flex-wrap justify-center gap-8"
        >
          {statItems.map((s) => (
            <motion.div
              key={s.label}
              variants={fadeUp}
              className="text-center min-w-[4rem]"
            >
              <div className="text-h3 font-display font-bold text-[var(--ink-primary)]">
                <AnimatedCounter target={s.value} isVisible={isVisible} />
              </div>
              <p className="text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider mt-1">
                {s.label}
              </p>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="flex flex-col sm:flex-row gap-4 pt-4"
        >
          <Link
            href="/"
            className="hero-primary-btn group inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-white font-medium min-w-40"
          >
            <span className="hero-btn-shimmer" aria-hidden="true" />
            <span className="relative z-10">开始体验</span>
            <svg
              className="relative z-10 w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--ink-subtle)]/30 text-[var(--ink-primary)] font-medium hover:border-[var(--aurora-1)]/50 hover:bg-[var(--bg-leaf)] transition-all min-w-40"
          >
            查看源码
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </motion.div>
      </div>
    </div>
  );
}
