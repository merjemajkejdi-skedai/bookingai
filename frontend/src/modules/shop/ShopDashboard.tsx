import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Package, MessageSquare, HelpCircle, Settings, Plus, Trash2, Pencil, X, Check, RefreshCw, LogOut } from 'lucide-react';
import { shopApi, setViewTenantId } from './api';
import type { ShopOrder, ShopItem, ShopCategory, ShopFaq, ShopConversation, ShopConfig } from './types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  new: 'New', in_progress: 'In Progress', done: 'Ready', picked_up: 'Picked Up', cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
  picked_up: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-600',
};

const STOCK_BADGE: Record<string, string> = {
  unlimited: 'bg-green-100 text-green-700',
  daily: 'bg-blue-100 text-blue-700',
  fixed: 'bg-amber-100 text-amber-700',
};

function fmt(n: number, currency = 'ALL') { return `${Number(n).toLocaleString()} ${currency}`; }
function fmtDate(s: string) { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function timeAgo(s: string) {
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Order Card ─────────────────────────────────────────────────────────────────

function OrderCard({ order, onStatusChange }: { order: ShopOrder; onStatusChange: (id: string, s: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function changeStatus(status: string) {
    setBusy(true);
    try { await onStatusChange(order.id, status); } finally { setBusy(false); }
  }

  const nextAction = order.status === 'new' ? { label: 'Start', next: 'in_progress', color: 'bg-amber-500 hover:bg-amber-600' }
    : order.status === 'in_progress' ? { label: 'Mark Ready', next: 'done', color: 'bg-green-500 hover:bg-green-600' }
    : order.status === 'done' ? { label: 'Picked Up', next: 'picked_up', color: 'bg-slate-500 hover:bg-slate-600' }
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-bold text-slate-800">#{order.order_number}</span>
          {order.pickup_name && <span className="ml-2 text-xs text-slate-500">· {order.pickup_name}</span>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
      </div>

      <div className="text-xs text-slate-500">{order.guest_phone} · {timeAgo(order.created_at)}</div>

      <div className="border-t border-slate-100 pt-2 space-y-1">
        {(order.items || []).map((it, i) => (
          <div key={i} className="flex justify-between text-xs text-slate-700">
            <span>{it.item_name} × {it.quantity}</span>
            <span className="text-slate-500">{fmt(it.subtotal, order.currency)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-sm font-semibold text-slate-800">{fmt(order.total_price, order.currency)}</span>
        <div className="flex gap-1">
          {order.status === 'new' && (
            <button onClick={() => changeStatus('cancelled')} disabled={busy} className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 transition-colors">
              Cancel
            </button>
          )}
          {nextAction && (
            <button onClick={() => changeStatus(nextAction.next)} disabled={busy} className={`text-xs px-3 py-1 rounded text-white transition-colors ${nextAction.color} disabled:opacity-50`}>
              {busy ? '…' : nextAction.label}
            </button>
          )}
        </div>
      </div>
      {order.notes && <div className="text-xs text-slate-400 italic">Note: {order.notes}</div>}
    </div>
  );
}

// ── Orders Tab ─────────────────────────────────────────────────────────────────

function OrdersTab() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setOrders(await shopApi.getOrders('all', date)); }
    catch (e: any) { setLoadError(e.message ?? 'Failed to load orders'); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(id: string, status: string) {
    await shopApi.updateOrderStatus(id, status);
    await load();
  }

  const cols = ['new', 'in_progress', 'done', 'picked_up'] as const;
  const byStatus = (s: string) => orders.filter((o) => o.status === s);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><RefreshCw size={15} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} /></button>
        <span className="text-xs text-slate-400">{orders.filter(o => o.status !== 'cancelled').length} orders</span>
      </div>

      {loadError && (
        <div className="text-red-500 text-xs px-3 py-2 bg-red-50 rounded-lg">Error: {loadError}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 overflow-auto">
          {cols.map((col) => (
            <div key={col} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 sticky top-0 bg-slate-50 pb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[col]}`}>{STATUS_LABELS[col]}</span>
                <span className="text-xs text-slate-400">{byStatus(col).length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto">
                {byStatus(col).length === 0
                  ? <div className="text-xs text-slate-300 text-center py-4">Empty</div>
                  : byStatus(col).map((o) => <OrderCard key={o.id} order={o} onStatusChange={handleStatusChange} />)
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Item Form Modal ────────────────────────────────────────────────────────────

function ItemModal({
  item,
  categories,
  onSave,
  onClose,
}: {
  item?: ShopItem | null;
  categories: ShopCategory[];
  onSave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [description, setDescription] = useState(item?.description || '');
  const [price, setPrice] = useState(String(item?.price ?? ''));
  const [currency, setCurrency] = useState(item?.currency || 'ALL');
  const [categoryId, setCategoryId] = useState(item?.category_id || '');
  const [stockType, setStockType] = useState<'unlimited' | 'daily' | 'fixed'>(item?.stock_type || 'unlimited');
  const [stockLimit, setStockLimit] = useState(String(item?.stock_limit ?? ''));
  const [stockUsed, setStockUsed] = useState(String(item?.stock_used ?? 0));
  const [isActive, setIsActive] = useState(item ? item.is_active === 1 : true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim() || !price) { setError('Name and price are required'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('description', description);
      form.append('price', price);
      form.append('currency', currency);
      form.append('category_id', categoryId);
      form.append('stock_type', stockType);
      if (stockType !== 'unlimited' && stockLimit) form.append('stock_limit', stockLimit);
      if (item) form.append('stock_used', stockUsed);
      form.append('is_active', isActive ? '1' : '0');
      if (photo) form.append('photo', photo);

      if (item) { await shopApi.updateItem(item.id, form); } else { await shopApi.createItem(form); }
      onSave();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{item ? 'Edit Item' : 'Add Item'}</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div>
            <label className="text-xs text-slate-500 font-medium">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Item name" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Short description" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 font-medium">Price *</label>
              <input value={price} onChange={e => setPrice(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Currency</label>
              <input value={currency} onChange={e => setCurrency(e.target.value)} placeholder="ALL" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium">Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium">Stock</label>
            <select value={stockType} onChange={e => setStockType(e.target.value as any)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="unlimited">Unlimited</option>
              <option value="daily">Daily limit (resets midnight)</option>
              <option value="fixed">Fixed quantity</option>
            </select>
          </div>
          {stockType !== 'unlimited' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 font-medium">Limit</label>
                <input value={stockLimit} onChange={e => setStockLimit(e.target.value)} type="number" min="0" placeholder="Max qty" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {item && (
                <div>
                  <label className="text-xs text-slate-500 font-medium">Used (reset to 0 to restock)</label>
                  <input value={stockUsed} onChange={e => setStockUsed(e.target.value)} type="number" min="0" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500 font-medium">Photo</label>
            {item?.photo_url && !photo && (
              <img src={item.photo_url} alt="" className="mt-1 h-16 w-16 rounded-lg object-cover border border-slate-200" />
            )}
            <input type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] || null)} className="mt-1 w-full text-xs text-slate-500" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
            <label htmlFor="active" className="text-sm text-slate-700">Active (visible to customers)</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Menu Tab ───────────────────────────────────────────────────────────────────

function MenuTab() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<ShopItem | null | undefined>(undefined);
  const [catName, setCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [selectedCat, setSelectedCat] = useState<string>('');

  async function load() {
    setLoading(true);
    try {
      const [c, i] = await Promise.all([shopApi.getCategories(), shopApi.getItems()]);
      setCategories(c); setItems(i);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addCategory() {
    if (!catName.trim()) return;
    await shopApi.createCategory({ name: catName.trim(), sort_order: categories.length });
    setCatName(''); setAddingCat(false); load();
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category?')) return;
    await shopApi.deleteCategory(id); load();
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this item?')) return;
    await shopApi.deleteItem(id); load();
  }

  const filtered = selectedCat ? items.filter(i => i.category_id === selectedCat) : items;

  if (loading) return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* Category sidebar */}
      <div className="w-44 flex-shrink-0 flex flex-col gap-1">
        <button onClick={() => setSelectedCat('')} className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedCat === '' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}>
          All items ({items.length})
        </button>
        {categories.map(c => (
          <div key={c.id} className={`flex items-center group rounded-lg ${selectedCat === c.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
            <button onClick={() => setSelectedCat(c.id)} className={`flex-1 text-left px-3 py-2 text-sm truncate ${selectedCat === c.id ? 'text-brand-700 font-medium' : 'text-slate-600'}`}>
              {c.name}
            </button>
            <button onClick={() => deleteCategory(c.id)} className="opacity-0 group-hover:opacity-100 pr-2 text-slate-300 hover:text-red-500 transition-all">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {addingCat ? (
          <div className="flex gap-1 mt-1">
            <input autoFocus value={catName} onChange={e => setCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} placeholder="Category name" className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs" />
            <button onClick={addCategory} className="p-1 rounded text-green-600"><Check size={14} /></button>
            <button onClick={() => setAddingCat(false)} className="p-1 rounded text-slate-400"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingCat(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-3 py-1 mt-1">
            <Plus size={13} /> Category
          </button>
        )}
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-500">{filtered.length} items</span>
          <button onClick={() => setEditItem(null)} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors">
            <Plus size={14} /> Add Item
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(item => (
            <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-3 flex gap-3 shadow-sm">
              {item.photo_url
                ? <img src={item.photo_url} alt={item.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-slate-100" />
                : <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><Package size={20} className="text-slate-300" /></div>
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <span className={`text-sm font-medium ${item.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{item.name}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => setEditItem(item)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil size={13} /></button>
                    <button onClick={() => deleteItem(item.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </div>
                </div>
                {item.description && <p className="text-xs text-slate-400 truncate mt-0.5">{item.description}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-semibold text-slate-700">{fmt(item.price, item.currency)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${STOCK_BADGE[item.stock_type]}`}>{item.stock_type}</span>
                  {item.stock_type !== 'unlimited' && item.stock_limit != null && (
                    <span className="text-xs text-slate-400">{item.stock_limit - item.stock_used}/{item.stock_limit} left</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center py-12 text-slate-300">
              <Package size={32} className="mx-auto mb-2" />
              <p className="text-sm">No items yet</p>
            </div>
          )}
        </div>
      </div>

      {editItem !== undefined && (
        <ItemModal item={editItem} categories={categories} onSave={() => { setEditItem(undefined); load(); }} onClose={() => setEditItem(undefined)} />
      )}
    </div>
  );
}

// ── FAQ Tab ────────────────────────────────────────────────────────────────────

function FaqTab() {
  const [faqs, setFaqs] = useState<ShopFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ShopFaq | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setFaqs(await shopApi.getFaq()); } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditing(null); setQ(''); setA(''); }
  function openEdit(f: ShopFaq) { setEditing(f); setQ(f.question); setA(f.answer); }

  async function save() {
    if (!q.trim() || !a.trim()) return;
    setBusy(true);
    try {
      if (editing === null) { await shopApi.createFaq({ question: q, answer: a, sort_order: faqs.length }); }
      else if (editing) { await shopApi.updateFaq(editing.id, { question: q, answer: a }); }
      setEditing(undefined); setQ(''); setA(''); load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this FAQ?')) return;
    await shopApi.deleteFaq(id); load();
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-auto">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">{faqs.length} FAQ entries</span>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors">
          <Plus size={14} /> Add FAQ
        </button>
      </div>

      {loading ? <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div> : (
        <div className="space-y-3">
          {faqs.map(f => (
            <div key={f.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">Q: {f.question}</p>
                  <p className="text-sm text-slate-600 mt-1">A: {f.answer}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(f)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil size={14} /></button>
                  <button onClick={() => del(f.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
          {faqs.length === 0 && <div className="text-center py-12 text-slate-300 text-sm">No FAQ entries yet</div>}
        </div>
      )}

      {editing !== undefined && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold text-slate-800">{editing === null ? 'Add FAQ' : 'Edit FAQ'}</h3>
            <div>
              <label className="text-xs text-slate-500 font-medium">Question</label>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Customer question" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Answer</label>
              <textarea value={a} onChange={e => setA(e.target.value)} rows={3} placeholder="Your answer" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(undefined)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
              <button onClick={save} disabled={busy} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conversations Tab ──────────────────────────────────────────────────────────

function ConversationsTab() {
  const [convs, setConvs] = useState<ShopConversation[]>([]);
  const [selected, setSelected] = useState<ShopConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  function loadList() {
    setLoadError(null);
    shopApi.getConversations()
      .then(setConvs)
      .catch((e: any) => setLoadError(e.message ?? 'Failed to load conversations'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadList(); }, []);

  async function open(c: ShopConversation) {
    const full = await shopApi.getConversation(c.guest_phone).catch(() => c);
    setSelected(full);
  }

  async function clearHistory() {
    if (!selected || !confirm(`Clear conversation history for ${selected.guest_phone}? This resets the AI memory for this customer.`)) return;
    setClearing(true);
    try {
      await shopApi.clearConversation(selected.guest_phone);
      setSelected(prev => prev ? { ...prev, messages: [] } : null);
      loadList();
    } catch { /* ignore */ } finally { setClearing(false); }
  }

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      <div className="w-64 flex-shrink-0 overflow-y-auto space-y-1">
        {loading && <div className="text-slate-400 text-sm p-2">Loading…</div>}
        {convs.map(c => (
          <button key={c.id} onClick={() => open(c)} className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${selected?.id === c.id ? 'bg-brand-50 border border-brand-200' : 'hover:bg-slate-100'}`}>
            <p className="text-sm font-medium text-slate-800 truncate">{c.guest_phone}</p>
            <p className="text-xs text-slate-400">{timeAgo(c.updated_at)}</p>
          </button>
        ))}
        {loadError && (
          <div className="text-red-500 text-xs px-2 py-2 bg-red-50 rounded-lg">
            Error: {loadError}
          </div>
        )}
        {!loading && !loadError && convs.length === 0 && <div className="text-slate-300 text-sm text-center py-8">No conversations yet</div>}
      </div>
      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 p-4">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-300">
            <MessageSquare size={32} className="mb-2" />
            <p className="text-sm">Select a conversation</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 font-medium">{selected.guest_phone}</p>
              <button
                onClick={clearHistory}
                disabled={clearing}
                title="Clear conversation history (resets AI memory for this customer)"
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors">
                <Trash2 size={12} /> {clearing ? 'Clearing…' : 'Clear history'}
              </button>
            </div>
            {(selected.messages || []).map((m, i) => (
              <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${m.role === 'assistant' ? 'bg-slate-100 text-slate-800' : 'bg-brand-600 text-white'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {(selected.messages || []).length === 0 && <p className="text-slate-300 text-sm text-center py-8">No messages</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Config Tab ─────────────────────────────────────────────────────────────────

function ConfigTab() {
  const [cfg, setCfg] = useState<Partial<ShopConfig>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    shopApi.getConfig().then(c => { setCfg(c); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  function set(key: keyof ShopConfig, value: any) { setCfg(prev => ({ ...prev, [key]: value })); }

  async function save() {
    setBusy(true);
    try { await shopApi.putConfig(cfg); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="max-w-lg space-y-5 overflow-y-auto h-full">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h4 className="font-medium text-slate-800">Shop Settings</h4>
        <Field label="Shop Name" value={cfg.shop_name || ''} onChange={v => set('shop_name', v)} placeholder="My Shop" />
        <Field label="Opening Hours" value={cfg.opening_hours || ''} onChange={v => set('opening_hours', v)} placeholder="Mon–Sat 9:00–20:00" />
        <Field label="Address" value={cfg.address || ''} onChange={v => set('address', v)} placeholder="Street, City" />
        <Field label="Phone" value={cfg.phone || ''} onChange={v => set('phone', v)} placeholder="+355 69 123 4567" />
        <div>
          <label className="text-xs text-slate-500 font-medium">Estimated Pickup (minutes)</label>
          <input type="number" min="1" value={cfg.estimated_pickup_minutes ?? 15} onChange={e => set('estimated_pickup_minutes', parseInt(e.target.value))} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Agent Personality</label>
          <select value={cfg.agent_personality || 'friendly'} onChange={e => set('agent_personality', e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="friendly">Friendly</option>
            <option value="professional">Professional</option>
            <option value="playful">Playful</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h4 className="font-medium text-slate-800">Social Links</h4>
        <Field label="Instagram" value={cfg.instagram_url || ''} onChange={v => set('instagram_url', v)} placeholder="https://instagram.com/..." />
        <Field label="Facebook" value={cfg.facebook_url || ''} onChange={v => set('facebook_url', v)} placeholder="https://facebook.com/..." />
        <Field label="TikTok" value={cfg.tiktok_url || ''} onChange={v => set('tiktok_url', v)} placeholder="https://tiktok.com/@..." />
        <Field label="Website" value={cfg.website_url || ''} onChange={v => set('website_url', v)} placeholder="https://myshop.com" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h4 className="font-medium text-slate-800">Fallback &amp; Error Handling</h4>
          <p className="text-xs text-slate-400 mt-0.5">When orders cannot be processed, guests receive this message instead of a generic error.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Fallback message</label>
          <textarea
            rows={2}
            value={cfg.fallback_message || ''}
            onChange={e => set('fallback_message', e.target.value)}
            placeholder="We are temporarily unable to process your order online."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none"
          />
          <p className="text-xs text-slate-400">Shown to guest when the AI encounters an error</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Backup WhatsApp number</label>
          <input
            type="text"
            value={cfg.fallback_backup_number || ''}
            onChange={e => set('fallback_backup_number', e.target.value)}
            placeholder="+355691234567"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-400">Shared with guest when error threshold is reached. Leave empty to not share.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Share backup number after</label>
          <select
            value={cfg.fallback_after_attempts ?? 1}
            onChange={e => set('fallback_after_attempts', parseInt(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            <option value={1}>1st error (immediately)</option>
            <option value={2}>2nd consecutive error</option>
            <option value={3}>3rd consecutive error</option>
          </select>
          <p className="text-xs text-slate-400">How many errors in a row before the backup number is shown</p>
        </div>

        {cfg.fallback_backup_number && (
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-1">
              Preview — what guest sees after {cfg.fallback_after_attempts ?? 1} error(s):
            </p>
            <p className="text-xs text-slate-700 whitespace-pre-wrap">
              {cfg.fallback_message || 'We are temporarily unable to process your order online.'}
              {'\n\nPlease contact us directly on WhatsApp:\n📱 '}
              {cfg.fallback_backup_number}
            </p>
          </div>
        )}
      </div>

      <button onClick={save} disabled={busy} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">
        {busy ? 'Saving…' : saved ? <><Check size={14} /> Saved!</> : 'Save Settings'}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs text-slate-500 font-medium">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'menu' | 'conversations' | 'faq' | 'config';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'orders',        label: 'Orders',        icon: <ShoppingBag size={16} /> },
  { id: 'menu',          label: 'Menu',          icon: <Package size={16} /> },
  { id: 'conversations', label: 'Chats',         icon: <MessageSquare size={16} /> },
  { id: 'faq',           label: 'FAQ',           icon: <HelpCircle size={16} /> },
  { id: 'config',        label: 'Settings',      icon: <Settings size={16} /> },
];

export function ShopDashboard({ onLogout, tenantId }: { onLogout: () => void; tenantId?: string }) {
  const [tab, setTab] = useState<Tab>('orders');

  // When super_admin views a specific shop, inject tenantId into all API requests
  useEffect(() => {
    setViewTenantId(tenantId ?? null);
    return () => setViewTenantId(null);
  }, [tenantId]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 flex items-center gap-1">
        <div className="flex items-center gap-2 py-3 mr-4">
          <ShoppingBag size={18} className="text-brand-600" />
          <span className="font-semibold text-slate-800 text-sm">Shop</span>
        </div>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 transition-colors ${
              tab === t.id
                ? 'border-brand-600 text-brand-700 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <button onClick={onLogout} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors py-3 px-2">
          <LogOut size={14} /> Sign out
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden p-4">
        {tab === 'orders'        && <OrdersTab />}
        {tab === 'menu'          && <MenuTab />}
        {tab === 'conversations' && <ConversationsTab />}
        {tab === 'faq'           && <FaqTab />}
        {tab === 'config'        && <ConfigTab />}
      </div>
    </div>
  );
}
