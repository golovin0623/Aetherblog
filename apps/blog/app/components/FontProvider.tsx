'use client';

import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';

// ============================================================
// Font Registry (与 admin 侧 FontPickerModal 保持同步)
// 后续可抽到 packages/types 中共享
// 扩展说明：后续支持中英文字体独立搭配组合时，
// 可增加 latinFamily / cjkFamily 字段
// ============================================================

interface FontConfig {
  id: string;
  cssFamily: string;
  googleFontsUrl?: string;
}

const FONT_MAP: Record<string, FontConfig> = {
  system: {
    id: 'system',
    cssFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  'serif-elegant': {
    id: 'serif-elegant',
    cssFamily: "'Playfair Display', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
  lora: {
    id: 'lora',
    cssFamily: "'Lora', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
  merriweather: {
    id: 'merriweather',
    cssFamily: "'Merriweather', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
};

interface FontContextValue {
  fontFamily: string;
}

const FontContext = createContext<FontContextValue>({ fontFamily: 'system' });

export function useFontFamily() {
  return useContext(FontContext);
}

/** 动态加载 Google Fonts */
function loadGoogleFont(url: string) {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector(`link[href="${url}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

interface FontProviderProps {
  children: ReactNode;
  /** 从服务端设置中传入的字体 id，如 'system' | 'serif-elegant' 等 */
  initialFont?: string;
}

export default function FontProvider({ children, initialFont = 'system' }: FontProviderProps) {
  const [fontFamily, setFontFamily] = useState(initialFont);

  // 应用字体到 document
  useEffect(() => {
    const config = FONT_MAP[fontFamily] || FONT_MAP.system;

    // 加载 Google Fonts（如果需要）
    if (config.googleFontsUrl) {
      loadGoogleFont(config.googleFontsUrl);
    }

    // 设置 CSS 变量，供全局使用
    document.documentElement.style.setProperty('--font-body', config.cssFamily);

    // 对于非 system 字体，同时覆盖 sans 字体栈
    // 这样所有使用 font-sans 的元素也会用新字体
    if (fontFamily !== 'system') {
      document.documentElement.style.setProperty('--font-sans-override', config.cssFamily);
      document.documentElement.classList.add('font-override');
    } else {
      document.documentElement.style.removeProperty('--font-sans-override');
      document.documentElement.classList.remove('font-override');
    }

    return () => {
      document.documentElement.style.removeProperty('--font-body');
      document.documentElement.style.removeProperty('--font-sans-override');
      document.documentElement.classList.remove('font-override');
    };
  }, [fontFamily]);

  // 监听 settings 变化（通过 storage event 支持跨 tab 同步，预留）
  useEffect(() => {
    setFontFamily(initialFont);
  }, [initialFont]);

  return (
    <FontContext.Provider value={{ fontFamily }}>
      {children}
    </FontContext.Provider>
  );
}
