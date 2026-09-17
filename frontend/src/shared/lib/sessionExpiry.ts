// sessionExpiry.ts — shared 401 handling for every fetch helper in the app.
// Each module's api.ts (hotel, shop, generalBusiness, art_class, art_event,
// restaurant, booking, skedai, lib/api.ts) and shared/lib/auth.ts's
// authFetch/adminFetch all call this the moment they see a 401, instead of
// letting an expired/invalid token surface as a generic error that call
// sites can (and did) silently swallow into an empty list.
export function redirectToLoginOnSessionExpired(): void {
  console.warn('[Auth] Session expired or invalid — redirecting to login');
  localStorage.removeItem('bookingai_token');
  localStorage.removeItem('bookingai_user');
  localStorage.removeItem('bookingai_admin_tenant');
  localStorage.removeItem('shopUserToken');
  window.location.href = '/login?reason=session_expired';
}
