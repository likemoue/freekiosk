import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/media': API,
      '/player': API,
      '/dpc-apk-download': API,
      '/usb-tool-download': API,
    },
  },
  build: { chunkSizeWarningLimit: 900 },
});
