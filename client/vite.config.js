import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Allow self-signed certificate on backend
    proxy: {
      '/api': {
        target: 'https://localhost:5000',
        changeOrigin: true,
        secure: false, // Accept self-signed SSL
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Increase chunk size warning limit for large apps
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          socket: ['socket.io-client'],
          ui: ['lucide-react', 'react-hot-toast'],
        },
      },
    },
  },
  // Base path: '/' for web/Electron, might need adjustment for Capacitor
  base: './',
});
