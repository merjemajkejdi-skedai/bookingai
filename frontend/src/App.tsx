import { useState } from 'react';
import { isAuthenticated, getStoredUser } from './shared/lib/auth';
import { LoginPage } from './pages/LoginPage';
import { BookingModule } from './modules/booking';
import { ArtEventModule } from './modules/art_event';
import { ArtClassModule } from './modules/art_class';

type ShopMode = 'booking' | 'art_event' | 'art_class';

function getShopMode(type: string): ShopMode {
  const t = type.toLowerCase();
  if (t === 'art_class') return 'art_class';
  if (t === 'art_event') return 'art_event';
  return 'booking';
}
export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  const user = getStoredUser();
  const mode = getShopMode(user?.tenant?.type ?? '');
  const handleLogout = () => setAuthed(false);

  if (mode === 'art_class')  return <ArtClassModule  onLogout={handleLogout} />;
  if (mode === 'art_event')  return <ArtEventModule   onLogout={handleLogout} />;
  return                             <BookingModule    onLogout={handleLogout} />;
}
