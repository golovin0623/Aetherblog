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
      { protocol: 'https', hostname: 'github.com' },
      // 安全性（VULN-083）：社交平台图标源（socialLinks.ts 的 PLATFORM_ICON_URLS
      // 全部指向此域）。保持此处白名单与 PLATFORM_ICON_URLS 的域名同步。
      { protocol: 'https', hostname: 'api.iconify.design' },
      // 本地开发 — 仅 DEV：localhost 条目在生产构建时会被排除
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
    // 安全性（VULN-091）：在 Next.js 层设置一组基线安全 header，
    // 这样即使绕过网关直连 Next.js（例如 127.0.0.1:7893）也能获得
    // 相同的最低保护。Nginx 会在边缘加更严的 CSP/HSTS——这里不重复，
    // 只下发互不重叠的基础项。
    const baselineSecurityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // microphone=(self)：对话空间语音消息（MediaRecorder）需要同源麦克风；
      // 保持第三方 iframe 不可用（self 仅放行本站顶层文档）。
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=()' },
      // 现代浏览器已禁用 X-XSS-Protection —— 显式设为 0，
      // 避免触发可能被滥用的旧版 XSS 审计器。
      { key: 'X-XSS-Protection', value: '0' },
    ];

    return [
      {
        source: '/:path*',
        headers: baselineSecurityHeaders,
      },
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
