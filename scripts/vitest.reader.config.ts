import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    environment: 'node',
    include: [
      'scripts/reader-mobile-experience-gate.test.ts',
      'scripts/blog-tooltip-accessibility-gate.test.ts',
      'scripts/music-player-product-quality.test.ts',
      'scripts/music-player-semantics.test.ts',
      'scripts/music-public-surface-product-quality.test.ts',
      'scripts/profile-music-player-layout-gate.test.ts',
    ],
  },
});
