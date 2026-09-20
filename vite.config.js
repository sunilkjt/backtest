import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves from /backtest/ — keep all asset paths relative to base.
export default defineConfig({
  base: '/backtest/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
