'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import { Clock, Sparkles } from 'lucide-react';
import { transition } from '@aetherblog/ui';
import { EMOJI_CATEGORIES, getRecentEmojis, pushRecentEmoji } from '../lib/emoji';
import { STICKER_PACK, stickerUrl } from '../lib/stickers';

type PanelTab = 'recent' | 'emoji' | 'sticker';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 插入 emoji 字符到输入框光标处（面板保持打开，支持连选）。 */
  onPickEmoji: (emoji: string) => void;
  /** 发送一枚星灵贴纸（发送后面板关闭）。 */
  onPickSticker: (slug: string) => void;
}

/**
 * 表情 / 贴纸面板 —— 设计规范 §4 三层体系的第一、三层入口。
 * surface-overlay 语义：强模糊 + 极光辉光边；ESC / 点外关闭由父级控制 open。
 */
export default function EmojiPanel({ open, onClose, onPickEmoji, onPickSticker }: Props) {
  const [tab, setTab] = useState<PanelTab>('emoji');
  const [recents, setRecents] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setRecents(getRecentEmojis());
  }, [open]);

  // 点击面板外部关闭（触发按钮自行 stopPropagation）。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  const pickEmoji = (emoji: string) => {
    setRecents(pushRecentEmoji(emoji));
    onPickEmoji(emoji);
  };

  const tabs: Array<{ key: PanelTab; label: string }> = [
    { key: 'recent', label: '最近' },
    { key: 'emoji', label: '表情' },
    { key: 'sticker', label: '星灵贴纸' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={rootRef}
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={transition.quick}
          style={{ transformOrigin: 'bottom left' }}
          className="absolute bottom-full left-2 z-30 mb-2 w-[min(340px,calc(100%-16px))] overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_13%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_85%,transparent)] shadow-[0_20px_60px_-20px_color-mix(in_oklch,var(--aurora-1)_22%,rgba(0,0,0,0.8))] backdrop-blur-[40px] backdrop-saturate-[180%]"
          role="dialog"
          aria-label="表情与贴纸"
        >
          <div className="flex gap-0.5 px-2.5 pt-2" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className="rounded-lg px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors"
                style={
                  tab === t.key
                    ? { color: 'var(--aurora-1)', background: 'color-mix(in oklch, var(--aurora-1) 12%, transparent)' }
                    : { color: 'var(--ink-muted)' }
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="h-60 overflow-y-auto px-3 pb-3 pt-2">
            {tab === 'recent' &&
              (recents.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-[var(--ink-muted)]">
                  <Clock size={22} className="opacity-60" />
                  用过的表情会出现在这里
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))]">
                  {recents.map((e) => (
                    <EmojiCell key={e} emoji={e} onPick={pickEmoji} />
                  ))}
                </div>
              ))}

            {tab === 'emoji' &&
              EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.name}>
                  <p className="mx-1 mb-1 mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-muted)] first:mt-0">
                    {cat.name}
                  </p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))]">
                    {cat.emojis.map((e) => (
                      <EmojiCell key={e} emoji={e} onPick={pickEmoji} />
                    ))}
                  </div>
                </div>
              ))}

            {tab === 'sticker' && (
              <>
                <div className="mb-2.5 flex items-center justify-between px-0.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--ink-primary)]">
                    <Sparkles size={13} style={{ color: 'var(--aurora-1)' }} />
                    {STICKER_PACK.name}
                  </span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                    {STICKER_PACK.stickers.length} 枚 · SVG
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {STICKER_PACK.stickers.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      title={s.caption}
                      onClick={() => onPickSticker(s.slug)}
                      className="aspect-square rounded-xl border border-transparent p-2.5 transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_9%,transparent)]"
                    >
                      <Image src={stickerUrl(s.slug)} alt={s.caption} width={96} height={96} unoptimized className="h-full w-full" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EmojiCell({ emoji, onPick }: { emoji: string; onPick: (e: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji)}
      className="flex aspect-square items-center justify-center rounded-lg text-[20px] leading-none transition-transform hover:scale-[1.18] hover:bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)]"
      aria-label={`插入 ${emoji}`}
    >
      {emoji}
    </button>
  );
}
