import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, AlertCircle, Table2, Users } from 'lucide-react';
import { api } from '../api';
import type { Zone, RestaurantTable } from '../types';
import { Button, Modal, Input, Spinner } from '../ui';

const ZONE_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f97316','#22c55e','#06b6d4','#eab308','#ef4444'];

function ZoneFormModal({ zone, onClose, onSaved }: { zone?: Zone | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: zone?.name ?? '',
    description: zone?.description ?? '',
    color: zone?.color ?? '#6366f1',
    maxConcurrent: zone?.maxConcurrent != null ? String(zone.maxConcurrent) : '10',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { name: form.name.trim(), description: form.description, color: form.color, maxConcurrent: Number(form.maxConcurrent) || 10 };
      if (zone) await api.updateZone(zone.id, payload);
      else await api.createZone(payload);
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={zone ? 'Edit Zone' : 'New Zone'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Zone name *" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Indoor, Terrace, VIP" autoFocus />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 resize-none"
            placeholder="Optional description..." />
        </label>
        <div>
          <span className="text-sm font-medium text-slate-700 block mb-2">Color</span>
          <div className="flex gap-2 flex-wrap">
            {ZONE_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('color', c)}
                className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <Input
          label="Max concurrent reservations"
          type="number" min={1} max={200}
          value={form.maxConcurrent}
          onChange={e => set('maxConcurrent', e.target.value)}
          placeholder="e.g. 10" />
        <p className="text-xs text-slate-400 -mt-2">Maximum number of simultaneous reservations allowed in this zone.</p>
        {error && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : zone ? 'Save changes' : 'Create zone'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TableFormModal({ zoneId, table, onClose, onSaved }: { zoneId: string; table?: RestaurantTable | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: table?.name ?? '', seats: table?.seats != null ? String(table.seats) : '4' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      if (table) await api.updateTable(table.id, { name: form.name.trim(), seats: Number(form.seats) || 4 });
      else await api.createTable(zoneId, { name: form.name.trim(), seats: Number(form.seats) || 4 });
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={table ? 'Edit Table' : 'New Table'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Table name *" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Table 1, T-01, Corner" autoFocus />
        <Input label="Seats" type="number" min={1} max={50} value={form.seats} onChange={e => set('seats', e.target.value)} />
        {error && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : table ? 'Save changes' : 'Add table'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ZoneRow({ zone, onEdit, onDelete, onRefresh }: { zone: Zone; onEdit: () => void; onDelete: () => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [showAddTable, setShowAddTable] = useState(false);
  const [editTable, setEditTable] = useState<RestaurantTable | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadTables() {
    setLoadingTables(true);
    try { setTables(await api.getTables(zone.id)); }
    catch { /* ignore */ }
    finally { setLoadingTables(false); }
  }

  function toggleExpand() {
    if (!expanded) loadTables();
    setExpanded(e => !e);
  }

  async function deleteTable(t: RestaurantTable) {
    if (!confirm(`Delete table "${t.name}"?`)) return;
    setDeletingId(t.id);
    try { await api.deleteTable(t.id); setTables(ts => ts.filter(x => x.id !== t.id)); onRefresh(); }
    catch (e: any) { alert(e.message); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer" onClick={toggleExpand}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: zone.color }} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800">{zone.name}</span>
          {zone.description && <span className="text-xs text-slate-400 ml-2">{zone.description}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          <span className="flex items-center gap-1"><Table2 size={12} /> {zone.tableCount} tables</span>
          <span className="flex items-center gap-1"><Users size={12} /> max {zone.maxConcurrent} concurrent</span>
        </div>
        <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors"><Pencil size={13} /></button>
          <button onClick={onDelete} className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
        </div>
        {expanded ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-600">Tables</span>
            <Button size="sm" variant="outline" onClick={() => setShowAddTable(true)}><Plus size={12} /> Add table</Button>
          </div>
          {loadingTables ? <div className="py-4 flex justify-center"><Spinner /></div> : tables.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No tables yet — add your first table</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {tables.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white group hover:border-slate-300 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{t.name}</p>
                    <p className="text-[10px] text-slate-400">{t.seats} seats</p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => setEditTable(t)} className="p-1 rounded text-slate-300 hover:text-brand-500 hover:bg-slate-100 transition-colors"><Pencil size={11} /></button>
                    <button onClick={() => deleteTable(t)} disabled={deletingId === t.id} className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddTable && (
        <TableFormModal zoneId={zone.id} onClose={() => setShowAddTable(false)}
          onSaved={() => { setShowAddTable(false); loadTables(); onRefresh(); }} />
      )}
      {editTable && (
        <TableFormModal zoneId={zone.id} table={editTable} onClose={() => setEditTable(null)}
          onSaved={() => { setEditTable(null); loadTables(); }} />
      )}
    </div>
  );
}

export function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setZones(await api.getZones()); }
    catch (e: any) { setError(e.message || 'Failed to load zones'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(zone: Zone) {
    if (!confirm(`Delete zone "${zone.name}"? All tables in this zone will also be removed.`)) return;
    setDeletingId(zone.id);
    try { await api.deleteZone(zone.id); setZones(z => z.filter(x => x.id !== zone.id)); }
    catch (e: any) { alert(e.message); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Table2 size={16} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-800">Zones & Tables</h2>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{zones.length}</span>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> New zone</Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm border-b border-red-100 flex-shrink-0">
          <AlertCircle size={15} /> {error}
          <button onClick={load} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : zones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Table2 size={36} className="text-slate-200 mb-3" />
            <p className="text-sm font-medium text-slate-500">No zones yet</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">Create zones like "Indoor", "Terrace", "VIP" and add tables to each</p>
            <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> New zone</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {zones.map(zone => (
              <ZoneRow key={zone.id} zone={zone}
                onEdit={() => setEditing(zone)}
                onDelete={() => handleDelete(zone)}
                onRefresh={load} />
            ))}
          </div>
        )}
      </div>

      {showNew && <ZoneFormModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {editing && <ZoneFormModal zone={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
