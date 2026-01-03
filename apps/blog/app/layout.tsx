import type { Metadata } from 'next';
import './globals.css';
import BlogHeader from './components/BlogHeader';
import ClientLayout from './components/ClientLayout';

export const metadata: Metadata = {
  title: 'AetherBlog',
  description: 'AetherBlog - 智能博客系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-white antialiased" suppressHydrationWarning>
        <BlogHeader />
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
