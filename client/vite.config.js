import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0]),
  },
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
      // Capacitor plugins are mobile-only — exclude from web build
      external: [
        /^@capacitor\//,
        /^@capacitor-community\//,
      ],
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
