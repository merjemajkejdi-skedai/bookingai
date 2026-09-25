import { useState } from 'react';
import { Modal } from '../../../components/ui';
import { airbnbApi } from '../api';
import type { AirbnbListing } from '../types';

interface Props {
  listings: AirbnbListing[];
  defaultListingId?: string;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300';

export function AddReservationModal({ listings, defaultListingId, onClose, onSaved }: Props) {
  const [listingId, setListingId] = useState(defaultListingId || listings[0]?.id || '');
  const [guestName, setGuestName] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const count = Number(guestCount);
  const valid =
    !!listingId && guestName.trim().length > 0 &&
    Number.isInteger(count) && count >= 1 &&
    !!checkin && !!checkout && checkout > checkin;

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await airbnbApi.createReservation({
        listing_id: listingId,
        guest_name: guestName.trim(),
        guest_count: count,
        checkin_date: checkin,
        checkout_date: checkout,
        guest_phone: phone.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Add reservation" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs text-slate-600 space-y-1">
          <span className="font-medium">Listing</span>
          <select value={listingId} onChange={e => setListingId(e.target.value)} className={inputCls}>
            {listings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-slate-600 space-y-1">
          <span className="font-medium">Guest name</span>
          <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Full name as on the booking" className={inputCls} />
        </label>

        <label className="block text-xs text-slate-600 space-y-1">
          <span className="font-medium">Number of people</span>
          <input type="number" min={1} value={guestCount} onChange={e => setGuestCount(e.target.value)} className={inputCls} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-600 space-y-1">
            <span className="font-medium">Check-in</span>
            <input type="date" value={checkin} onChange={e => setCheckin(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs text-slate-600 space-y-1">
            <span className="font-medium">Check-out</span>
            <input type="date" value={checkout} min={checkin || undefined} onChange={e => setCheckout(e.target.value)} className={inputCls} />
          </label>
        </div>

        <label className="block text-xs text-slate-600 space-y-1">
          <span className="font-medium">WhatsApp number <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+355691234567" className={inputCls} />
          <span className="text-slate-400 block">
            Include the country code. If you enter it, only that number can receive this guest's check-in
            instructions — so make sure it's the number they'll message from.
          </span>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={!valid || saving}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40">
            {saving ? 'Saving…' : 'Add reservation'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
