import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages and Netlify.
  base: './',
  build: {
    chunkSizeWarningLimit: 1600, // Phaser is large
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
