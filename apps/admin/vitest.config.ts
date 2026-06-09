import { defineConfig } from 'vitest/config';
import path from 'path';

// 单元测试配置 —— 复用 vite 的 `@` 别名，纯函数测试用 node 环境即可
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
