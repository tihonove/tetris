import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works both at the root and under /tetris/ on GitHub Pages.
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as Parameters<typeof defineConfig>[0]);
