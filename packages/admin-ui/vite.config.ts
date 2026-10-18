import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// In dev, the SPA runs on Vite and proxies API/auth calls to the core admin listener (:8081).
const adminTarget = process.env.ADMIN_API_URL ?? 'http://127.0.0.1:8081';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': adminTarget,
      '/auth': adminTarget,
    },
  },
});
