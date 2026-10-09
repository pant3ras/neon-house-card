import { defineConfig } from 'vite';

// `npm run dev` serves index.html (the preview with a fake hass);
// `npm run build` writes one self-contained ES module for Home Assistant.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/card.ts',
      formats: ['es'],
      fileName: () => 'neon-house-card.js',
    },
    outDir: 'dist',
    target: 'es2022',
    emptyOutDir: true,
  },
  server: { port: 4170, host: '127.0.0.1', strictPort: true },
});
