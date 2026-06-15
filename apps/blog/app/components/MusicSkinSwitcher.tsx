'use client';

import { useEffect, useRef, useState } from 'react';
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

/**
 * 音乐皮肤切换器 —— 访客本地切换(localStorage),不影响全站主题。
 * 预设走纯 CSS;自定义两色(亮/暗)经 provider 注入作用域 <style>。
 */
export function MusicSkinSwitcher({ className }: { className?: string }) {
  const { skin, skinMode, skinCustomLight, skinCustomDark, hasSkinOverride, selectPresetSkin, selectCustomSkin, resetSkin } =
    useMusicPlayer();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [customLight, setCustomLight] = useState(skinCustomLight || CRIMSON.seedLight);
  const [customDark, setCustomDark] = useState(skinCustomDark || CRIMSON.seedDark);
  const rootRef = useRef<HTMLDivElement>(null);

  // 同步外部(后台默认 / 其它入口)变更到本地取色控件
  useEffect(() => {
    if (skinCustomLight) setCustomLight(skinCustomLight);
    if (skinCustomDark) setCustomDark(skinCustomDark);
  }, [skinCustomLight, skinCustomDark]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-12 items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-5 text-sm font-bold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="music-skin-popover"
      >
        <Palette className="h-4 w-4" />
        皮肤
        <span
          className="h-3 w-3 rounded-full ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
          style={{ background: 'var(--aurora-1)' }}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="music-skin-popover"
            data-music-skin={skin}
            initial={variants.dropDown.initial}
            animate={variants.dropDown.animate}
            exit={variants.dropDown.exit}
            transition={transition.quick}
            className="surface-overlay absolute right-0 z-50 mt-3 w-[320px] origin-top-right p-5"
            role="dialog"
            aria-label="音乐皮肤"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--aurora-1)]">Music Skin</p>
              {hasSkinOverride && (
                <button
                  type="button"
                  onClick={() => resetSkin()}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
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
                    className="group/skin flex flex-col items-center gap-1.5"
                    aria-pressed={active}
                    title={preset.label}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full transition-transform group-hover/skin:scale-110',
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
                  className="h-8 w-10 cursor-pointer rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent"
                  aria-label="亮主题光源"
                />
                亮色
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <input
                  type="color"
                  value={customDark}
                  onChange={(e) => setCustomDark(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent"
                  aria-label="暗主题光源"
                />
                暗色
              </label>
            </div>
            <button
              type="button"
              onClick={() => selectCustomSkin(customLight, customDark)}
              className={cn(
                'mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs font-black transition-transform hover:scale-[1.02]',
                skinMode === 'custom'
                  ? 'bg-[var(--aurora-1)] text-[var(--bg-void)]'
                  : 'border border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]'
              )}
            >
              {skinMode === 'custom' ? '自定义皮肤已应用' : '应用自定义皮肤'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default MusicSkinSwitcher;
