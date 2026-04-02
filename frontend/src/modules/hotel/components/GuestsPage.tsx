import { useState, useEffect } from 'react';
import { Plus, LogOut, UserCheck, Phone, CalendarDays } from 'lucide-react';
import { api } from '../api';
import type { GuestStay } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function nightsCount(checkIn: string, checkOut: string) {
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(diff / 86400000);
}

export function GuestsPage() {
  const [guests, setGuests]       = useState<GuestStay[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const [form, setForm] = useState({
    room_number: '',
    guest_name: '',
    guest_phone: '',
    check_in: new Date().toISOString().slice(0, 10),
    check_out: '',
  });

  function load() {
    setLoading(true);
    api.getGuests().then(setGuests).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault();
    await api.checkIn(form);
    setShowAdd(false);
    setForm({ room_number: '', guest_name: '', guest_phone: '', check_in: new Date().toISOString().slice(0, 10), check_out: '' });
    load();
  }

  async function handleCheckOut(id: string) {
    setCheckingOut(id);
    try {
      await api.checkOut(id);
      setGuests(g => g.filter(x => x.id !== id));
    } finally {
      setCheckingOut(null);
    }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Current Guests</h1>
          <p className="text-xs text-slate-400">{guests.length} checked in</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Check In Guest
        </Button>
      </div>

      {/* Guest list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : guests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <UserCheck size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No guests currently checked in</p>
          </div>
        ) : (
          <div className="space-y-2">
            {guests.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })).map(g => (
              <div key={g.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
                {/* Room badge */}
                <div className="w-12 h-12 rounded-xl bg-brand-50 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-medium text-brand-400 uppercase tracking-wide">Room</span>
                  <span className="text-sm font-bold text-brand-700">{g.room_number}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{g.guest_name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Phone size={10} /> {g.guest_phone.replace('whatsapp:', '')}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <CalendarDays size={10} />
                      {formatDate(g.check_in)} → {formatDate(g.check_out)}
                      <span className="text-slate-300">·</span>
                      {nightsCount(g.check_in, g.check_out)}n
                    </span>
                  </div>
                </div>

                {/* Check out */}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checkingOut === g.id}
                  onClick={() => handleCheckOut(g.id)}
                  className="flex-shrink-0 text-xs"
                >
                  <LogOut size={12} />
                  {checkingOut === g.id ? 'Checking out…' : 'Check Out'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Check-in modal */}
      {showAdd && (
        <Modal title="Check In Guest" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCheckIn} className="space-y-4">
            <Input
              label="Room Number"
              placeholder="e.g. 204"
              value={form.room_number}
              onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))}
              required
            />
            <Input
              label="Guest Name"
              placeholder="Full name"
              value={form.guest_name}
              onChange={e => setForm(f => ({ ...f, guest_name: e.target.value }))}
              required
            />
            <Input
              label="WhatsApp Phone"
              placeholder="+355691234567"
              value={form.guest_phone}
              onChange={e => setForm(f => ({ ...f, guest_phone: e.target.value }))}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Check In"
                type="date"
                value={form.check_in}
                onChange={e => setForm(f => ({ ...f, check_in: e.target.value }))}
                required
              />
              <Input
                label="Check Out"
                type="date"
                value={form.check_out}
                onChange={e => setForm(f => ({ ...f, check_out: e.target.value }))}
                required
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">Check In</Button>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
