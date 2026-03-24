import { useState } from 'react';
import { Plus, Pencil, Trash2, FolderPlus, Tag } from 'lucide-react';
import { Button, Modal, Input, Spinner } from '../ui';
import { api } from '../api';
import type { Service, ServiceGroup } from '../types';
import clsx from 'clsx';

const COLORS = ['#6366f1','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#3b82f6','#14b8a6'];

interface Props {
  services: Service[];
  loading: boolean;
  onRefresh: () => void;
  isSalon?: boolean;
  serviceGroups?: ServiceGroup[];
  onGroupsRefresh?: () => void;
}

export function ServicesPage({ services, loading, onRefresh, isSalon, serviceGroups = [], onGroupsRefresh }: Props) {
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);

  if (loading) return <Spinner />;

  async function remove(id: string) {
    if (!confirm('Remove this service?')) return;
    await api.deleteService(id);
    onRefresh();
  }

  function getGroupName(groupId?: string | null) {
    if (!groupId) return null;
    return serviceGroups.find(g => g.id === groupId)?.name ?? null;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {isSalon && onGroupsRefresh && (
        <ServiceGroupsSection serviceGroups={serviceGroups} onRefresh={onGroupsRefresh} />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Services</h1>
          <p className="text-sm text-slate-400 mt-0.5">{services.length} services</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Add service</Button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Total services" value={services.length.toString()} />
        <StatCard label="Avg duration" value={
          services.length ? Math.round(services.reduce((s, v) => s + v.durationMins, 0) / services.length) + ' min' : '—'
        } />
        <StatCard label="Avg price" value={
          services.length ? (services.reduce((s, v) => s + v.price, 0) / services.length / 100).toFixed(0) + ' ALL' : '—'
        } />
      </div>

      <div className="grid gap-2">
        {services.map(svc => {
          const groupName = getGroupName(svc.groupId);
          return (
            <div key={svc.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3.5 flex items-center gap-4">
              <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: svc.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-800">{svc.name}</p>
                  {groupName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                      <Tag size={10} />
                      {groupName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-slate-400">{svc.durationMins} min</span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs font-medium text-slate-600">{(svc.price / 100).toFixed(0)} ALL</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(svc)}><Pencil size={13} /></Button>
                <Button variant="ghost" size="sm" onClick={() => remove(svc.id)}>
                  <Trash2 size={13} className="text-red-400" />
                </Button>
              </div>
            </div>
          );
        })}
        {services.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No services yet.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>Add your first service</Button>
          </div>
        )}
      </div>

      {(adding || editing) && (
        <ServiceForm
          service={editing}
          serviceGroups={serviceGroups}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function ServiceGroupsSection({ serviceGroups, onRefresh }: { serviceGroups: ServiceGroup[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingGroup, setEditingGroup] = useState<ServiceGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  async function addGroup() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.createServiceGroup({ name: newName.trim() });
      setNewName('');
      setAdding(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!editingGroup || !editName.trim()) return;
    setSaving(true);
    try {
      await api.updateServiceGroup(editingGroup.id, { name: editName.trim() });
      setEditingGroup(null);
      onRefresh();
    } finally { setSaving(false); }
  }

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group? Services in this group will be ungrouped.')) return;
    await api.deleteServiceGroup(id);
    onRefresh();
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-700">Service Groups</h2>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <FolderPlus size={13} /> Add group
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {serviceGroups.map(g => (
          <div key={g.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700">
            {editingGroup?.id === g.id ? (
              <>
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingGroup(null); }}
                  className="border-b border-slate-300 focus:outline-none text-sm w-28"
                />
                <button onClick={saveEdit} disabled={saving} className="text-brand-600 text-xs font-medium hover:underline">
                  {saving ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingGroup(null)} className="text-slate-400 text-xs hover:underline">Cancel</button>
              </>
            ) : (
              <>
                <span>{g.name}</span>
                <button onClick={() => { setEditingGroup(g); setEditName(g.name); }} className="text-slate-400 hover:text-slate-600 ml-1">
                  <Pencil size={11} />
                </button>
                <button onClick={() => deleteGroup(g.id)} className="text-red-300 hover:text-red-500">
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>
        ))}
        {serviceGroups.length === 0 && !adding && (
          <p className="text-sm text-slate-400">No groups yet.</p>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2 mt-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addGroup(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
            placeholder="Group name…"
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
          />
          <Button size="sm" onClick={addGroup} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-xl font-semibold text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

function ServiceForm({ service, serviceGroups, onClose, onSaved }: {
  service?: Service | null;
  serviceGroups: ServiceGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [durationMins, setDurationMins] = useState(String(service?.durationMins ?? 30));
  const [price, setPrice] = useState(String(service?.price ?? 1000));
  const [color, setColor] = useState(service?.color ?? COLORS[0]);
  const [groupId, setGroupId] = useState<string>(service?.groupId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const DURATIONS = [15, 20, 25, 30, 45, 60, 75, 90, 120];

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const data = {
        name,
        durationMins: parseInt(durationMins),
        price: parseInt(price),
        color,
        isActive: true,
        groupId: groupId || null,
      };
      if (service) { await api.updateService(service.id, data); }
      else { await api.createService({ ...data }); }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={service ? 'Edit service' : 'New service'} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Service name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Haircut + Beard" />

        {serviceGroups.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <label className="font-medium text-slate-700">Group</label>
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 bg-white"
            >
              <option value="">— No group —</option>
              {serviceGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <label className="font-medium text-slate-700">Duration</label>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map(d => (
              <button key={d} onClick={() => setDurationMins(String(d))}
                className={clsx('px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                  durationMins === String(d)
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {d < 60 ? `${d}min` : `${d/60}h`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label className="font-medium text-slate-700">Price (ALL)</label>
          <div className="relative">
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} min={0} step={100}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">ALL</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Color</span>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={clsx('w-7 h-7 rounded-full border-2 transition-transform',
                  color === c ? 'border-slate-700 scale-110' : 'border-transparent')}
                style={{ background: c }} />
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save service'}</Button>
        </div>
      </div>
    </Modal>
  );
}
