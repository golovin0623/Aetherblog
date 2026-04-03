import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';

/**
 * 字体配置映射（与 FontPickerModal 保持同步）
 * 仅包含 CSS font-family 和 Google Fonts URL
 */
const FONT_MAP: Record<string, { cssFamily: string; googleFontsUrl?: string }> = {
  system: {
    cssFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  'serif-elegant': {
    cssFamily: "'Playfair Display', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
  lora: {
    cssFamily: "'Lora', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
  merriweather: {
    cssFamily: "'Merriweather', 'Noto Serif SC', Georgia, serif",
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap',
  },
};

function loadGoogleFont(url: string) {
  const existing = document.querySelector(`link[href="${url}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

/**
 * AdminFontProvider - 管理后台全局字体应用
 * 从后端获取 font_family 设置，动态应用到 admin 界面
 */
export default function AdminFontProvider({ children }: { children: React.ReactNode }) {
  // 复用 ['settings'] 缓存，通过 select 提取 font_family
  // 这样 SettingsPage 保存后 invalidate(['settings']) 会自动刷新字体
  const { data: fontId = 'system' } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
    select: (all) => (all.font_family as string) || 'system',
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const config = FONT_MAP[fontId] || FONT_MAP.system;

    if (config.googleFontsUrl) {
      loadGoogleFont(config.googleFontsUrl);
    }

    if (fontId !== 'system') {
      document.body.style.fontFamily = config.cssFamily;
    } else {
      document.body.style.fontFamily = '';
    }

    return () => {
      document.body.style.fontFamily = '';
    };
  }, [fontId]);

  return <>{children}</>;
}
