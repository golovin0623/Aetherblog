import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Type, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
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
    setExpanded(false);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, PREVIEW_DURATION - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0) {
        clearInterval(timerRef.current);
        onClose();
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
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-6 right-6 z-[9999]"
      >
        <div className="relative rounded-2xl overflow-hidden shadow-[var(--shadow-lg)] bg-[var(--bg-popover)] border border-[var(--border-default)]">
          {/* 顶部进度条 */}
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[var(--bg-tertiary)]">
            <motion.div
              className="h-full bg-primary rounded-full"
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.5, ease: 'linear' }}
            />
          </div>

          {/* 紧凑头部 - 始终可见 */}
          <div className="px-3 pt-2.5 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Type className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                  {font.name}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums">
                  体验中 {timeStr}
                </p>
              </div>
              {/* 展开/收起按钮 */}
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
              {/* 关闭按钮 */}
              <button
                onClick={onClose}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 展开区域 */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                {/* 字体预览文本 */}
                <div className="px-3 pb-2">
                  <div
                    className="text-sm text-[var(--text-primary)] px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] leading-relaxed"
                    style={{ fontFamily: font.cssFamily }}
                  >
                    {font.previewText}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 底部操作栏 */}
          <div className="px-3 pb-2.5 flex items-center gap-1.5">
            <button
              onClick={onSwitchPreview}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              换一个
            </button>
            <div className="flex-1" />
            <button
              onClick={() => onApply(previewFontId)}
              className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <Check className="w-3 h-3" />
              应用
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
