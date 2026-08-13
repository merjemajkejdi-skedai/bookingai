import { useEffect, useState } from 'react';

const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

export function MicrosoftOAuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDesc = params.get('error_description');

    if (error) {
      const msg = errorDesc ?? error;
      setStatus('error');
      setDetail(msg);
      window.opener?.postMessage({ type: 'MICROSOFT_OAUTH_ERROR', error: msg }, '*');
      setTimeout(() => window.close(), 2000);
      return;
    }

    if (!code || !state) {
      const msg = 'Missing code or state in callback URL';
      setStatus('error');
      setDetail(msg);
      window.opener?.postMessage({ type: 'MICROSOFT_OAUTH_ERROR', error: msg }, '*');
      setTimeout(() => window.close(), 2000);
      return;
    }

    fetch(`${BASE}/hotel/email/oauth/microsoft/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then(r => r.json())
      .then((data: any) => {
        if (data.email) {
          setStatus('success');
          setDetail(data.email);
          window.opener?.postMessage({ type: 'MICROSOFT_OAUTH_SUCCESS', email: data.email }, '*');
          setTimeout(() => window.close(), 800);
        } else {
          throw new Error(data.error ?? 'Exchange failed');
        }
      })
      .catch((e: Error) => {
        setStatus('error');
        setDetail(e.message);
        window.opener?.postMessage({ type: 'MICROSOFT_OAUTH_ERROR', error: e.message }, '*');
        setTimeout(() => window.close(), 2000);
      });
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', textAlign: 'center', marginTop: '4rem', color: '#334155' }}>
      {status === 'loading' && <p>Connecting Microsoft account…</p>}
      {status === 'success' && <p>Connected as <strong>{detail}</strong>. Closing…</p>}
      {status === 'error'   && <p style={{ color: '#dc2626' }}>Error: {detail}<br /><small>You can close this window.</small></p>}
    </div>
  );
}
