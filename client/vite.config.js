import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET = 'http://127.0.0.1:3001' } = loadEnv(mode, clientRoot, 'API_PROXY_');

  return {
    plugins: [react(), tailwindcss()],
    build: { assetsInlineLimit: 0 },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: { '/api': API_PROXY_TARGET },
    },
  };
});
