'use client';

/**
 * 友链页 —— 「星群与信笺」
 * -----------------------------------------------------------
 * 两种视图,两个 Apple 隐喻:
 *  · 列表视图 = iOS 通知中心:玻璃信笺逐条弹落,超过阈值折叠成
 *    通知堆(展开/收起带弹簧编排);
 *  · 气泡视图 = Apple Watch 表盘:蜂窝星群 + 指针鱼眼磁吸,
 *    见 FriendBubbleField。
 * 动效全部取自 @aetherblog/ui 预设,颜色全部取自 Codex 令牌。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Globe,
  Hexagon,
  LayoutList,
} from 'lucide-react';
import { useLocalStorage, useIsMobile } from '@aetherblog/hooks';
import { spring, transition, variants } from '@aetherblog/ui';
import FriendCard from '../components/FriendCard';
import FriendBubbleField from '../components/FriendBubbleField';
import { sanitizeImageUrl } from '../lib/sanitizeUrl';
import { FriendLink } from '../lib/services';

type ViewMode = 'list' | 'icon';

/** 友链数达到该值时,列表视图折叠为 iOS 通知堆 */
const COLLAPSE_MIN = 10;
/** 折叠时完整展示的信笺数 */
const VISIBLE_COUNT = 6;
/** 通知堆预览的迷你头像数 */
const DECK_PREVIEW = 5;

/* ── 通知堆预览的迷你头像(失败降级为品牌色首字母) ── */
function DeckAvatar({ friend }: { friend: FriendLink }) {
  const [failed, setFailed] = useState(false);
  const safeLogo = sanitizeImageUrl(friend.logo || '', '');
  const themeColor = friend.themeColor || '#6366f1';
  const showImage = safeLogo !== '' && !failed;

  return (
    <span className="relative inline-flex h-7 w-7 overflow-hidden rounded-full ring-2 ring-[var(--bg-substrate)]">
      {showImage ? (
        <Image
          src={safeLogo}
          alt=""
          fill
          sizes="28px"
          onError={() => setFailed(true)}
          className="object-cover"
          aria-hidden="true"
          unoptimized
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center text-micro font-semibold text-white"
          style={{ backgroundColor: themeColor }}
          aria-hidden="true"
        >
          {friend.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

interface FriendsListProps {
  initialFriends: FriendLink[];
}

export default function FriendsList({ initialFriends }: FriendsListProps) {
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('friends-view-mode', 'list');
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  // 防止 SSR 水合不匹配:服务端始终渲染 list,挂载后再切到 localStorage 保存的模式
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => { setHasMounted(true); }, []);
  const activeMode: ViewMode = hasMounted ? viewMode : 'list';

  const handleSetList = useCallback(() => setViewMode('list'), [setViewMode]);
  const handleSetIcon = useCallback(() => setViewMode('icon'), [setViewMode]);
  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleCollapse = useCallback(() => setExpanded(false), []);

  // 通知堆切分:visible 永远只含前 VISIBLE_COUNT 位,其余由
  // 折叠堆(未展开)或 rest 区(已展开)负责渲染,两边互斥不重复。
  const shouldCollapse = initialFriends.length >= COLLAPSE_MIN;
  const visibleFriends = useMemo(
    () => (shouldCollapse ? initialFriends.slice(0, VISIBLE_COUNT) : initialFriends),
    [initialFriends, shouldCollapse],
  );
  const restFriends = useMemo(
    () => (shouldCollapse ? initialFriends.slice(VISIBLE_COUNT) : []),
    [initialFriends, shouldCollapse],
  );

  const count = initialFriends.length;

  return (
    <div className="min-h-screen bg-background text-[var(--ink-primary)] selection:bg-primary/30">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-24 md:pb-16">
        {/* 背景环境光 —— 极光令牌,随主题翻转 */}
        <div className="pointer-events-none fixed left-0 right-0 top-0 -z-10 h-[500px]">
          <div
            className="theme-transition-glow absolute right-1/4 top-[-120px] h-[480px] w-[580px] rounded-full"
            style={{
              background: 'color-mix(in oklch, var(--aurora-1) 9%, transparent)',
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)',
            }}
          />
          <div
            className="theme-transition-glow absolute left-0 top-1/4 h-[380px] w-[380px] rounded-full"
            style={{
              background: 'color-mix(in oklch, var(--aurora-3) 7%, transparent)',
              filter: 'blur(var(--ambient-glow-blur))',
              opacity: 'var(--ambient-glow-opacity)',
            }}
          />
        </div>

        {/* 页面头部 —— 与 /about 同源的 Apple 式居中排版 */}
        <motion.header
          variants={variants.fadeUp}
          initial="initial"
          animate="animate"
          transition={{ ...transition.flow }}
          className="mb-8 text-center md:mb-10"
        >
          <p className="eyebrow">Constellation</p>
          <h1 className="mt-3 font-display text-h2 font-bold text-[var(--ink-primary)] md:text-h1">
            友情链接
          </h1>
          <p className="mx-auto mt-3 max-w-xl font-editorial text-lede italic text-[var(--ink-secondary)]">
            每一位朋友，都是宇宙里一颗独立发光的星。
          </p>
          <p className="mt-4 font-mono text-micro uppercase tracking-[0.2em] text-[var(--ink-muted)] tabular-nums">
            {count} friends connected
          </p>
        </motion.header>

        {/* 视图切换 —— 胶囊滑块,layoutId 弹簧在两枚按钮间游走 */}
        {count > 0 && (
          <motion.div
            variants={variants.fadeUp}
            initial="initial"
            animate="animate"
            transition={{ ...transition.flow, delay: 0.08 }}
            className="mb-10 flex justify-center md:mb-12"
          >
            <div
              role="group"
              aria-label="视图模式切换"
              className="surface-leaf inline-flex items-center gap-1 rounded-full p-1"
            >
              {(
                [
                  { mode: 'list' as const, label: '列表', Icon: LayoutList, onClick: handleSetList },
                  { mode: 'icon' as const, label: '气泡', Icon: Hexagon, onClick: handleSetIcon },
                ]
              ).map(({ mode, label, Icon, onClick }) => {
                const active = activeMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={onClick}
                    aria-pressed={active}
                    aria-label={`${label}视图`}
                    className={`relative flex items-center gap-1.5 rounded-full px-4 py-2 text-caption font-medium transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'text-[var(--ink-primary)]'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="friends-view-pill"
                        transition={{ ...spring.precise }}
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: 'color-mix(in oklch, var(--aurora-1) 16%, transparent)',
                          boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--aurora-1) 30%, transparent)',
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {count === 0 ? (
          /* 空态 —— 星群尚在汇聚 */
          <motion.div
            variants={variants.scaleIn}
            initial="initial"
            animate="animate"
            transition={{ ...transition.flow }}
            className="surface-leaf mx-auto max-w-md rounded-2xl px-8 py-14 text-center"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-raised)]">
              <Globe className="h-7 w-7 text-[var(--ink-muted)]" aria-hidden="true" />
            </div>
            <p className="mt-5 text-body font-medium text-[var(--ink-secondary)]">星群尚在汇聚中</p>
            <p className="mt-1.5 text-caption text-[var(--ink-muted)]">暂无友链，稍后再来看看吧</p>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            {activeMode === 'list' ? (
              /* ── 列表视图:iOS 通知栈 ─────────────────── */
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ ...transition.quick }}
                className="mx-auto flex w-full max-w-2xl flex-col gap-2.5"
              >
                {visibleFriends.map((friend, index) => (
                  <FriendCard
                    key={friend.id}
                    name={friend.name}
                    url={friend.url}
                    avatar={friend.logo || ''}
                    description={friend.description}
                    themeColor={friend.themeColor}
                    enterDelay={Math.min(index * 0.04, 0.5)}
                  />
                ))}

                {shouldCollapse && (
                  <AnimatePresence initial={false}>
                    {!expanded ? (
                      /* iOS 通知堆:顶卡 + 两层背卡,点击展开 */
                      <motion.button
                        key="deck"
                        type="button"
                        onClick={handleExpand}
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{
                          opacity: 1, y: 0, scale: 1,
                          transition: { ...spring.soft, delay: VISIBLE_COUNT * 0.04 },
                        }}
                        exit={{ opacity: 0, scale: 0.96, y: -8, transition: { ...transition.quick } }}
                        whileTap={{ scale: 0.98, transition: { ...spring.precise } }}
                        aria-label={`展开其余 ${restFriends.length} 位朋友`}
                        className="group relative mt-2 pb-3 text-left focus-visible:outline-none"
                      >
                        {/* 背后两层信笺,从底部探出 */}
                        <span
                          className="absolute inset-x-6 bottom-0 top-3 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_45%,transparent)]"
                          aria-hidden="true"
                        />
                        <span
                          className="absolute inset-x-3 bottom-1.5 top-1.5 rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_70%,transparent)]"
                          aria-hidden="true"
                        />
                        {/* 顶卡 */}
                        <span className="surface-leaf relative flex items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] group-hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] group-focus-visible:ring-2 group-focus-visible:ring-primary md:px-5">
                          <span className="flex flex-shrink-0 -space-x-2.5">
                            {restFriends.slice(0, DECK_PREVIEW).map((friend) => (
                              <DeckAvatar key={friend.id} friend={friend} />
                            ))}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-semibold text-[var(--ink-primary)]">
                              还有 {restFriends.length} 位朋友
                            </span>
                            <span className="mt-0.5 block font-mono text-micro uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                              Show more · 展开查看
                            </span>
                          </span>
                          <ChevronDown
                            className="h-4 w-4 flex-shrink-0 text-[var(--ink-muted)] transition-transform duration-[var(--dur-quick)] ease-[var(--ease-out)] group-hover:translate-y-0.5"
                            aria-hidden="true"
                          />
                        </span>
                      </motion.button>
                    ) : (
                      <React.Fragment key="rest">
                        {restFriends.map((friend, index) => (
                          <FriendCard
                            key={friend.id}
                            name={friend.name}
                            url={friend.url}
                            avatar={friend.logo || ''}
                            description={friend.description}
                            themeColor={friend.themeColor}
                            enterDelay={Math.min(index * 0.035, 0.5)}
                          />
                        ))}
                        <motion.button
                          key="collapse"
                          type="button"
                          onClick={handleCollapse}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, transition: { ...transition.quick, delay: 0.3 } }}
                          exit={{ opacity: 0, transition: { ...transition.quick } }}
                          whileTap={{ scale: 0.96, transition: { ...spring.precise } }}
                          className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-4 py-2 text-caption text-[var(--ink-muted)] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] hover:text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          收起
                        </motion.button>
                      </React.Fragment>
                    )}
                  </AnimatePresence>
                )}
              </motion.div>
            ) : (
              /* ── 气泡视图:Apple Watch 星群 ─────────────── */
              <motion.div
                key="icon"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ ...transition.quick }}
              >
                <FriendBubbleField friends={initialFriends} isMobile={isMobile} />
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* 交换友链 CTA —— 邀请加入星群 */}
        <motion.section
          variants={variants.fadeUp}
          initial="initial"
          animate="animate"
          transition={{ ...transition.flow, delay: 0.24 }}
          className="mx-auto mt-16 max-w-md md:mt-20"
        >
          <motion.a
            href="https://github.com/golovin0623/Aetherblog/issues"
            target="_blank"
            rel="noopener noreferrer"
            data-interactive
            whileTap={{ scale: 0.98, transition: { ...spring.precise } }}
            className="surface-leaf block rounded-2xl px-6 py-7 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]"
          >
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-[var(--aurora-1)]">
              Join the constellation
            </p>
            <p className="mt-2.5 font-display text-h4 font-semibold text-[var(--ink-primary)]">
              想成为其中一颗星？
            </p>
            <p className="mt-1.5 text-caption text-[var(--ink-secondary)]">
              在 GitHub Issues 提交你的链接，与我交换友链
            </p>
            <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)] px-4 py-2 text-caption font-medium text-[var(--ink-primary)]">
              提交申请
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </motion.a>
        </motion.section>
      </main>
    </div>
  );
}
