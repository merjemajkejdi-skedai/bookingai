import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, FolderPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Modal, Input, Spinner } from '../ui';
import { api } from '../../lib/api';
import type { Service, ServiceGroup } from '../../types';
import clsx from 'clsx';

const COLORS = ['#6366f1','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#3b82f6','#14b8a6'];

interface Props { services: Service[]; loading: boolean; onRefresh: () => void; isSalon?: boolean; }

export function ServicesPage({ services, loading, onRefresh, isSalon = false }: Props) {
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);
  const [groups, setGroups] = useState<ServiceGroup[]>([]);
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ServiceGroup | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function loadGroups() {
    if (isSalon) api.getServiceGroups().then(setGroups).catch(() => {});
  }

  useEffect(() => { loadGroups(); }, [isSalon]);

  function refreshAll() { onRefresh(); loadGroups(); }

  if (loading) return <Spinner />;

  async function remove(id: string) {
    if (!confirm('Remove this service?')) return;
    await api.deleteService(id);
    refreshAll();
  }

  async function removeGroup(id: string) {
    if (!confirm('Delete this group? Services inside will become ungrouped.')) return;
    await api.deleteServiceGroup(id);
    refreshAll();
  }

  function toggleCollapse(id: string) {
    setCollapsed(c => ({ ...c, [id]: !c[id] }));
  }

  const totalRevenue = services.reduce((sum, s) => sum + s.price, 0);

  const statsRow = (
    <div className="grid grid-cols-3 gap-3 mb-6">
      <StatCard label="Total services" value={services.length.toString()} />
      <StatCard label="Avg duration" value={
        services.length ? Math.round(services.reduce((s, v) => s + v.durationMins, 0) / services.length) + ' min' : '—'
      } />
      <StatCard label="Avg price" value={
        services.length ? (services.reduce((s, v) => s + v.price, 0) / services.length / 100).toFixed(0) + ' ALL' : '—'
      } />
    </div>
  );

  // ── Salon grouped view ───────────────────────────────────────────────────
  if (isSalon) {
    const ungrouped = services.filter(s => !s.groupId);

    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Services</h1>
            <p className="text-sm text-slate-400 mt-0.5">{services.length} services · {groups.length} groups</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddingGroup(true)}>
              <FolderPlus size={14} /> New group
            </Button>
            <Button onClick={() => setAdding(true)}><Plus size={14} /> Add service</Button>
          </div>
        </div>

        {statsRow}

        <div className="space-y-4">
          {groups.map(group => {
            const groupServices = services.filter(s => s.groupId === group.id);
            const isCollapsed = !!collapsed[group.id];
            return (
              <div key={group.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <button onClick={() => toggleCollapse(group.id)} className="text-slate-400 hover:text-slate-600">
                    {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <span className="font-semibold text-slate-700 flex-1">{group.name}</span>
                  <span className="text-xs text-slate-400 mr-2">{groupServices.length} service{groupServices.length !== 1 ? 's' : ''}</span>
                  <Button variant="ghost" size="sm" onClick={() => setEditingGroup(group)}>
                    <Pencil size={12} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeGroup(group.id)}>
                    <Trash2 size={12} className="text-red-400" />
                  </Button>
                </div>
                {/* Services in group */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {groupServices.length === 0 ? (
                      <p className="text-sm text-slate-400 px-4 py-3">No services in this group yet.</p>
                    ) : groupServices.map(svc => (
                      <ServiceRow key={svc.id} svc={svc} onEdit={setEditing} onDelete={remove} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped */}
          {ungrouped.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                <button onClick={() => toggleCollapse('__ungrouped')} className="text-slate-400 hover:text-slate-600">
                  {collapsed['__ungrouped'] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                <span className="font-semibold text-slate-500 flex-1">Ungrouped</span>
                <span className="text-xs text-slate-400">{ungrouped.length} service{ungrouped.length !== 1 ? 's' : ''}</span>
              </div>
              {!collapsed['__ungrouped'] && (
                <div className="divide-y divide-slate-100">
                  {ungrouped.map(svc => (
                    <ServiceRow key={svc.id} svc={svc} onEdit={setEditing} onDelete={remove} />
                  ))}
                </div>
              )}
            </div>
          )}

          {services.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-sm">No services yet.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>
                Add your first service
              </Button>
            </div>
          )}
        </div>

        {(adding || editing) && (
          <ServiceForm
            service={editing}
            groups={groups}
            isSalon
            onClose={() => { setAdding(false); setEditing(null); }}
            onSaved={() => { setAdding(false); setEditing(null); refreshAll(); }}
          />
        )}
        {(addingGroup || editingGroup) && (
          <ServiceGroupForm
            group={editingGroup}
            onClose={() => { setAddingGroup(false); setEditingGroup(null); }}
            onSaved={() => { setAddingGroup(false); setEditingGroup(null); loadGroups(); }}
          />
        )}
      </div>
    );
  }

  // ── Barber flat view (unchanged) ─────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Services</h1>
          <p className="text-sm text-slate-400 mt-0.5">{services.length} services</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Add service</Button>
      </div>

      {statsRow}

      <div className="grid gap-2">
        {services.map(svc => (
          <div key={svc.id}
            className="bg-white rounded-xl border border-slate-200 px-4 py-3.5 flex items-center gap-4">
            <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: svc.color }} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">{svc.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-400">{svc.durationMins} min</span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-medium text-slate-600">{(svc.price / 100).toFixed(0)} ALL</span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(svc)}>
                <Pencil size={13} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(svc.id)}>
                <Trash2 size={13} className="text-red-400" />
              </Button>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No services yet.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>
              Add your first service
            </Button>
          </div>
        )}
      </div>

      {(adding || editing) && (
        <ServiceForm
          service={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Service row (shared between grouped + flat views) ────────────────────────
function ServiceRow({ svc, onEdit, onDelete }: {
  svc: Service; onEdit: (s: Service) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-4">
      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: svc.color }} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800">{svc.name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-slate-400">{svc.durationMins} min</span>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-xs font-medium text-slate-600">{(svc.price / 100).toFixed(0)} ALL</span>
        </div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => onEdit(svc)}>
          <Pencil size={13} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(svc.id)}>
          <Trash2 size={13} className="text-red-400" />
        </Button>
      </div>
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

// ── Service form ─────────────────────────────────────────────────────────────
function ServiceForm({ service, groups = [], isSalon = false, onClose, onSaved }: {
  service?: Service | null;
  groups?: ServiceGroup[];
  isSalon?: boolean;
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

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const data = {
        name, durationMins: parseInt(durationMins), price: parseInt(price),
        color, isActive: true,
        ...(isSalon ? { groupId: groupId || null } : {}),
      };
      if (service) { await api.updateService(service.id, data); }
      else { await api.createService({ ...data }); }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  const DURATIONS = [15, 20, 25, 30, 45, 60, 75, 90, 120];

  return (
    <Modal title={service ? 'Edit service' : 'New service'} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Service name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Haircut + Beard" />

        {isSalon && (
          <div className="flex flex-col gap-1.5 text-sm">
            <label className="font-medium text-slate-700">Group</label>
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400">
              <option value="">— Ungrouped —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
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
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}>
                {d < 60 ? `${d}min` : `${d/60}h`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label className="font-medium text-slate-700">Price (ALL, in lekë)</label>
          <div className="relative">
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} min={0} step={100}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">ALL</span>
          </div>
          <p className="text-xs text-slate-400">{(parseInt(price||'0') / 100).toFixed(2)} stored as units · displayed as {(parseInt(price||'0') / 100).toFixed(0)} ALL</p>
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

// ── Service group form ────────────────────────────────────────────────────────
function ServiceGroupForm({ group, onClose, onSaved }: {
  group?: ServiceGroup | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      if (group) { await api.updateServiceGroup(group.id, { name }); }
      else { await api.createServiceGroup({ name }); }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={group ? 'Rename group' : 'New group'} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Group name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hair Care, Nail Art" autoFocus />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : group ? 'Rename' : 'Create group'}</Button>
        </div>
      </div>
    </Modal>
  );
}
