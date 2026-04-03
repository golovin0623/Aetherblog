import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Eye, Type } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================
// Font Registry - 字体注册表
// 扩展说明：后续可扩展为中英文字体搭配组合，每个 FontOption
// 可增加 latinFamily / cjkFamily 分别指定英文和中文字体。
// 目前统一配置，不区分中英文。
// ============================================================

export interface FontOption {
  /** 唯一标识，存入数据库 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 用于 CSS font-family 的值 */
  cssFamily: string;
  /** Google Fonts URL（若需动态加载），为空则无需额外加载 */
  googleFontsUrl?: string;
  /** 预览文本 */
  previewText?: string;
  /**
   * 扩展字段（预留）
   * 后续可用于区分 latinFamily / cjkFamily 等
   */
  meta?: Record<string, string>;
}

/** 可用字体列表 - 后续可从后端配置或扩展 */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'system',
    name: '系统默认',
    description: 'Inter + 系统字体，清晰现代的无衬线体',
    cssFamily: "'Inter', system-ui, -apple-system, sans-serif",
    previewText: 'The quick brown fox 敏捷的棕色狐狸跳过懒狗',
  },
  {
    id: 'serif-elegant',
    name: '优雅衬线',
    description: 'Playfair Display + 思源宋体，时间线同款经典衬线体',
    cssFamily: "'Playfair Display', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
    previewText: 'The quick brown fox 敏捷的棕色狐狸跳过懒狗',
  },
  {
    id: 'lora',
    name: 'Lora 衬线',
    description: 'Lora + 思源宋体，温暖优雅的阅读体验',
    cssFamily: "'Lora', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
    previewText: 'The quick brown fox 敏捷的棕色狐狸跳过懒狗',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    description: 'Merriweather + 思源宋体，专为屏幕阅读设计的衬线体',
    cssFamily: "'Merriweather', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
    previewText: 'The quick brown fox 敏捷的棕色狐狸跳过懒狗',
  },
  // ============================================================
  // 扩展区域 - 添加更多字体选项
  // 后续可增加：
  //   - 中文专属字体（霞鹜文楷、LXGW WenKai 等）
  //   - 等宽字体选项（代码风博客）
  //   - 中英文搭配组合（latinFamily + cjkFamily）
  // ============================================================
];

/** 根据 id 查找字体配置 */
export function getFontOption(id: string): FontOption | undefined {
  return FONT_OPTIONS.find((f) => f.id === id);
}

/** 动态加载 Google Fonts 样式表 */
function loadGoogleFont(url: string): Promise<void> {
  return new Promise((resolve) => {
    const existing = document.querySelector(`link[href="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // 加载失败也不阻塞
    document.head.appendChild(link);
  });
}

interface FontPickerModalProps {
  open: boolean;
  currentFont: string;
  onClose: () => void;
  onSelect: (fontId: string) => void;
  onPreview: (fontId: string) => void;
}

export default function FontPickerModal({
  open,
  currentFont,
  onClose,
  onSelect,
  onPreview,
}: FontPickerModalProps) {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // 打开弹窗时预加载所有 Google Fonts
  useEffect(() => {
    if (!open) return;
    const urls = FONT_OPTIONS.map((f) => f.googleFontsUrl).filter(Boolean) as string[];
    Promise.all(urls.map(loadGoogleFont)).then(() => setFontsLoaded(true));
  }, [open]);

  const handleSelect = useCallback(
    (fontId: string) => {
      onSelect(fontId);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <div className="w-full max-w-lg bg-[var(--bg-popover)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <Type className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">选择字体</h2>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 提示 */}
              <div className="px-6 pt-4">
                <p className="text-xs text-[var(--text-secondary)]">
                  选择一个字体作为博客全局字体。点击「体验」可预览 2 分钟，满意后点击「应用」持久化保存。
                </p>
                {/* 扩展说明 */}
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  后续将支持中英文字体独立搭配组合
                </p>
              </div>

              {/* 字体列表 */}
              <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                {FONT_OPTIONS.map((font) => {
                  const isActive = currentFont === font.id;
                  return (
                    <motion.div
                      key={font.id}
                      layout
                      className={cn(
                        'relative p-4 rounded-xl border transition-all cursor-pointer group',
                        isActive
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-[var(--border-default)] bg-[var(--bg-secondary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-tertiary)]',
                      )}
                    >
                      {/* 字体信息 */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {font.name}
                            </span>
                            {isActive && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                                <Check className="w-3 h-3" /> 当前
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {font.description}
                          </p>
                        </div>
                      </div>

                      {/* 字体预览 - 用字体自身展示 */}
                      <div
                        className="text-base text-[var(--text-primary)] leading-relaxed mb-3 min-h-[2.5rem]"
                        style={{
                          fontFamily: font.cssFamily,
                          opacity: fontsLoaded || font.id === 'system' ? 1 : 0.5,
                        }}
                      >
                        {font.previewText}
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPreview(font.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          体验 2 分钟
                        </button>
                        {!isActive && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(font.id);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            应用
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <p className="text-[10px] text-[var(--text-muted)] text-center">
                  字体通过 Google Fonts 加载 &middot; 保存后对博客前台生效
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
