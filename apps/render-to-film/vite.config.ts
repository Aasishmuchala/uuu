import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  cacheDir: '.build/vite-cache',
  build: { outDir: 'dist' },
});
