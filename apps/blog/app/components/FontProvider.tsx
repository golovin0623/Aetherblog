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
  // 注意：不在 cleanup 中移除字体样式，因为 layout.tsx 已在 SSR 阶段通过
  // html.className="font-override" 和 html.style 注入了正确的字体。
  // 如果 cleanup 移除这些样式，在 iOS PWA 或页面过渡时会出现字体闪现。
  useEffect(() => {
    const config = FONT_MAP[fontFamily] || FONT_MAP.system;

    // 加载 Google Fonts（如果需要）
    // 注意：serif-elegant 的 Playfair/Noto 已通过 next/font 预加载，不会重复请求
    // Lora/Merriweather 等其他字体需要动态加载，这是可配置字体系统的必要权衡
    if (config.googleFontsUrl) {
      loadGoogleFont(config.googleFontsUrl);
    }

    // 对于非 system 字体，覆盖 sans 字体栈
    // 这样所有使用 font-sans 的元素也会用新字体
    if (fontFamily !== 'system') {
      document.documentElement.style.setProperty('--font-sans-override', config.cssFamily);
      document.documentElement.classList.add('font-override');
    } else {
      document.documentElement.style.removeProperty('--font-sans-override');
      document.documentElement.classList.remove('font-override');
    }
  }, [fontFamily]);

  return (
    <FontContext.Provider value={{ fontFamily }}>
      {children}
    </FontContext.Provider>
  );
}
