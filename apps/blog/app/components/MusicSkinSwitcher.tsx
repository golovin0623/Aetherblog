'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Palette, RotateCcw } from 'lucide-react';
import { transition, variants } from '@aetherblog/ui';
import { MUSIC_SKIN_PRESETS } from '@aetherblog/utils';
import { useTheme } from '@aetherblog/hooks';
import { useMusicPlayer } from './MusicPlayerProvider';

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const CRIMSON = MUSIC_SKIN_PRESETS[0];
const DESKTOP_WIDTH = 320;

/**
 * 音乐皮肤切换器 —— 访客本地切换(localStorage),不影响全站主题。
 * 预设走纯 CSS;自定义两色(亮/暗)经 provider 注入作用域 <style>。
 *
 * 弹层经 Portal 渲染到 document.body —— 触发按钮位于 `.surface-luminous`
 * (overflow:hidden + backdrop-filter)内,普通 absolute/fixed 会被裁剪或被
 * 该祖先变成定位上下文,移动端会整片移出屏幕。Portal 后:移动端为底部抽屉,
 * 桌面端按触发器位置锚定下拉。
 */
export function MusicSkinSwitcher({ className }: { className?: string }) {
  const { skin, skinMode, skinCustomLight, skinCustomDark, hasSkinOverride, selectPresetSkin, selectCustomSkin, resetSkin } =
    useMusicPlayer();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [customLight, setCustomLight] = useState(skinCustomLight || CRIMSON.seedLight);
  const [customDark, setCustomDark] = useState(skinCustomDark || CRIMSON.seedDark);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // 跟踪视口断点(与 Tailwind sm=640 对齐)—— 决定底部抽屉 vs 锚定下拉
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // 同步外部(后台默认 / 其它入口)变更到本地取色控件
  useEffect(() => {
    if (skinCustomLight) setCustomLight(skinCustomLight);
    if (skinCustomDark) setCustomDark(skinCustomDark);
  }, [skinCustomLight, skinCustomDark]);

  // 桌面端:按触发器位置锚定(右对齐下拉);随滚动 / 缩放重算
  useEffect(() => {
    if (!open || !isDesktop) return;
    const compute = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 12, left: Math.max(12, r.right - DESKTOP_WIDTH) });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, isDesktop]);

  // 点击外部 / Esc 关闭(触发器与弹层都算"内部")
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const seedFor = (light: string, dark: string) => (isDark ? dark : light);

  const popover = (
    <>
      {/* 移动端遮罩:点击关闭 + 把抽屉读成模态;桌面端无遮罩 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition.quick}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-[79] bg-[color-mix(in_oklch,var(--bg-void)_82%,transparent)] [backdrop-filter:blur(4px)] sm:hidden"
        aria-hidden="true"
      />
      <motion.div
        ref={popoverRef}
        id="music-skin-popover"
        data-music-skin={skin}
        initial={variants.dropDown.initial}
        animate={variants.dropDown.animate}
        exit={variants.dropDown.exit}
        transition={transition.quick}
        style={isDesktop && pos ? { top: pos.top, left: pos.left } : undefined}
        className="surface-overlay fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] max-h-[78vh] w-auto origin-bottom overflow-y-auto p-5 max-sm:!bg-[rgb(from_var(--bg-raised)_r_g_b_/_0.97)] sm:inset-x-auto sm:bottom-auto sm:max-h-none sm:w-[320px] sm:origin-top-right"
        role="dialog"
        aria-label="音乐皮肤"
      >
        {/* 移动端抽屉抓手 */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_22%,transparent)] sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <p data-eyebrow className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Music Skin</p>
          {hasSkinOverride && (
            <button
              type="button"
              onClick={() => resetSkin()}
              className="inline-flex items-center gap-1 rounded-sm text-[11px] font-bold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)]"
            >
              <RotateCcw className="h-3 w-3" />
              跟随后台默认
            </button>
          )}
        </div>
        <h3 className="mt-1 text-lg font-black text-[var(--ink-primary)]">选择音乐皮肤</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
          一个光源、四色派生。仅作用于音乐大厅,且只在你本地生效。
        </p>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {MUSIC_SKIN_PRESETS.map((preset) => {
            const active = skinMode === 'preset' && skin === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPresetSkin(preset.id)}
                className="group/skin flex flex-col items-center gap-1.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)]"
                aria-pressed={active}
                title={preset.label}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full transition-transform group-hover/skin:scale-110 sm:h-9 sm:w-9',
                    active
                      ? 'ring-2 ring-[var(--aurora-1)] ring-offset-2 ring-offset-[var(--bg-raised)]'
                      : 'ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_16%,transparent)]'
                  )}
                  style={{ background: seedFor(preset.seedLight, preset.seedDark) }}
                >
                  {active && <Check className="h-4 w-4 text-[var(--bg-void)]" />}
                </span>
                <span className={cn('text-[10px] font-bold', active ? 'text-[var(--ink-primary)]' : 'text-[var(--ink-muted)]')}>
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="my-4 h-px bg-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]" />

        <p className="text-xs font-bold text-[var(--ink-secondary)]">自定义取色</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <input
              type="color"
              value={customLight}
              onChange={(e) => setCustomLight(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent sm:h-8 sm:w-10"
              aria-label="亮主题光源"
            />
            亮色
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <input
              type="color"
              value={customDark}
              onChange={(e) => setCustomDark(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent sm:h-8 sm:w-10"
              aria-label="暗主题光源"
            />
            暗色
          </label>
        </div>
        <button
          type="button"
          onClick={() => selectCustomSkin(customLight, customDark)}
          className={cn(
            'mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full text-xs font-black transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)] sm:h-9',
            skinMode === 'custom'
              ? 'bg-[var(--aurora-1)] text-[var(--bg-void)]'
              : 'border border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
          )}
        >
          {skinMode === 'custom' ? '自定义皮肤已应用' : '应用自定义皮肤'}
        </button>
      </motion.div>
    </>
  );

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-3 text-sm font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] sm:w-auto sm:px-5"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="music-skin-popover"
      >
        <Palette className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">皮肤</span>
        <span
          className="hidden h-3 w-3 shrink-0 rounded-full ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] sm:inline-block"
          style={{ background: 'var(--aurora-1)' }}
          aria-hidden="true"
        />
      </button>

      {mounted && createPortal(<AnimatePresence>{open && popover}</AnimatePresence>, document.body)}
    </div>
  );
}

export default MusicSkinSwitcher;
