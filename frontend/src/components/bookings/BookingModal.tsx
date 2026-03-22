import { useState, useEffect } from 'react';
import { format, parseISO, addMinutes } from 'date-fns';
import { Clock, User, Scissors, Phone, FileText, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { Modal, Button, Input, Select } from '../ui';
import { api } from '../../lib/api';
import type { Booking, Specialist, Service, TimeSlot } from '../../types';
import clsx from 'clsx';

interface Props {
  booking?: Booking | null;           // null = new booking
  prefillDate?: Date;
  prefillSpecialistId?: string;
  specialists: Specialist[];
  services: Service[];
  onClose: () => void;
  onSaved: () => void;
}

type Mode = 'view' | 'edit' | 'create';

export function BookingModal({ booking, prefillDate, prefillSpecialistId, specialists, services, onClose, onSaved }: Props) {
  const isNew = !booking;
  const [mode, setMode] = useState<Mode>(isNew ? 'create' : 'view');

  // Form state
  const [specialistId, setSpecialistId] = useState(
    booking?.specialistId ?? prefillSpecialistId ?? specialists[0]?.id ?? ''
  );
  const [serviceId, setServiceId] = useState(booking?.serviceId ?? services[0]?.id ?? '');
  const [customerName, setCustomerName] = useState(booking?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(booking?.customerPhone ?? '');
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [startsAt, setStartsAt] = useState(
    booking?.startsAt
      ? format(parseISO(booking.startsAt), "yyyy-MM-dd'T'HH:mm")
      : prefillDate
        ? format(prefillDate, "yyyy-MM-dd'T'HH:mm")
        : format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<TimeSlot[]>([]);

  const selectedService = services.find(s => s.id === serviceId);
  const selectedSpecialist = specialists.find(s => s.id === specialistId);

  const endsAt = selectedService
    ? format(addMinutes(new Date(startsAt), selectedService.durationMins), "yyyy-MM-dd'T'HH:mm")
    : startsAt;

  async function handleSave() {
    if (!customerName.trim()) { setError('Customer name is required'); return; }
    if (!specialistId || !serviceId) { setError('Please select a specialist and service'); return; }

    setSaving(true); setError(''); setSuggestions([]);
    try {
      if (isNew || mode === 'create') {
        await api.createBooking({ specialistId, serviceId, customerName, customerPhone, notes,
          startsAt: startsAt.replace('T', 'T').slice(0, 16) + ':00' });
      } else {
        await api.updateBooking(booking!.id, { specialistId, serviceId, customerName,
          customerPhone, notes, startsAt: startsAt + ':00' });
      }
      onSaved();
    } catch (e: any) {
      // Backend returns suggestions when slot is taken
      if (e.message === 'Slot not available') {
        const s = await api.suggestSlots(specialistId, startsAt + ':00', selectedService?.durationMins ?? 30);
        setSuggestions(s);
        setError('That slot is already taken. Choose one of the suggestions below:');
      } else {
        setError(e.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!booking) return;
    setSaving(true);
    try { await api.cancelBooking(booking.id); onSaved(); }
    catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(status: Booking['status']) {
    if (!booking) return;
    setSaving(true);
    try { await api.updateBooking(booking.id, { status }); onSaved(); }
    catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  const statusColors: Record<string, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled:  'bg-red-50 text-red-600 border-red-200',
    completed:  'bg-slate-100 text-slate-600 border-slate-200',
    no_show:    'bg-amber-50 text-amber-700 border-amber-200',
  };

  const title = isNew ? 'New booking'
    : mode === 'edit' ? 'Edit booking'
    : booking?.customerName ?? 'Booking';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">

        {/* View mode */}
        {mode === 'view' && booking && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium capitalize',
                statusColors[booking.status])}>
                {booking.status.replace('_', ' ')}
              </span>
            </div>

            <InfoRow icon={<User size={14} />} label="Customer">
              <span className="font-medium">{booking.customerName}</span>
              {booking.customerPhone && (
                <span className="text-slate-400 ml-1 text-xs">{booking.customerPhone}</span>
              )}
            </InfoRow>

            <InfoRow icon={<Scissors size={14} />} label="Service">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: booking.specialistColor }} />
                <span className="font-medium">{booking.serviceName}</span>
                <span className="text-slate-400 text-xs">· {booking.serviceDurationMins}min</span>
                <span className="text-slate-400 text-xs">· {(booking.servicePrice!/100).toFixed(0)} ALL</span>
              </div>
            </InfoRow>

            <InfoRow icon={<User size={14} />} label="Specialist">
              <span>{booking.specialistName}</span>
            </InfoRow>

            <InfoRow icon={<Clock size={14} />} label="Time">
              <span className="font-mono text-sm">
                {format(parseISO(booking.startsAt), 'EEE d MMM, HH:mm')}
                {' – '}
                {format(parseISO(booking.endsAt), 'HH:mm')}
              </span>
            </InfoRow>

            {booking.notes && (
              <InfoRow icon={<FileText size={14} />} label="Notes">
                <span className="text-slate-600 text-sm">{booking.notes}</span>
              </InfoRow>
            )}

            {booking.status === 'confirmed' && (
              <div className="flex gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => setMode('edit')}>Reschedule / Edit</Button>
                <Button variant="outline" size="sm" onClick={() => handleStatusChange('completed')}>
                  <CheckCircle size={13} /> Complete
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleStatusChange('no_show')}>
                  No-show
                </Button>
                <Button variant="danger" size="sm" onClick={handleCancel} disabled={saving}>
                  <XCircle size={13} /> Cancel
                </Button>
              </div>
            )}
          </>
        )}

        {/* Create / Edit mode */}
        {(mode === 'create' || mode === 'edit') && (
          <>
            <Select label="Specialist" value={specialistId} onChange={(e: any) => setSpecialistId(e.target.value)}>
              {specialists.map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}
            </Select>

            <Select label="Service" value={serviceId} onChange={(e: any) => setServiceId(e.target.value)}>
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMins}min · {(s.price/100).toFixed(0)} ALL)
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 text-sm">
                <label className="font-medium text-slate-700">Start time</label>
                <input type="datetime-local" value={startsAt}
                  onChange={e => setStartsAt(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <label className="font-medium text-slate-400">Ends at (auto)</label>
                <input type="datetime-local" value={endsAt} readOnly
                  className="rounded-lg border border-slate-100 px-3 py-2 text-sm bg-slate-50 text-slate-400" />
              </div>
            </div>

            <Input label="Customer name" value={customerName} placeholder="Full name"
              onChange={e => setCustomerName(e.target.value)} />
            <Input label="Phone (optional)" value={customerPhone} placeholder="+355 6X XXX XXXX"
              onChange={e => setCustomerPhone(e.target.value)} />
            <div className="flex flex-col gap-1 text-sm">
              <label className="font-medium text-slate-700">Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Slot suggestions when taken */}
            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-500">Available slots:</p>
                {suggestions.map(s => (
                  <button key={s.startsAt} onClick={() => {
                    setStartsAt(s.startsAt.slice(0, 16));
                    setSuggestions([]); setError('');
                  }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-brand-200 bg-brand-50 text-sm text-brand-700 hover:bg-brand-100 transition-colors font-mono">
                    {format(parseISO(s.startsAt), 'EEE d MMM, HH:mm')} – {format(parseISO(s.endsAt), 'HH:mm')}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1 border-t">
              {mode === 'edit' && (
                <Button variant="ghost" size="sm" onClick={() => setMode('view')}>Back</Button>
              )}
              <Button onClick={handleSave} disabled={saving} className="ml-auto">
                {saving ? 'Saving…' : isNew ? 'Book appointment' : 'Save changes'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-slate-400">{label}</span>
        <div className="text-sm text-slate-800">{children}</div>
      </div>
    </div>
  );
}
