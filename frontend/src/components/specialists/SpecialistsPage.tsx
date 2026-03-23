import { useState } from 'react';
import { Plus, Pencil, Clock } from 'lucide-react';
import { Button, Modal, Input, Badge, Spinner } from '../ui';
import { api } from '../../lib/api';
import type { Specialist } from '../../types';
import clsx from 'clsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#ec4899','#3b82f6','#8b5cf6','#14b8a6'];

interface Props {
  specialists: Specialist[];
  loading: boolean;
  onRefresh: () => void;
  label?: string;
}

export function SpecialistsPage({ specialists, loading, onRefresh, label = 'Specialists' }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Specialist | null>(null);
  const [editingHours, setEditingHours] = useState<Specialist | null>(null);

  if (loading) return <Spinner />;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{label}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{specialists.length} team members</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus size={14} /> Add {label.slice(0, -1).toLowerCase()}</Button>
      </div>

      <div className="grid gap-3">
        {specialists.map(sp => (
          <div key={sp.id} className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
              style={{ background: sp.color }}>
              {sp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">{sp.name}</p>
              <p className="text-sm text-slate-400">{sp.role}</p>
            </div>
            {/* Working days summary */}
            <div className="hidden sm:flex gap-1">
              {DAYS.map((d, i) => {
                const wh = sp.workingHours?.find(h => h.dayOfWeek === i);
                return (
                  <span key={d} className={clsx(
                    'w-7 h-7 rounded-md text-xs flex items-center justify-center font-medium',
                    wh?.isWorking ? 'bg-brand-50 text-brand-600' : 'bg-slate-50 text-slate-300'
                  )}>
                    {d[0]}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingHours(sp)}>
                <Clock size={13} /> Hours
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(sp)}>
                <Pencil size={13} /> Edit
              </Button>
            </div>
          </div>
        ))}
        {specialists.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No {label.toLowerCase()} yet.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAdd(true)}>
              Add your first {label.slice(0, -1).toLowerCase()}
            </Button>
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {(showAdd || editing) && (
        <SpecialistForm
          specialist={editing}
          label={label}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => { setShowAdd(false); setEditing(null); onRefresh(); }}
        />
      )}

      {/* Working hours modal */}
      {editingHours && (
        <WorkingHoursModal
          specialist={editingHours}
          onClose={() => setEditingHours(null)}
          onSaved={() => { setEditingHours(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// --- Specialist form --------------------------------------------------------
function SpecialistForm({ specialist, label = 'Specialists', onClose, onSaved }: {
  specialist?: Specialist | null; label?: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(specialist?.name ?? '');
  const [role, setRole] = useState(specialist?.role ?? '');
  const [color, setColor] = useState(specialist?.color ?? COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      if (specialist) {
        await api.updateSpecialist(specialist.id, { name, role, color });
      } else {
        await api.createSpecialist({ name, role, color, tenantId: 'tenant-demo-001', isActive: true });
      }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={specialist ? `Edit ${label.slice(0, -1).toLowerCase()}` : `Add ${label.slice(0, -1).toLowerCase()}`} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Full name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gentian Hoxha" />
        <Input label="Role / title" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Senior Barber" />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Calendar color</span>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={clsx('w-8 h-8 rounded-full border-2 transition-transform',
                  color === c ? 'border-slate-700 scale-110' : 'border-transparent')}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Working hours modal ----------------------------------------------------
function WorkingHoursModal({ specialist, onClose, onSaved }: {
  specialist: Specialist; onClose: () => void; onSaved: () => void;
}) {
  const [hours, setHours] = useState(
    DAYS.map((_, i) => {
      const wh = specialist.workingHours?.find(h => h.dayOfWeek === i);
      return { dayOfWeek: i, startTime: wh?.startTime ?? '09:00', endTime: wh?.endTime ?? '19:00', isWorking: wh?.isWorking ?? (i > 0) };
    })
  );
  const [saving, setSaving] = useState(false);

  function toggle(i: number) {
    setHours(h => h.map((d, idx) => idx === i ? { ...d, isWorking: !d.isWorking } : d));
  }
  function setTime(i: number, field: 'startTime' | 'endTime', val: string) {
    setHours(h => h.map((d, idx) => idx === i ? { ...d, [field]: val } : d));
  }

  async function save() {
    setSaving(true);
    try { await api.updateWorkingHours(specialist.id, hours as any); onSaved(); }
    catch (e: any) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`${specialist.name} — Working hours`} onClose={onClose} wide>
      <div className="space-y-2">
        {hours.map((h, i) => (
          <div key={i} className={clsx(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors',
            h.isWorking ? 'bg-brand-50/60' : 'bg-slate-50'
          )}>
            <button onClick={() => toggle(i)}
              className={clsx('w-5 h-5 rounded flex-shrink-0 border-2 transition-colors flex items-center justify-center',
                h.isWorking ? 'bg-brand-500 border-brand-500' : 'border-slate-300'
              )}>
              {h.isWorking && <span className="text-white text-xs font-bold">✓</span>}
            </button>
            <span className={clsx('w-10 text-sm font-medium', h.isWorking ? 'text-slate-700' : 'text-slate-400')}>
              {DAYS[i]}
            </span>
            {h.isWorking ? (
              <div className="flex items-center gap-2 flex-1">
                <input type="time" value={h.startTime} onChange={e => setTime(i, 'startTime', e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
                <span className="text-slate-400 text-sm">–</span>
                <input type="time" value={h.endTime} onChange={e => setTime(i, 'endTime', e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
              </div>
            ) : (
              <span className="text-sm text-slate-400 flex-1">Day off</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save hours'}</Button>
      </div>
    </Modal>
  );
}
