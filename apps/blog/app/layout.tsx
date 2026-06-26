import type { Metadata, Viewport } from 'next';
import { preconnect, preload } from 'react-dom';
import './globals.css';
import BlogHeader from './components/BlogHeader';
import ClientLayout from './components/ClientLayout';
import FloatingThemeToggle from './components/FloatingThemeToggle';
import FontProvider from './components/FontProvider';
import SiteSettingsProvider from './components/SiteSettingsProvider';
import SiteAssetPreloader from './components/SiteAssetPreloader';
import AnalyticsScripts from './components/AnalyticsScripts';
import Providers from './providers';
import { getSiteSettings } from './lib/services';
import { sanitizeImageUrl } from './lib/sanitizeUrl';
import { getPreferredSiteIconUrl } from '@aetherblog/utils';
import {
  themeInitScript,
  themeFoucGuardStyle,
  THEME_LIGHT_BG,
  THEME_DARK_BG,
} from '@aetherblog/hooks';

const AUTHOR_AVATAR_FALLBACK =
  'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp&s=200';

function getPreconnectOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

// Next 13.3+ 推荐的 viewport 配置对象 —— themeColor 让移动端浏览器顶栏
// 跟主题走,避免暗黑模式下 URL bar 显示白色。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_LIGHT_BG },
    { media: '(prefers-color-scheme: dark)', color: THEME_DARK_BG },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const iconUrl = getPreferredSiteIconUrl(settings);
  
  return {
    title: {
      default: settings.siteTitle || 'AetherBlog',
      template: `%s | ${settings.siteTitle || 'AetherBlog'}`,
    },
    description: settings.siteDescription || 'AetherBlog - 智能博客系统',
    keywords: settings.siteKeywords?.split(/[,，]/).map(k => k.trim()) || ['blog', 'tech', 'ai'],
    authors: [{ name: settings.authorName || 'Admin' }],
    metadataBase: new URL(settings.siteUrl || 'http://localhost:3000'),
    ...(iconUrl ? {
      icons: {
        icon: iconUrl,
        shortcut: iconUrl,
        apple: iconUrl,
      },
    } : {}),
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: settings.siteTitle || 'AetherBlog',
    },
    formatDetection: {
      telephone: false,
    },
    other: {
      'apple-mobile-web-app-capable': 'yes',
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSiteSettings();
  const authorAvatarUrl = sanitizeImageUrl(
    settings.authorAvatar || settings.author_avatar || '',
    AUTHOR_AVATAR_FALLBACK,
  );
  const authorAvatarPreconnectOrigin = getPreconnectOrigin(authorAvatarUrl);
  const fontFamily = (settings.font_family as string) || 'system';
  // 服务端预计算字体覆盖类和样式，避免 FOUC（字体闪烁）
  const isCustomFont = fontFamily !== 'system';
  const fontCssMap: Record<string, string> = {
    'serif-elegant': "'Playfair Display', 'Noto Serif SC', Georgia, serif",
    'lora': "'Lora', 'Noto Serif SC', Georgia, serif",
    'merriweather': "'Merriweather', 'Noto Serif SC', Georgia, serif",
  };
  const fontOverrideStyle = isCustomFont && fontCssMap[fontFamily]
    ? { '--font-sans-override': fontCssMap[fontFamily] } as React.CSSProperties
    : undefined;

  if (authorAvatarUrl && !authorAvatarUrl.startsWith('data:')) {
    preload(authorAvatarUrl, { as: 'image', fetchPriority: 'high' });
  }
  if (authorAvatarPreconnectOrigin) {
    preconnect(authorAvatarPreconnectOrigin);
  }
  preconnect('https://api.iconify.design');

  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={isCustomFont ? 'font-override' : undefined}
      style={fontOverrideStyle}
    >
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        {/* FOUC Guard —— 保持在 body 最前面，早于主题初始化脚本和应用内容执行。
            viewport / PWA meta 由 Next metadata API 负责，避免 App Router 手写 head。
            可配置 Google Fonts 由 FontProvider 在客户端按当前设置动态加载。 */}
        <style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* SEO 统计脚本：按后台配置的百度 / Google Analytics ID 注入 */}
        <AnalyticsScripts
          baiduId={settings.baidu_analytics_id}
          googleId={settings.google_analytics_id}
        />
        <Providers>
          <SiteSettingsProvider settings={settings}>
            <SiteAssetPreloader settings={settings} />
            <FontProvider initialFont={fontFamily}>
              <BlogHeader />
              <ClientLayout>
                {children}
              </ClientLayout>
              {/* V3 移动端极简主题悬浮层，提供满帧光圈特效 */}
              <FloatingThemeToggle />
            </FontProvider>
          </SiteSettingsProvider>
        </Providers>
      </body>
    </html>
  );
}
