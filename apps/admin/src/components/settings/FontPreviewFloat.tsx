import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Type, Clock, RotateCcw } from 'lucide-react';
import { getFontOption } from './FontPickerModal';

const PREVIEW_DURATION = 2 * 60 * 1000; // 2 分钟

interface FontPreviewFloatProps {
  /** 正在预览的字体 id，null 表示无预览 */
  previewFontId: string | null;
  /** 当前已保存的字体 id */
  savedFontId: string;
  /** 关闭预览（还原） */
  onClose: () => void;
  /** 确认应用（持久化保存） */
  onApply: (fontId: string) => void;
  /** 切换到另一个字体预览 */
  onSwitchPreview: () => void;
}

export default function FontPreviewFloat({
  previewFontId,
  onClose,
  onApply,
  onSwitchPreview,
}: FontPreviewFloatProps) {
  const [remainingMs, setRemainingMs] = useState(PREVIEW_DURATION);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const font = previewFontId ? getFontOption(previewFontId) : null;

  // 每次 previewFontId 变化时重置计时器
  useEffect(() => {
    if (!previewFontId) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    startTimeRef.current = Date.now();
    setRemainingMs(PREVIEW_DURATION);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, PREVIEW_DURATION - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0) {
        clearInterval(timerRef.current);
        onClose(); // 时间到自动还原
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewFontId, onClose]);

  if (!previewFontId || !font) return null;

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const progress = remainingMs / PREVIEW_DURATION;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 60, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 60, scale: 0.9 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]"
      >
        <div className="relative bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden min-w-[360px] max-w-[420px]">
          {/* 进度条 */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--bg-secondary)]">
            <motion.div
              className="h-full bg-primary"
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.5, ease: 'linear' }}
            />
          </div>

          <div className="px-4 py-3">
            {/* 上方信息行 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Type className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    正在预览：{font.name}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">{font.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">{timeStr}</span>
              </div>
            </div>

            {/* 字体预览 */}
            <div
              className="text-sm text-[var(--text-secondary)] mb-3 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/50 leading-relaxed"
              style={{ fontFamily: font.cssFamily }}
            >
              {font.previewText}
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                关闭还原
              </button>
              <button
                onClick={onSwitchPreview}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                换一个
              </button>
              <button
                onClick={() => onApply(previewFontId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
              >
                <Check className="w-3.5 h-3.5" />
                满意，应用
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
