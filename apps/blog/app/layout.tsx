import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import BlogHeader from './components/BlogHeader';
import ClientLayout from './components/ClientLayout';
import FloatingThemeToggle from './components/FloatingThemeToggle';
import Providers from './providers';
import { getSiteSettings } from './lib/services';
import { themeInitScript } from '@aetherblog/hooks';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

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
        {/* 主题初始化脚本 - 防止 FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} bg-background text-foreground antialiased`} suppressHydrationWarning>
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
