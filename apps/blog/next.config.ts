import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      // 可信的头像/CDN 域名
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: '*.githubusercontent.com' },
      { protocol: 'https', hostname: '*.gravatar.com' },
      { protocol: 'https', hostname: 'cravatar.cn' },
      { protocol: 'https', hostname: 'github.com' },
      // 本地开发
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
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
};

export default nextConfig;
