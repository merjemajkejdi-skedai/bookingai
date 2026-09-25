import { useState, useEffect, type ReactNode } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { airbnbApi } from '../api';
import type { AirbnbListing } from '../types';

// Tenant-wide settings — anything that isn't specific to one listing lives
// here as another <Section>, rather than getting its own ad-hoc screen.
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 select-all">{value}</code>
      <button onClick={copy} title="Copy"
        className="flex-shrink-0 p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
        {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
      </button>
    </div>
  );
}

export function AirbnbSettingsPage() {
  const [sharedEmail, setSharedEmail] = useState<string | null>(null);
  const [listings, setListings] = useState<AirbnbListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      airbnbApi.getForwarding().then(r => setSharedEmail(r.shared_email)).catch(() => {}),
      airbnbApi.getListings().then(setListings).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  const sharingCount = listings.filter(l => l.use_shared_forward_email).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Settings</h2>

      <div className="space-y-4 max-w-2xl">
        <Section
          title="Shared confirmation forwarding address"
          description="One address for all your listings. Forward your Airbnb and Booking.com confirmation, cancellation and change emails here instead of to each listing's own address."
        >
          {sharedEmail
            ? <CopyableValue value={sharedEmail} />
            : <p className="text-sm text-slate-400">Address unavailable right now — try reloading.</p>}
          <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
            <li>Emails sent here are matched to a listing by the listing's name appearing in the email, so make sure each listing's name matches how it appears on Airbnb / Booking.com.</li>
            <li>Only listings set to "use the shared forwarding address" (on the Listings tab) are matched. Emails that can't be matched to exactly one listing are held on the Reservations tab for review.</li>
            <li>Forwarding is optional — you can add reservations manually instead.</li>
          </ul>
          <p className="text-xs text-slate-400">
            {sharingCount === 0
              ? 'No listings are using this address yet.'
              : `${sharingCount} of ${listings.length} listing${listings.length !== 1 ? 's' : ''} use${sharingCount === 1 ? 's' : ''} this address.`}
          </p>
        </Section>
      </div>
    </div>
  );
}
