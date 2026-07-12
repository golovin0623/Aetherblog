'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { transition, variants } from '@aetherblog/ui';
import { MUSIC_SKIN_PRESETS } from '@aetherblog/utils';
import { useIsMobile, useTheme } from '@aetherblog/hooks';
import { useMusicPlayer } from './MusicPlayerProvider';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';

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
export function MusicSkinSwitcher({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const { skin, skinMode, skinCustomLight, skinCustomDark, hasSkinOverride, selectPresetSkin, selectCustomSkin, resetSkin } =
    useMusicPlayer();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
    origin: 'top right' | 'bottom right';
  } | null>(null);
  const [customLight, setCustomLight] = useState(skinCustomLight || CRIMSON.seedLight);
  const [customDark, setCustomDark] = useState(skinCustomDark || CRIMSON.seedDark);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = !isMobile;
  const closePopover = useCallback(() => setOpen(false), []);

  useEffect(() => setMounted(true), []);

  useDialogLifecycle({
    open,
    onClose: closePopover,
    containerRef: popoverRef,
    initialFocusRef: popoverRef,
    returnFocusRef: triggerRef,
    modal: isMobile,
    trapFocus: isMobile,
  });

  // 同步外部(后台默认 / 其它入口)变更到本地取色控件
  useEffect(() => {
    if (skinCustomLight) setCustomLight(skinCustomLight);
    if (skinCustomDark) setCustomDark(skinCustomDark);
  }, [skinCustomLight, skinCustomDark]);

  // 桌面端:按触发器位置锚定(右对齐下拉);随滚动 / 缩放重算
  useEffect(() => {
    if (!open || !isDesktop) return;
    const compute = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      if (!triggerRect || !popoverRect) return;

      const viewportHeight = window.innerHeight - 24;
      const naturalHeight = popoverRef.current?.scrollHeight || popoverRect.height;
      const spaceBelow = window.innerHeight - triggerRect.bottom - 12;
      const spaceAbove = triggerRect.top - 12;
      const openAbove = spaceBelow < naturalHeight && spaceAbove >= spaceBelow;
      const availableHeight = Math.max(160, Math.floor(openAbove ? spaceAbove : spaceBelow));
      const panelHeight = Math.min(naturalHeight, availableHeight, viewportHeight);
      const preferredTop = openAbove
        ? triggerRect.top - panelHeight - 12
        : triggerRect.bottom + 12;
      const maxTop = 12 + Math.max(0, viewportHeight - panelHeight);
      const maxLeft = Math.max(12, window.innerWidth - DESKTOP_WIDTH - 12);

      setPos({
        top: Math.min(Math.max(12, preferredTop), maxTop),
        left: Math.min(Math.max(12, triggerRect.right - DESKTOP_WIDTH), maxLeft),
        maxHeight: availableHeight,
        origin: openAbove ? 'bottom right' : 'top right',
      });
    };
    const frame = window.requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, isDesktop]);

  // 桌面点击外部关闭；Esc、移动端滚动锁定与焦点生命周期由共享 dialog hook 处理。
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
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
        transition={prefersReducedMotion ? transition.instant : transition.quick}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-[79] bg-[color-mix(in_oklch,var(--bg-void)_82%,transparent)] [backdrop-filter:blur(4px)] min-[769px]:hidden"
        aria-hidden="true"
      />
      <motion.div
        ref={popoverRef}
        id="music-skin-popover"
        data-music-skin={skin}
        initial={prefersReducedMotion ? { opacity: 0 } : variants.dropDown.initial}
        animate={prefersReducedMotion ? { opacity: 1 } : variants.dropDown.animate}
        exit={prefersReducedMotion ? { opacity: 0 } : variants.dropDown.exit}
        transition={prefersReducedMotion ? transition.instant : transition.quick}
        style={isDesktop && pos ? {
          top: pos.top,
          left: pos.left,
          maxHeight: pos.maxHeight,
          transformOrigin: pos.origin,
        } : undefined}
        className="surface-overlay fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] max-h-[78vh] w-auto origin-bottom overflow-y-auto rounded-[var(--music-radius-panel)] p-5 max-[768px]:!bg-[rgb(from_var(--bg-raised)_r_g_b_/_0.97)] min-[769px]:inset-x-auto min-[769px]:bottom-auto min-[769px]:max-h-[calc(100dvh-1.5rem)] min-[769px]:w-[320px]"
        role="dialog"
        aria-label="音乐皮肤"
        aria-modal={!isDesktop}
        tabIndex={-1}
      >
        {/* 移动端抽屉抓手 */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_22%,transparent)] min-[769px]:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <p data-eyebrow className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Music Skin</p>
          <div className="flex items-center gap-1">
            {hasSkinOverride && (
            <button
              type="button"
              onClick={() => resetSkin()}
              className="music-control-button music-pill-button inline-flex min-h-11 items-center gap-1 bg-[var(--music-control-fill)] px-3 text-[11px] text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)] min-[769px]:min-h-9"
            >
              <RotateCcw className="h-3 w-3" />
              跟随后台默认
            </button>
            )}
            <button
              type="button"
              onClick={closePopover}
              className="music-control-button music-icon-button music-icon-button--tinted inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] min-[769px]:h-9 min-[769px]:w-9"
              aria-label="关闭音乐皮肤"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <h3 className="mt-1 text-lg font-black text-[var(--ink-primary)]">选择音乐皮肤</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
          一个光源、四色派生。仅作用于音乐大厅，且只在你本地生效。
        </p>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {MUSIC_SKIN_PRESETS.map((preset) => {
            const active = skinMode === 'preset' && skin === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPresetSkin(preset.id)}
                className="group/skin flex flex-col items-center gap-1.5 rounded-[var(--music-radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)]"
                aria-pressed={active}
                title={preset.label}
              >
                <span
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full transition-opacity group-hover/skin:opacity-80 min-[769px]:h-9 min-[769px]:w-9',
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
              className="h-11 w-12 cursor-pointer rounded-[var(--music-radius-control)] border border-[var(--music-stroke)] bg-transparent min-[769px]:h-8 min-[769px]:w-10"
              aria-label="亮主题光源"
            />
            亮色
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <input
              type="color"
              value={customDark}
              onChange={(e) => setCustomDark(e.target.value)}
              className="h-11 w-12 cursor-pointer rounded-[var(--music-radius-control)] border border-[var(--music-stroke)] bg-transparent min-[769px]:h-8 min-[769px]:w-10"
              aria-label="暗主题光源"
            />
            暗色
          </label>
        </div>
        <button
          type="button"
          onClick={() => selectCustomSkin(customLight, customDark)}
          className={cn(
            'music-control-button mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--music-radius-control)] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)] min-[769px]:h-9',
            skinMode === 'custom'
              ? 'bg-[var(--ink-primary)] text-[var(--bg-void)]'
              : 'bg-[var(--music-control-fill)] text-[var(--ink-primary)]'
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
        className={cn(
          'music-control-button music-icon-button music-icon-button--tinted inline-flex items-center justify-center rounded-full text-[var(--ink-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
          iconOnly ? 'h-11 w-11 shrink-0' : 'h-12 w-full gap-2 px-3 text-sm font-bold sm:w-auto sm:px-5'
        )}
        aria-label={iconOnly ? '音乐外观' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="music-skin-popover"
      >
        <Palette className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        {iconOnly ? (
          <span className="sr-only">音乐外观</span>
        ) : (
          <>
            <span className="whitespace-nowrap">皮肤</span>
            <span
              className="hidden h-3 w-3 shrink-0 rounded-full ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] sm:inline-block"
              style={{ background: 'var(--aurora-1)' }}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {mounted && createPortal(<AnimatePresence>{open && popover}</AnimatePresence>, document.body)}
    </div>
  );
}

export default MusicSkinSwitcher;
