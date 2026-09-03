import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, ChevronDown, Package, ShoppingBag } from 'lucide-react';
import clsx from 'clsx';
import { gbApi } from '../api';
import type { GbMenuItem, GbOrder } from '../types';

function ItemForm({ item, onSave, onCancel }: { item?: GbMenuItem; onSave: (d: Partial<GbMenuItem>) => void; onCancel: () => void }) {
  const [name, setName] = useState(item?.name || '');
  const [description, setDescription] = useState(item?.description || '');
  const [price, setPrice] = useState(item?.price?.toString() || '');
  const [currency, setCurrency] = useState(item?.currency || 'EUR');
  const [category, setCategory] = useState(item?.category || '');
  const [available, setAvailable] = useState(item?.is_available ?? true);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Drinks, Food"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Price</label>
          <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300">
            <option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="ALL">ALL</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Available
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
        <button onClick={() => onSave({ name, description, price: price ? parseFloat(price) : undefined, currency, category, is_available: available })}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
          {item ? 'Update' : 'Add Item'}
        </button>
      </div>
    </div>
  );
}

export function GbMenuPage() {
  const [tab, setTab] = useState<'items' | 'orders'>('items');
  const [items, setItems] = useState<GbMenuItem[]>([]);
  const [orders, setOrders] = useState<GbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<GbMenuItem | null>(null);

  const loadItems = useCallback(async () => {
    try { setItems(await gbApi.getMenu()); } catch { /* silent */ }
  }, []);

  const loadOrders = useCallback(async () => {
    try { setOrders(await gbApi.getOrders()); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    Promise.all([loadItems(), loadOrders()]).then(() => setLoading(false));
    const i = setInterval(() => { if (tab === 'orders') loadOrders(); }, 10_000);
    return () => clearInterval(i);
  }, [loadItems, loadOrders, tab]);

  async function handleSaveItem(data: Partial<GbMenuItem>) {
    try {
      if (editItem) await gbApi.updateMenuItem(editItem.id, data);
      else await gbApi.createMenuItem(data);
      setShowForm(false);
      setEditItem(null);
      await loadItems();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDeleteItem(id: string) {
    if (!confirm('Delete this item?')) return;
    try { await gbApi.deleteMenuItem(id); await loadItems(); } catch (e: any) { alert(e.message); }
  }

  async function handleOrderStatus(id: string, status: string) {
    try { await gbApi.updateOrder(id, { status }); await loadOrders(); } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  const categories = [...new Set(items.map(i => i.category || 'Uncategorized'))];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          <button onClick={() => setTab('items')}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === 'items' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
            <Package size={14} /> Items
          </button>
          <button onClick={() => setTab('orders')}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === 'orders' ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
            <ShoppingBag size={14} /> Orders
          </button>
        </div>
        {tab === 'items' && (
          <button onClick={() => { setShowForm(true); setEditItem(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
            <Plus size={14} /> Add Item
          </button>
        )}
      </div>

      {tab === 'items' && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {(showForm || editItem) && (
            <ItemForm item={editItem || undefined} onSave={handleSaveItem} onCancel={() => { setShowForm(false); setEditItem(null); }} />
          )}
          {categories.map(cat => {
            const catItems = items.filter(i => (i.category || 'Uncategorized') === cat);
            return (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{cat}</h3>
                <div className="space-y-2">
                  {catItems.map(item => (
                    <div key={item.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{item.name}</span>
                          {!item.is_available && <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Unavailable</span>}
                        </div>
                        {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        {item.price != null && (
                          <span className="text-sm font-semibold text-slate-700">{item.currency} {item.price.toFixed(2)}</span>
                        )}
                        <button onClick={() => { setEditItem(item); setShowForm(false); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
                        <button onClick={() => handleDeleteItem(item.id)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {items.length === 0 && !showForm && (
            <p className="text-sm text-slate-400 text-center py-8">No menu items yet</p>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="flex-1 overflow-y-auto space-y-3">
          {orders.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No orders yet</p>
          )}
          {orders.map(o => (
            <div key={o.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-sm font-semibold text-slate-800">#{o.order_number}</span>
                  {o.guest_name && <span className="text-xs text-slate-500 ml-2">{o.guest_name}</span>}
                </div>
                <div className="relative flex-shrink-0">
                  <select value={o.status} onChange={e => handleOrderStatus(o.id, e.target.value)}
                    className="appearance-none bg-slate-100 text-xs font-medium text-slate-600 pl-3 pr-7 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors focus:outline-none">
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="preparing">Preparing</option>
                    <option value="ready">Ready</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1 mb-2">
                {o.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600">
                    <span>{it.quantity}x {it.name}</span>
                    <span>{o.currency} {(it.price * it.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              {o.total_price != null && (
                <div className="flex justify-between text-sm font-semibold text-slate-800 pt-2 border-t border-slate-100">
                  <span>Total</span>
                  <span>{o.currency} {o.total_price.toFixed(2)}</span>
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-2">{new Date(o.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
