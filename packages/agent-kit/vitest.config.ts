import { defineConfig } from 'vitest/config';

// 纯函数 / SSE 协议解析测试，node 环境即可（无 DOM 依赖）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
