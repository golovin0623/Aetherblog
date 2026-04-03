import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { FONT_OPTIONS, getFontOption, type FontOption } from '@/components/settings/FontPickerModal';
import FontPreviewFloat from '@/components/settings/FontPreviewFloat';

interface FontPreviewContextValue {
  /** 当前预览中的字体 id */
  previewFontId: string | null;
  /** 开始预览某个字体 */
  startPreview: (fontId: string) => void;
  /** 结束预览（还原） */
  stopPreview: () => void;
  /** 确认应用预览字体 */
  applyPreview: (fontId: string) => void;
  /** 切换到下一个字体预览 */
  switchToNextPreview: () => void;
}

const FontPreviewContext = createContext<FontPreviewContextValue | null>(null);

export function useFontPreview() {
  const ctx = useContext(FontPreviewContext);
  if (!ctx) throw new Error('useFontPreview must be used within FontPreviewProvider');
  return ctx;
}

interface FontPreviewProviderProps {
  children: React.ReactNode;
  /** 当前已保存的字体 id（从 settings 读取） */
  savedFontId: string;
  /** 持久化保存字体 */
  onSaveFontId: (fontId: string) => void;
}

/** 动态加载 Google Fonts */
function loadGoogleFont(url: string): void {
  const existing = document.querySelector(`link[href="${url}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

/** 将字体应用到 document.body */
function applyFontToBody(font: FontOption | undefined) {
  if (!font || font.id === 'system') {
    document.body.style.fontFamily = '';
    return;
  }
  if (font.googleFontsUrl) {
    loadGoogleFont(font.googleFontsUrl);
  }
  document.body.style.fontFamily = font.cssFamily;
}

export function FontPreviewProvider({ children, savedFontId, onSaveFontId }: FontPreviewProviderProps) {
  const [previewFontId, setPreviewFontId] = useState<string | null>(null);
  const savedFontIdRef = useRef(savedFontId);
  savedFontIdRef.current = savedFontId;

  // 开始预览 - 立即应用字体到 body
  const startPreview = useCallback((fontId: string) => {
    setPreviewFontId(fontId);
    applyFontToBody(getFontOption(fontId));
  }, []);

  // 结束预览 - 还原为已保存的字体
  const stopPreview = useCallback(() => {
    setPreviewFontId(null);
    applyFontToBody(getFontOption(savedFontIdRef.current));
  }, []);

  // 确认应用
  const applyPreview = useCallback((fontId: string) => {
    setPreviewFontId(null);
    onSaveFontId(fontId);
  }, [onSaveFontId]);

  // 切换到下一个字体
  const switchToNextPreview = useCallback(() => {
    setPreviewFontId((current) => {
      const currentIdx = FONT_OPTIONS.findIndex((f) => f.id === current);
      const nextIdx = (currentIdx + 1) % FONT_OPTIONS.length;
      const nextFont = FONT_OPTIONS[nextIdx];
      applyFontToBody(nextFont);
      return nextFont.id;
    });
  }, []);

  // 当 previewFontId 变化时确保字体已应用
  useEffect(() => {
    if (previewFontId) {
      applyFontToBody(getFontOption(previewFontId));
    }
  }, [previewFontId]);

  // 当 savedFontId 变化且不在预览时，同步 body 字体
  useEffect(() => {
    if (!previewFontId) {
      applyFontToBody(getFontOption(savedFontId));
    }
  }, [savedFontId, previewFontId]);

  return (
    <FontPreviewContext.Provider
      value={{ previewFontId, startPreview, stopPreview, applyPreview, switchToNextPreview }}
    >
      {children}
      {/* 全局浮窗 - 跨页面持久 */}
      <FontPreviewFloat
        previewFontId={previewFontId}
        savedFontId={savedFontId}
        onClose={stopPreview}
        onApply={applyPreview}
        onSwitchPreview={switchToNextPreview}
      />
    </FontPreviewContext.Provider>
  );
}
