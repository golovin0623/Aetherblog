import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 统一使用 /admin/ 作为 base，确保网关模式下路由正常工作
  base: '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true, // 允许外部访问 (开发网关模式需要)
    strictPort: true,
    allowedHosts: true, // 允许所有主机访问 (Vite 6.x 安全要求)
    // HMR 配置: 通过网关访问时，WebSocket 直连本机 5173
    hmr: {
      port: 5173,
      host: 'localhost',
    },
    proxy: {
      '/api/v1/admin/providers': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // AI 服务流式端点 - 直接路由到 AI 服务
      '/api/v1/ai': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // 禁用代理缓冲以支持流式响应
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 禁用 Nginx 缓冲（如果有的话）
            proxyRes.headers['x-accel-buffering'] = 'no';
            proxyRes.headers['cache-control'] = 'no-cache';
          });
        },
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8080/api',
        changeOrigin: true,
      },
    },
  },
}));
