'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { SiteSettings } from '../lib/services';

// ============================================================
// SiteSettingsProvider
// 将后台设置应用到博客前台，包括：
// - 强制暗黑模式 (enable_dark_mode)
// - 主色调 (theme_primary_color_light / theme_primary_color_dark)
// - 自定义 CSS (custom_css)
// - 每页文章数 (post_page_size)
// - 显示欢迎页 (show_banner / welcome_enabled)
// ============================================================

// --- 颜色工具函数 ---

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return null;
  const full = cleaned.length === 3
    ? cleaned.split('').map(c => c + c).join('')
    : cleaned;
  const num = parseInt(full, 16);
  if (isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generateColorVars(hex: string, isDark: boolean): Record<string, string> {
  const rgb = hexToRgb(hex);
  if (!rgb) return {};
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (isDark) {
    return {
      '--color-primary': hex,
      '--color-primary-hover': hslToHex(h, Math.min(s + 5, 100), Math.min(l + 10, 95)),
      '--color-primary-light': hslToHex(h, Math.min(s + 5, 100), Math.min(l + 15, 95)),
      '--color-primary-lighter': hslToHex(h, Math.max(s - 20, 10), Math.min(l + 25, 95)),
      '--color-accent': hslToHex((h + 30) % 360, s, l),
      '--shadow-primary': `0 4px 14px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
      '--shadow-primary-lg': `0 10px 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
      '--gradient-primary': `linear-gradient(135deg, ${hex} 0%, ${hslToHex((h + 30) % 360, s, l)} 100%)`,
      '--focus-ring': `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
    };
  } else {
    return {
      '--color-primary': hex,
      '--color-primary-hover': hslToHex(h, s, Math.max(l - 8, 5)),
      '--color-primary-light': hslToHex(h, Math.max(s - 10, 0), Math.min(l + 20, 90)),
      '--color-primary-lighter': hslToHex(h, Math.max(s - 30, 10), Math.min(l + 50, 95)),
      '--color-accent': hslToHex((h + 30) % 360, s, l),
      '--shadow-primary': `0 4px 14px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
      '--shadow-primary-lg': `0 10px 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
      '--gradient-primary': `linear-gradient(135deg, ${hex} 0%, ${hslToHex((h + 30) % 360, s, l)} 100%)`,
      '--focus-ring': `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`,
    };
  }
}

interface SiteSettingsContextValue {
  /** 每页文章数，默认 6 */
  postPageSize: number;
  /** 是否显示欢迎页 */
  showBanner: boolean;
  /** 全部原始设置 */
  settings: SiteSettings;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  postPageSize: 6,
  showBanner: true,
  settings: {} as SiteSettings,
});

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}

interface Props {
  children: ReactNode;
  settings: SiteSettings;
}

export default function SiteSettingsProvider({ children, settings }: Props) {
  const postPageSize = Number(settings.post_page_size) || 6;
  const showBanner = settings.show_banner !== 'false' && settings.show_banner !== false;

  // 1. 强制暗黑模式
  useEffect(() => {
    const forceDark = settings.enable_dark_mode === 'true' || settings.enable_dark_mode === true;
    if (forceDark) {
      // 强制暗黑：覆盖 localStorage 并应用
      const root = document.documentElement;
      root.classList.add('dark');
      root.classList.remove('light');
      root.style.colorScheme = 'dark';
      // 设置标记，让 ThemeProvider 知道不要覆盖
      root.dataset.forceDark = 'true';
      try {
        localStorage.setItem('aetherblog-theme', 'dark');
      } catch {}
    } else {
      // 跟随系统/用户选择 - 移除强制标记
      document.documentElement.removeAttribute('data-force-dark');
    }
  }, [settings.enable_dark_mode]);

  // 2. 主色调 - 亮色/暗色分别配置，生成完整变量集
  useEffect(() => {
    const lightColor = settings.theme_primary_color_light as string;
    const darkColor = settings.theme_primary_color_dark as string;
    const fallbackColor = settings.theme_primary_color as string;

    if (lightColor || darkColor || fallbackColor) {
      let styleEl = document.getElementById('aetherblog-primary-color') as HTMLStyleElement;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'aetherblog-primary-color';
        document.head.appendChild(styleEl);
      }

      const lightVal = lightColor || fallbackColor;
      const darkVal = darkColor || fallbackColor;

      let css = '';
      if (lightVal) {
        const vars = generateColorVars(lightVal, false);
        const entries = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
        css += `:root, :root.light {\n${entries}\n}\n`;
      }
      if (darkVal) {
        const vars = generateColorVars(darkVal, true);
        const entries = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
        css += `:root.dark {\n${entries}\n}\n`;
      }
      styleEl.textContent = css;
    }

    return () => {
      const el = document.getElementById('aetherblog-primary-color');
      if (el) el.remove();
    };
  }, [settings.theme_primary_color, settings.theme_primary_color_light, settings.theme_primary_color_dark]);

  // 3. 自定义 CSS 注入
  useEffect(() => {
    const customCss = (settings.custom_css as string) || '';
    let styleEl = document.getElementById('aetherblog-custom-css') as HTMLStyleElement;

    if (customCss.trim()) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'aetherblog-custom-css';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = customCss;
    } else {
      if (styleEl) styleEl.remove();
    }

    return () => {
      const el = document.getElementById('aetherblog-custom-css');
      if (el) el.remove();
    };
  }, [settings.custom_css]);

  return (
    <SiteSettingsContext.Provider value={{ postPageSize, showBanner, settings }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}
