import type { Metadata } from 'next';
import { Inter, Playfair_Display, Noto_Serif_SC } from 'next/font/google';
import './globals.css';
import BlogHeader from './components/BlogHeader';
import ClientLayout from './components/ClientLayout';
import FloatingThemeToggle from './components/FloatingThemeToggle';
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
  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* 主题初始化脚本 - 防止 FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${playfair.variable} ${notoSerifSC.variable} bg-background text-foreground antialiased`} suppressHydrationWarning>
        <Providers>
          <BlogHeader />
          <ClientLayout>
            {children}
          </ClientLayout>
          {/* V3 移动端极简主题悬浮层，提供满帧光圈特效 */}
          <FloatingThemeToggle />
        </Providers>
      </body>
    </html>
  );
}
