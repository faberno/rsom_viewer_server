import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'pages' ? false : 'public',
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist', rollupOptions: { output: { manualChunks: { three: ['three'] } } } }
}));
