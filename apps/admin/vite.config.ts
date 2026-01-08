import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 开发环境使用根路径，生产环境使用 /admin/
  base: command === 'serve' ? '/' : '/admin/',
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
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
}));
