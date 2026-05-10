'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { SiteSettings } from '../lib/services';
import {
  colorVarsToCSS,
  generateColorVars,
  PRESET_DARK_PRIMARY,
  PRESET_LIGHT_PRIMARY,
  resolveThemeVisualPrimaryMode,
} from '@aetherblog/utils';

// ============================================================
// SiteSettingsProvider
// 将后台设置应用到博客前台，包括：
// - 强制暗黑模式 (enable_dark_mode)
// - 主色调 (theme_primary_color_light / theme_primary_color_dark)
// - 自定义 CSS (custom_css)
// - 每页文章数 (post_page_size)
// - 显示欢迎页 (show_banner / welcome_enabled)
// ============================================================

const PRIMARY_COLOR_STYLE_ID = 'aetherblog-primary-color';

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
    const lightColor = (settings.theme_primary_color_light as string) || '';
    const darkColor = (settings.theme_primary_color_dark as string) || '';
    const fallbackColor = (settings.theme_primary_color as string) || '';
    const lightVisualColor = (settings.theme_visual_color_light as string) || '';
    const darkVisualColor = (settings.theme_visual_color_dark as string) || '';
    const visualColorMode = resolveThemeVisualPrimaryMode({
      lightColor,
      darkColor,
      fallbackColor,
      lightVisualColor,
      darkVisualColor,
      visualPrimaryMode: (settings.theme_visual_color_mode as string) || '',
    });
    const root = document.documentElement;
    const removeDynamicStyle = () => {
      const el = document.getElementById(PRIMARY_COLOR_STYLE_ID);
      if (el) el.remove();
    };

    root.dataset.themeColorMode = visualColorMode;

    if (visualColorMode === 'preset') {
      removeDynamicStyle();
      return () => {
        delete root.dataset.themeColorMode;
        removeDynamicStyle();
      };
    }

    const lightVal = lightColor || fallbackColor || PRESET_LIGHT_PRIMARY;
    const darkVal = darkColor || fallbackColor || PRESET_DARK_PRIMARY;

    let styleEl = document.getElementById(PRIMARY_COLOR_STYLE_ID) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = PRIMARY_COLOR_STYLE_ID;
      document.head.appendChild(styleEl);
    }

    let css = '';
    if (lightVal) {
      const vars = generateColorVars(lightVal, false, {
        visualPrimaryMode: visualColorMode,
        visualPrimaryColor: lightVisualColor,
      });
      css += `:root, :root.light {\n${colorVarsToCSS(vars)}\n}\n`;
    }
    if (darkVal) {
      const vars = generateColorVars(darkVal, true, {
        visualPrimaryMode: visualColorMode,
        visualPrimaryColor: darkVisualColor,
      });
      css += `:root.dark {\n${colorVarsToCSS(vars)}\n}\n`;
    }
    styleEl.textContent = css;

    return () => {
      delete root.dataset.themeColorMode;
      removeDynamicStyle();
    };
  }, [
    settings.theme_primary_color,
    settings.theme_primary_color_light,
    settings.theme_primary_color_dark,
    settings.theme_visual_color_mode,
    settings.theme_visual_color_light,
    settings.theme_visual_color_dark,
  ]);

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
