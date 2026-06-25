import { useState, useEffect } from 'react';
import { shopApi } from './api';

const ROLES = [
  { value: 'operator',   label: 'Operator',   desc: 'Orders & Conversations' },
  { value: 'supervisor', label: 'Supervisor',  desc: 'Orders, Conversations, Menu & FAQ' },
  { value: 'admin',      label: 'Admin',       desc: 'Full access' },
];

const ROLE_COLORS: Record<string, string> = {
  admin:      'bg-purple-50 text-purple-700',
  supervisor: 'bg-blue-50 text-blue-700',
  operator:   'bg-slate-100 text-slate-600',
};

const emptyForm = { username: '', password: '', name: '', surname: '', tax_id: '', operator_id: '', role: 'operator' };

export function ShopUsers() {
  const [users, setUsers]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form, setForm]         = useState({ ...emptyForm });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const me = (() => { try { return JSON.parse(localStorage.getItem('shopUser') || '{}'); } catch { return {}; } })();

  async function load() {
    try {
      setUsers(await shopApi.getUsers());
    } catch (e: any) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditUser(null);
    setForm({ ...emptyForm });
    setError('');
    setShowForm(true);
  }

  function openEdit(user: any) {
    setEditUser(user);
    setForm({ username: user.username, password: '', name: user.name, surname: user.surname, tax_id: user.tax_id || '', operator_id: user.operator_id || '', role: user.role });
    setError('');
    setShowForm(true);
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      if (editUser) {
        const patch: any = { name: form.name, surname: form.surname, tax_id: form.tax_id || null, operator_id: form.operator_id || null, role: form.role };
        if (form.password) patch.password = form.password;
        await shopApi.updateUser(editUser.id, patch);
      } else {
        await shopApi.createUser({
          username:    form.username,
          password:    form.password,
          name:        form.name,
          surname:     form.surname,
          tax_id:      form.tax_id || null,
          operator_id: form.operator_id || null,
          role:        form.role,
        });
      }
      setShowForm(false);
      setEditUser(null);
      setForm({ ...emptyForm });
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: any) {
    try {
      await shopApi.updateUser(user.id, { is_active: !user.is_active });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function deleteUser(user: any) {
    if (user.id === me.id) { alert('Cannot delete your own account'); return; }
    if (!confirm(`Delete ${user.name} ${user.surname}? This cannot be undone.`)) return;
    try { await shopApi.deleteUser(user.id); await load(); }
    catch (e: any) { alert(e.message); }
  }

  const canSave = form.name && form.surname && form.username && (editUser || form.password);

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Staff accounts</h3>
          <p className="text-xs text-slate-400 mt-0.5">Manage who can access the dashboard and what they can do</p>
        </div>
        <button
          onClick={openNew}
          className="text-xs font-medium px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors"
        >
          + Add user
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 text-center py-8">Loading…</div>
      ) : (
        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center font-medium text-brand-600 text-sm flex-shrink-0">
                {(user.name || '?')[0]}{(user.surname || '?')[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-700">{user.name} {user.surname}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role] || ROLE_COLORS.operator}`}>
                    {user.role}
                  </span>
                  {!user.is_active && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">Inactive</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate">
                  @{user.username}{user.operator_id ? ` · ID: ${user.operator_id}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button onClick={() => toggleActive(user)} className="text-xs text-slate-500 hover:text-slate-700">
                  {user.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => openEdit(user)} className="text-xs text-brand-600 hover:text-brand-700">Edit</button>
                {user.id !== me.id && (
                  <button onClick={() => deleteUser(user)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">No staff accounts yet. Add your first user above.</p>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">{editUser ? 'Edit user' : 'Add user'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Surname *</label>
                  <input value={form.surname} onChange={e => setForm(f => ({ ...f, surname: e.target.value }))}
                    className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Username *</label>
                <input
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  disabled={!!editUser}
                  placeholder="e.g. artan.hoxha"
                  className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">
                  {editUser ? 'New password (leave blank to keep current)' : 'Password *'}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? 'Leave blank to keep current' : 'Min 6 characters'}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Role *</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Tax ID</label>
                  <input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
                    placeholder="Optional"
                    className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Operator ID</label>
                  <input value={form.operator_id} onChange={e => setForm(f => ({ ...f, operator_id: e.target.value }))}
                    placeholder="e.g. OP001"
                    className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end px-5 pb-5">
              <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-4 py-2 hover:bg-slate-50 rounded-lg">Cancel</button>
              <button
                onClick={save}
                disabled={!canSave || saving}
                className="text-sm font-medium px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : editUser ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
