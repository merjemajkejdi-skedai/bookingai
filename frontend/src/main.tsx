if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ShopOrderPage } from './pages/ShopOrderPage.tsx'
import './index.css'

// Public QR ordering pages: /shop/:slug or /shop/:slug/table/:tableId
const shopMatch = window.location.pathname.match(/^\/shop\/([^/]+)(?:\/table\/([^/]+))?$/)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {shopMatch
      ? <ShopOrderPage slug={shopMatch[1]} tableId={shopMatch[2]} />
      : <App />}
  </React.StrictMode>,
)
