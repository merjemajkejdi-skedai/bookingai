import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Ban, ChevronDown, ChevronUp, X, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { airbnbApi } from '../api';
import type { AirbnbReservation, AirbnbListing, AirbnbEmailReview } from '../types';
import { AddReservationModal } from './AddReservationModal';

const REASON_LABELS: Record<string, string> = {
  unknown_platform: "Couldn't tell if it was Airbnb or Booking.com",
  unknown_email_type: "Couldn't tell if it was a confirmation, change or cancellation",
  multiple_bookings_ambiguous: "Contained several bookings and none clearly matched this listing",
  missing_identifiers: 'No reservation code or guest name/date found',
  no_cancellation_target: 'Cancellation for a reservation we have no record of',
  no_change_target: 'Change for a reservation we have no record of',
  shared_no_listing_match: "Sent to your shared address, but no listing's name or address was found in it",
  shared_multiple_listings: 'Sent to your shared address and mentioned more than one listing',
};

function reasonLabel(r?: string | null) {
  if (!r) return 'Unknown';
  if (r.startsWith('missing_fields')) return `Missing: ${r.split(':')[1] || 'required fields'}`;
  return REASON_LABELS[r] ?? r;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function AirbnbReservationsPage() {
  const [listings, setListings] = useState<AirbnbListing[]>([]);
  const [listingFilter, setListingFilter] = useState('');
  const [scope, setScope] = useState<'upcoming' | 'all'>('upcoming');
  const [rows, setRows] = useState<AirbnbReservation[]>([]);
  const [review, setReview] = useState<AirbnbEmailReview[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { airbnbApi.getListings().then(setListings).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const [res, rev] = await Promise.all([
        airbnbApi.getReservations({ listingId: listingFilter || undefined, scope }),
        airbnbApi.getEmailReview(),
      ]);
      setRows(res);
      setReview(rev);
    } catch { /* silent */ }
  }, [listingFilter, scope]);

  useEffect(() => {
    load().then(() => setLoading(false));
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, [load]);

  async function toggleDoNotSend(r: AirbnbReservation) {
    try { await airbnbApi.setReservationDoNotSend(r.id, !r.do_not_send); await load(); }
    catch (e: any) { alert(e.message); }
  }

  async function removeManual(r: AirbnbReservation) {
    if (!confirm(`Delete the reservation for ${r.guest_name}?`)) return;
    try { await airbnbApi.deleteReservation(r.id); await load(); }
    catch (e: any) { alert(e.message); }
  }

  async function dismiss(id: string) {
    try { await airbnbApi.dismissEmailReview(id); await load(); }
    catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Reservations</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={listingFilter} onChange={e => setListingFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
            <option value="">All listings</option>
            {listings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex gap-1">
            {(['upcoming', 'all'] as const).map(s => (
              <button key={s} onClick={() => setScope(s)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  scope === s ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
                {s === 'upcoming' ? 'Upcoming' : 'All'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(true)} disabled={listings.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
            <Plus size={13} /> Add reservation
          </button>
        </div>
      </div>

      {review.length > 0 && (
        <div className="mb-4 border border-amber-200 bg-amber-50 rounded-xl">
          <button onClick={() => setShowReview(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-left">
            <span className="text-xs font-semibold text-amber-700">
              {review.length} forwarded email{review.length !== 1 ? 's' : ''} need{review.length === 1 ? 's' : ''} a look
            </span>
            {showReview ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
          </button>
          {showReview && (
            <div className="px-3 pb-3 space-y-2">
              {review.map(r => (
                <div key={r.id} className="bg-white rounded-lg border border-amber-100 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{r.subject || '(no subject)'}</p>
                      <p className="text-xs text-amber-700">{reasonLabel(r.reason)} · {r.listing_name || 'unknown listing'}</p>
                    </div>
                    <button onClick={() => dismiss(r.id)} className="p-1 text-slate-400 hover:text-slate-700 flex-shrink-0" title="Dismiss">
                      <X size={14} />
                    </button>
                  </div>
                  {r.body_excerpt && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500 bg-slate-50 rounded p-2">{r.body_excerpt}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">
            No reservations yet. Forward your Airbnb / Booking.com confirmation emails to the address shown on each listing.
          </p>
        )}
        {rows.map(r => (
          <div key={r.id} className={clsx('bg-white rounded-xl border border-slate-200 p-4', r.status === 'cancelled' && 'opacity-60')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-medium text-slate-800">{r.guest_name}</p>
                  <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{r.listing_name}</span>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{r.platform === 'airbnb' ? 'Airbnb' : r.platform === 'booking' ? 'Booking.com' : 'Manual'}</span>
                  {r.status === 'cancelled' && <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Cancelled</span>}
                </div>
                <p className="text-xs text-slate-500">
                  {fmtDate(r.checkin_date)} → {fmtDate(r.checkout_date)}
                  {r.guest_count ? ` · ${r.guest_count} guest${r.guest_count !== 1 ? 's' : ''}` : ''}
                  {r.reservation_code ? ` · ${r.reservation_code}` : ''}
                </p>
                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  {r.checkin_instructions_sent
                    ? <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /> Instructions sent</span>
                    : <span className="text-slate-400">Instructions not sent</span>}
                  {r.do_not_send && <span className="flex items-center gap-1 text-amber-600"><Ban size={13} /> Held</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {r.status === 'confirmed' && (
                  <button onClick={() => toggleDoNotSend(r)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                    {r.do_not_send ? 'Allow sending' : "Don't send instructions"}
                  </button>
                )}
                {r.source === 'manual' && (
                  <button onClick={() => removeManual(r)} title="Delete manual reservation"
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddReservationModal
          listings={listings}
          defaultListingId={listingFilter || undefined}
          onClose={() => setShowAdd(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
