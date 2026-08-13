if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ShopOrderPage } from './pages/ShopOrderPage.tsx'
import { MicrosoftOAuthCallbackPage } from './pages/MicrosoftOAuthCallbackPage.tsx'
import './index.css'

const { pathname, search } = window.location

// Microsoft OAuth redirect — must be intercepted before the admin app renders
const isMsOAuthCallback =
  pathname === '/settings/email/oauth/callback' &&
  (new URLSearchParams(search).has('code') || new URLSearchParams(search).has('error'))

// Public QR ordering pages: /shop/:slug or /shop/:slug/table/:tableId
const shopMatch = pathname.match(/^\/shop\/([^/]+)(?:\/table\/([^/]+))?$/)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isMsOAuthCallback
      ? <MicrosoftOAuthCallbackPage />
      : shopMatch
        ? <ShopOrderPage slug={shopMatch[1]} tableId={shopMatch[2]} />
        : <App />}
  </React.StrictMode>,
)
