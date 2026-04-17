import type { Metadata } from 'next';
import { Inter, Playfair_Display, Noto_Serif_SC } from 'next/font/google';
import './globals.css';
import BlogHeader from './components/BlogHeader';
import ClientLayout from './components/ClientLayout';
import FloatingThemeToggle from './components/FloatingThemeToggle';
import FontProvider from './components/FontProvider';
import SiteFooter from './components/SiteFooter';
import SiteSettingsProvider from './components/SiteSettingsProvider';
import Providers from './providers';
import { getSiteSettings } from './lib/services';
import { themeInitScript } from '@aetherblog/hooks';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const playfair = Playfair_Display({ subsets: ['latin'], display: 'swap', variable: '--font-playfair', weight: ['400', '700'] });
const notoSerifSC = Noto_Serif_SC({ display: 'swap', variable: '--font-noto-serif-sc', weight: ['400', '700'], preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const avatarUrl = settings.authorAvatar || settings.author_avatar;
  
  return {
    title: {
      default: settings.siteTitle || 'AetherBlog',
      template: `%s | ${settings.siteTitle || 'AetherBlog'}`,
    },
    description: settings.siteDescription || 'AetherBlog - 智能博客系统',
    keywords: settings.siteKeywords?.split(/[,，]/).map(k => k.trim()) || ['blog', 'tech', 'ai'],
    authors: [{ name: settings.authorName || 'Admin' }],
    metadataBase: new URL(settings.siteUrl || 'http://localhost:3000'),
    ...(avatarUrl ? {
      icons: {
        icon: avatarUrl,
        apple: avatarUrl,
      },
    } : {}),
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: settings.siteTitle || 'AetherBlog',
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSiteSettings();
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

  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={isCustomFont ? 'font-override' : undefined}
      style={fontOverrideStyle}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* 主题初始化脚本 - 防止 FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* 非系统字体预加载 Google Fonts 样式表 */}
        {isCustomFont && fontFamily === 'lora' && (
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap" />
        )}
        {isCustomFont && fontFamily === 'merriweather' && (
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap" />
        )}
      </head>
      <body className={`${inter.variable} ${playfair.variable} ${notoSerifSC.variable} bg-background text-foreground antialiased`} suppressHydrationWarning>
        <Providers>
          <SiteSettingsProvider settings={settings}>
            <FontProvider initialFont={fontFamily}>
              <BlogHeader />
              <ClientLayout>
                {children}
              </ClientLayout>
              <SiteFooter />
              {/* V3 移动端极简主题悬浮层，提供满帧光圈特效 */}
              <FloatingThemeToggle />
            </FontProvider>
          </SiteSettingsProvider>
        </Providers>
      </body>
    </html>
  );
}
