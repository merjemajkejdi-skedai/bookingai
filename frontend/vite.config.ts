import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Treat unused variables as warnings not errors for production build
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
        warn(warning);
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api':               { target: 'http://localhost:3001', changeOrigin: true },
      '/auth':              { target: 'http://localhost:3001', changeOrigin: true },
      '/admin':             { target: 'http://localhost:3001', changeOrigin: true },
      '/hotel':             { target: 'http://localhost:3001', changeOrigin: true },
      '/whatsapp':          { target: 'http://localhost:3001', changeOrigin: true },
      '/health':            { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads':           { target: 'http://localhost:3001', changeOrigin: true },
      // Shop API paths — specific sub-paths so /shop/:slug browser nav still serves index.html
      '/shop/public':       { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/config':       { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/orders':       { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/categories':   { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/items':        { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/faq':          { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/conversations': { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/reports':      { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/analytics':    { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/auth':         { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/users':        { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/audit-log':    { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/tables':       { target: 'http://localhost:3001', changeOrigin: true },
      '/shop/fiscal':       { target: 'http://localhost:3001', changeOrigin: true },
    }
  }
})
