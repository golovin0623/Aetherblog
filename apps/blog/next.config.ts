import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Docker 部署需要 (独立输出)
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
      // 生产环境: 通过环境变量添加额外可信域名
      ...(process.env.NEXT_PUBLIC_IMAGE_DOMAINS
        ? process.env.NEXT_PUBLIC_IMAGE_DOMAINS.split(',').map(h => ({
            protocol: 'https' as const,
            hostname: h.trim(),
          }))
        : [{ protocol: 'http' as const, hostname: '**' }, { protocol: 'https' as const, hostname: '**' }]),
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:8080'}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${process.env.API_URL || 'http://localhost:8080'}/api/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
