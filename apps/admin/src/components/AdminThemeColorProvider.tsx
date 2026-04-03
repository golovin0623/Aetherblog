import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import { generateColorVars, colorVarsToCSS } from '@aetherblog/utils';

const STYLE_ID = 'aetherblog-admin-primary-color';

/**
 * AdminThemeColorProvider
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

  useEffect(() => {
    const lightVal = lightColor || fallbackColor;
    const darkVal = darkColor || fallbackColor;

    if (!lightVal && !darkVal) {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
      return;
    }

    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    let css = '';

    if (lightVal) {
      const vars = generateColorVars(lightVal, false);
      css += `:root, :root.light {\n${colorVarsToCSS(vars)}\n}\n`;
    }

    if (darkVal) {
      const vars = generateColorVars(darkVal, true);
      css += `:root.dark {\n${colorVarsToCSS(vars)}\n}\n`;
    }

    styleEl.textContent = css;

    return () => {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
    };
  }, [lightColor, darkColor, fallbackColor]);

  return <>{children}</>;
}
