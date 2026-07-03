import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import {
  colorVarsToCSS,
  generateColorVars,
  PRESET_DARK_PRIMARY,
  PRESET_LIGHT_PRIMARY,
  resolveThemeVisualPrimaryMode,
} from '@aetherblog/utils';

const STYLE_ID = 'aetherblog-admin-primary-color';

/**
 * 管理主题颜色提供者
 * 读取设置中的主色调并动态覆盖 CSS 变量
 * 兼容旧字段 theme_primary_color 作为 fallback
 */
export default function AdminThemeColorProvider({ children }: { children: React.ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
    staleTime: 60 * 1000,
  });

  const lightColor = (settings?.theme_primary_color_light as string) || '';
  const darkColor = (settings?.theme_primary_color_dark as string) || '';
  const fallbackColor = (settings?.theme_primary_color as string) || '';
  const lightVisualColor = (settings?.theme_visual_color_light as string) || '';
  const darkVisualColor = (settings?.theme_visual_color_dark as string) || '';
  const visualColorMode = resolveThemeVisualPrimaryMode({
    lightColor,
    darkColor,
    fallbackColor,
    lightVisualColor,
    darkVisualColor,
    visualPrimaryMode: (settings?.theme_visual_color_mode as string) || '',
  });

  useEffect(() => {
    const root = document.documentElement;
    const removeDynamicStyle = () => {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
    };

    root.dataset.themeColorMode = visualColorMode;

    const lightVal = lightColor || fallbackColor || PRESET_LIGHT_PRIMARY;
    const darkVal = darkColor || fallbackColor || PRESET_DARK_PRIMARY;
    const hasThemeOverride = Boolean(
      lightColor ||
      darkColor ||
      fallbackColor ||
      lightVisualColor ||
      darkVisualColor ||
      visualColorMode !== 'preset',
    );

    if (!hasThemeOverride || visualColorMode === 'preset') {
      removeDynamicStyle();
      return () => {
        delete root.dataset.themeColorMode;
        removeDynamicStyle();
      };
    }

    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
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
  }, [lightColor, darkColor, fallbackColor, visualColorMode, lightVisualColor, darkVisualColor]);

  return <>{children}</>;
}
