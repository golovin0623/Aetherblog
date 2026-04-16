import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // 对大型包进行 Tree-shake，仅打包已使用的导出内容 — 可显著减少构建时间
    optimizePackageImports: ['shiki', 'lucide-react', 'framer-motion', 'mermaid', 'date-fns'],
    // 启用 Next.js 15 原生 View Transitions —— 文章卡片 → 文章页 morph
    // 协同 CSS `::view-transition-*` 规则 + 元素 `viewTransitionName` 属性
    viewTransition: true,
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  images: {
    remotePatterns: [
      // 可信的头像/CDN 域名
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: '*.githubusercontent.com' },
      { protocol: 'https', hostname: '*.gravatar.com' },
      { protocol: 'https', hostname: 'cravatar.cn' },
      { protocol: 'https', hostname: 'data.golovin.cn' },
      { protocol: 'https', hostname: 'github.com' },
      // 本地开发 — DEV ONLY: localhost entries are excluded in production builds
      ...(process.env.NODE_ENV === 'development' ? [
        { protocol: 'http' as const, hostname: 'localhost' },
        { protocol: 'http' as const, hostname: '127.0.0.1' },
      ] : []),
      // 生产环境: 通过环境变量添加额外可信域名 (不设置则仅允许上述白名单)
      ...(process.env.NEXT_PUBLIC_IMAGE_DOMAINS
        ? process.env.NEXT_PUBLIC_IMAGE_DOMAINS.split(',').map(h => ({
            protocol: 'https' as const,
            hostname: h.trim(),
          }))
        : []),
    ],
  },
  // 代理后端 API 请求，防止跨域问题
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:8080'}/api/:path*`,
      },
      // 静态资源代理 (后端 context-path 是 /api，但上传逻辑可能返回 /uploads/...)
      {
        source: '/uploads/:path*',
        destination: `${process.env.API_URL || 'http://localhost:8080'}/api/uploads/:path*`,
      },
    ];
  },
  serverExternalPackages: ['katex'],
  // iOS PWA (standalone) 模式下 WKWebView 会激进缓存 HTML，
  // 导致发版后样式/字体更新延迟。对页面路由设置 no-cache，
  // 让客户端每次导航都向服务器验证缓存是否过期（304 复用仍然生效）。
  // _next/static 等静态资源不受影响，保持 Next.js 默认的不可变缓存。
  async headers() {
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/posts/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/timeline',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/archives',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/friends',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/about',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
