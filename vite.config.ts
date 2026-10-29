import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages（https://geology-cat.github.io/astroweather/）で配信するため base をリポジトリ名に合わせる
export default defineConfig({
  base: '/astroweather/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
} as never);
