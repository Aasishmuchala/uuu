import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The Astryx kit is committed whole under public/astryx/ and served from the app's own
// address (ADR 0019 decision 10). Source imports the usual names; at build time each is
// left as an absolute import of the kit's file, so the page holds one React: the kit's.
const KIT: Record<string, string> = {
  react: '/astryx/react.js',
  'react-dom': '/astryx/react-dom.js',
  'react-dom/client': '/astryx/react-dom-client.js',
  'react/jsx-runtime': '/astryx/jsx-runtime.js',
  '@astryxdesign/core': '/astryx/core.js',
  '@astryxdesign/theme-neutral': '/astryx/theme-neutral.js',
};

const astryxKit: Plugin = {
  name: 'astryx-kit',
  enforce: 'pre',
  apply: 'build',
  resolveId(source) {
    return Object.hasOwn(KIT, source) ? { id: KIT[source], external: 'absolute' } : null;
  },
};

export default defineConfig({
  plugins: [astryxKit, react()],
  cacheDir: '.build/vite-cache',
  build: { outDir: 'dist' },
});
