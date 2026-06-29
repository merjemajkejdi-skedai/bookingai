import { useState, useEffect, useCallback, useRef } from 'react';
import { ShoppingBag, Package, MessageSquare, HelpCircle, Settings, Plus, Trash2, Pencil, X, Check, RefreshCw, LogOut, BarChart2, Users, QrCode, Boxes } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import { shopApi, setViewTenantId } from './api';
import type { ShopOrder, ShopItem, ShopCategory, ShopFaq, ShopConversation, ShopConfig } from './types';
import { ShopReports } from './ShopReports';
import { ShopUsers } from './ShopUsers';
import { ShopInventory } from './ShopInventory';
import { getStoredUser } from '../../shared/lib/auth';

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

// ── Receipt PDF ────────────────────────────────────────────────────────────────

function openReceipt(receiptData: any) {
  const doc = new jsPDF({ format: 'a6', unit: 'mm' });
  const W = 105;
  let y = 10;

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(receiptData.shop_name || 'Receipt', W / 2, y, { align: 'center' }); y += 6;

  if (receiptData.fiscal_nuis) {
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(`NIPT: ${receiptData.fiscal_nuis}`, W / 2, y, { align: 'center' }); y += 6;
  }

  doc.line(5, y, W - 5, y); y += 5;
  doc.setFontSize(9);
  doc.text(`Order #${receiptData.order_number}`, 5, y);
  doc.text(new Date(receiptData.order_date).toLocaleString('en-GB'), W - 5, y, { align: 'right' }); y += 5;
  if (receiptData.pickup_name) { doc.text(`Customer: ${receiptData.pickup_name}`, 5, y); y += 4; }
  if (receiptData.table_name)  { doc.text(`Table: ${receiptData.table_name}`, 5, y); y += 4; }

  doc.line(5, y, W - 5, y); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Item', 5, y); doc.text('Qty', 65, y, { align: 'right' }); doc.text('Total', W - 5, y, { align: 'right' }); y += 4;
  doc.setFont('helvetica', 'normal');

  for (const item of receiptData.items || []) {
    doc.text(String(item.name), 5, y);
    doc.text(`x${item.qty}`, 65, y, { align: 'right' });
    doc.text(`${parseFloat(item.sub).toLocaleString()} ALL`, W - 5, y, { align: 'right' }); y += 4;
  }

  doc.line(5, y, W - 5, y); y += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('TOTAL', 5, y);
  doc.text(`${parseFloat(receiptData.total).toLocaleString()} ALL`, W - 5, y, { align: 'right' }); y += 5;

  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(`Payment: ${receiptData.payment_type === 'BANKNOTE' ? 'Cash' : 'Card'}`, 5, y); y += 6;

  if (receiptData.fiscal_inv_num) {
    doc.line(5, y, W - 5, y); y += 4;
    doc.setFontSize(7);
    doc.text(`Invoice: ${receiptData.fiscal_inv_num}`, 5, y); y += 4;
    doc.text(`IIC: ${receiptData.fiscal_iic}`, 5, y); y += 6;
    if (receiptData.fiscal_verify_url) {
      const urlLines = doc.splitTextToSize(receiptData.fiscal_verify_url, W - 10);
      doc.text(urlLines, 5, y); y += urlLines.length * 3.5;
    }
  }

  y += 4; doc.setFontSize(8);
  doc.text('Thank you!', W / 2, y, { align: 'center' });
  window.open(doc.output('bloburl'), '_blank');
}

// ── Pay Button ─────────────────────────────────────────────────────────────────

function PayButton({ order, onRefresh }: { order: ShopOrder; onRefresh: () => void }) {
  const [paying, setPaying]           = useState(false);
  const [paymentType, setPaymentType] = useState<'BANKNOTE' | 'CARD'>('BANKNOTE');
  const [showModal, setShowModal]     = useState(false);
  const [result, setResult]           = useState<any>(null);

  if (order.is_paid || order.status === 'cancelled' || order.status === 'picked_up') return null;

  async function handlePay() {
    setPaying(true);
    try {
      const res = await shopApi.payOrder(order.id, paymentType);
      setResult(res);
      onRefresh();
    } finally { setPaying(false); }
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
      >
        💳 Pay
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-2xl">
            {!result ? (
              <>
                <h3 className="text-base font-semibold text-slate-800 mb-1">Order #{order.order_number}</h3>
                <p className="text-2xl font-black text-slate-800 mb-4">
                  {parseFloat(String(order.total_price)).toLocaleString()} ALL
                </p>
                <p className="text-xs font-medium text-slate-500 mb-2">Payment method</p>
                <div className="flex gap-2 mb-4">
                  {([['BANKNOTE', '💵 Cash'], ['CARD', '💳 Card']] as const).map(([pt, label]) => (
                    <button
                      key={pt}
                      onClick={() => setPaymentType(pt)}
                      className={`flex-1 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                        paymentType === pt ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
                  <button onClick={handlePay} disabled={paying} className="flex-1 py-2.5 text-sm font-semibold bg-green-500 text-white rounded-xl disabled:opacity-50">
                    {paying ? 'Processing…' : 'Confirm'}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-3">{result.success ? '✅' : '⚠️'}</div>
                <h3 className="font-semibold text-slate-800 mb-1">
                  {result.success ? 'Payment recorded' : 'Paid — fiscal failed'}
                </h3>
                {result.success && result.invoice && (
                  <div className="bg-slate-50 rounded-xl p-3 mt-3 text-left text-xs space-y-1">
                    <p className="text-slate-600">Invoice: <span className="font-mono font-medium">{result.invoice.InvNum}</span></p>
                    <p className="text-slate-400 break-all">IIC: {result.invoice.IIC}</p>
                  </div>
                )}
                {!result.success && (
                  <div className="bg-red-50 rounded-xl p-3 mt-3 text-left">
                    <p className="text-xs text-red-600">{result.fiscal_error}</p>
                    <p className="text-xs text-slate-400 mt-1">Order marked as paid. Use "Retry fiscal" to try again.</p>
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setShowModal(false); setResult(null); }} className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl">Close</button>
                  {result.success && (
                    <button
                      onClick={() => shopApi.getReceipt(order.id).then(openReceipt)}
                      className="flex-1 py-2 text-sm font-medium text-teal-600 border border-teal-200 rounded-xl"
                    >
                      🖨️ Receipt
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Order Card ─────────────────────────────────────────────────────────────────

function DeliveryTimeBadge() {
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    function load() { shopApi.getDeliveryTime().then(setInfo).catch(() => {}); }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!info) return null;

  const tierColor: Record<number, string> = {
    1: 'bg-green-50 text-green-700 border-green-200',
    2: 'bg-amber-50 text-amber-700 border-amber-200',
    3: 'bg-red-50 text-red-700 border-red-200',
  };
  const tierLabel: Record<number, string> = { 1: '🟢 Quiet', 2: '🟡 Busy', 3: '🔴 Very busy' };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${tierColor[info.tier] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      <span>{tierLabel[info.tier]}</span>
      <span>·</span>
      <span>{info.active_orders} active</span>
      <span>·</span>
      <span>Est. {info.label}</span>
    </div>
  );
}

function OrderCard({
  order,
  onStatusChange,
  onPaidChange,
  onRefresh,
  shopConfig,
  deliveryInfo,
}: {
  order: ShopOrder;
  onStatusChange: (id: string, s: string) => void;
  onPaidChange: (id: string, isPaid: boolean) => void;
  onRefresh: () => void;
  shopConfig?: any;
  deliveryInfo?: any;
}) {
  const [busy, setBusy] = useState(false);
  const [paidBusy, setPaidBusy] = useState(false);

  async function changeStatus(status: string) {
    if (status === 'picked_up' && order.source === 'manual' && !order.is_paid && shopConfig?.fiscal_enabled) {
      alert('Please mark this order as paid before moving to Picked Up.');
      return;
    }
    if (status === 'cancelled' && order.fiscal_status === 'fiscalized' && order.fiscal_fic) {
      const proceed = confirm(`Cancel order #${order.order_number}?\n\nThis order was fiscalized. An invoice correction will be submitted automatically.`);
      if (!proceed) return;
      setBusy(true);
      try {
        const corrResult = await shopApi.correctInvoice(order.id);
        if (!corrResult.success) {
          const forceProceed = confirm(`Invoice correction failed: ${corrResult.error}\n\nCancel order anyway?`);
          if (!forceProceed) { setBusy(false); return; }
        }
        await onStatusChange(order.id, status);
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try { await onStatusChange(order.id, status); } finally { setBusy(false); }
  }

  async function togglePaid() {
    setPaidBusy(true);
    try { await onPaidChange(order.id, !order.is_paid); } finally { setPaidBusy(false); }
  }

  const nextAction = order.status === 'new' ? { label: 'Start', next: 'in_progress', color: 'bg-amber-500 hover:bg-amber-600' }
    : order.status === 'in_progress' ? { label: 'Mark Ready', next: 'done', color: 'bg-green-500 hover:bg-green-600' }
    : order.status === 'done' ? { label: 'Picked Up', next: 'picked_up', color: 'bg-slate-500 hover:bg-slate-600' }
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-800">{order.order_number ? `#${String(order.order_number).padStart(3, '0')}` : ''}</span>
          {order.pickup_name && <span className="text-xs text-slate-500">· {order.pickup_name}</span>}
          {order.source === 'manual' && (
            <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium">Manual</span>
          )}
          {order.source === 'whatsapp' && (
            <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">WhatsApp</span>
          )}
          {order.source === 'qr' && (
            <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-medium">QR</span>
          )}
          {order.table_name && (
            <span className="text-xs bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">📍 {order.table_name}</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
      </div>

      {order.guest_phone && (
        <div className="text-xs text-slate-500">{order.guest_phone} · {timeAgo(order.created_at)}</div>
      )}
      {!order.guest_phone && (
        <div className="text-xs text-slate-400">{timeAgo(order.created_at)}</div>
      )}

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

      {order.status === 'new' && deliveryInfo && (
        <div className="text-xs text-slate-400">⏱ Est. {deliveryInfo.label}</div>
      )}

      {order.notes && !/^[0Oo]+$/.test(order.notes.trim()) && <div className="text-xs text-slate-400 italic">Note: {order.notes}</div>}

      {/* Pay & Fiscalize */}
      {shopConfig?.fiscal_enabled && !order.is_paid && order.status !== 'cancelled' && order.status !== 'picked_up' && (
        <div className="pt-2 border-t border-slate-100">
          <PayButton order={order} onRefresh={onRefresh} />
        </div>
      )}

      {/* Fiscal status badge */}
      {shopConfig?.fiscal_enabled && order.is_paid && (
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {order.fiscal_status === 'fiscalized' && (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
              ✓ Fiscalized · {order.fiscal_inv_num}
            </span>
          )}
          {order.fiscal_status === 'failed' && (
            <>
              <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">⚠️ Fiscal failed</span>
              <button
                onClick={() => shopApi.retryFiscal(order.id).then(onRefresh)}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                Retry
              </button>
            </>
          )}
          {order.fiscal_status === 'corrected' && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Corrected</span>
          )}
          {order.is_paid && order.paid_at && (
            <span className="text-xs text-slate-400 ml-auto">
              {new Date(order.paid_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {shopConfig?.fiscal_enabled && order.source === 'manual' && (order.status === 'in_progress' || order.status === 'done') && !order.is_paid && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={togglePaid}
            disabled={paidBusy}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ${
              order.is_paid ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {order.is_paid ? '✓ Paid' : '○ Mark as paid'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Manual Order Modal ─────────────────────────────────────────────────────────

function ManualOrderModal({
  onClose,
  onCreated,
  shopConfig,
  tables,
}: {
  onClose:    () => void;
  onCreated:  () => void;
  shopConfig: any;
  tables:     any[];
}) {
  const [items, setItems]             = useState<any[]>([]);
  const [cart, setCart]               = useState<{ item: any; qty: number }[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [pickupName, setPickupName]   = useState('');
  const [tableName, setTableName]     = useState('');
  const [notes, setNotes]             = useState('');
  const [step, setStep]               = useState<'browse' | 'cart'>('browse');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    shopApi.getItems().then(data => setItems(data.filter((i: any) => i.is_active)));
  }, []);

  const categories = [
    'all',
    ...Array.from(new Set(items.map((i: any) => i.category_name || 'Other'))),
  ];

  const visibleItems = selectedCat === 'all'
    ? items
    : items.filter((i: any) => (i.category_name || 'Other') === selectedCat);

  function addItem(item: any) {
    setCart(c => {
      const existing = c.find(ci => ci.item.id === item.id);
      if (existing) return c.map(ci => ci.item.id === item.id ? { ...ci, qty: ci.qty + 1 } : ci);
      return [...c, { item, qty: 1 }];
    });
  }

  function removeItem(itemId: string) {
    setCart(c => {
      const existing = c.find(ci => ci.item.id === itemId);
      if (!existing) return c;
      if (existing.qty === 1) return c.filter(ci => ci.item.id !== itemId);
      return c.map(ci => ci.item.id === itemId ? { ...ci, qty: ci.qty - 1 } : ci);
    });
  }

  function getQty(itemId: string) {
    return cart.find(ci => ci.item.id === itemId)?.qty || 0;
  }

  const total     = cart.reduce((s, ci) => s + ci.item.price * ci.qty, 0);
  const itemCount = cart.reduce((s, ci) => s + ci.qty, 0);

  async function placeOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      await shopApi.createManualOrder({
        items:       cart.map(ci => ({ item_id: ci.item.id, quantity: ci.qty })),
        pickup_name: pickupName || undefined,
        table_name:  tableName  || undefined,
        notes:       notes      || undefined,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create order');
      setSubmitting(false);
    }
  }

  function ItemCard({ item }: { item: any }) {
    const qty = getQty(item.id);
    return (
      <div
        className={`relative rounded-xl border-2 transition-all cursor-pointer select-none ${
          qty > 0 ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
        onClick={() => addItem(item)}
      >
        {!!shopConfig?.shop_photos_enabled && item.photo_url ? (
          <img src={item.photo_url} alt={item.name} className="w-full h-24 object-cover rounded-t-xl" />
        ) : (
          <div className="w-full h-24 bg-slate-100 rounded-t-xl flex items-center justify-center">
            <span className="text-3xl">🍽️</span>
          </div>
        )}
        <div className="p-2">
          <p className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2">{item.name}</p>
          <p className="text-xs font-bold text-teal-600 mt-1">{parseFloat(item.price).toLocaleString()} ALL</p>
        </div>
        {qty > 0 && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-teal-500 rounded-full px-1.5 py-0.5">
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.id); }}
              className="text-white text-xs leading-none w-4 h-4 flex items-center justify-center"
            >−</button>
            <span className="text-white text-xs font-bold">{qty}</span>
            <button
              onClick={e => { e.stopPropagation(); addItem(item); }}
              className="text-white text-xs leading-none w-4 h-4 flex items-center justify-center"
            >+</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-stretch justify-center">
      <div className="bg-white w-full max-w-4xl flex flex-col md:my-4 md:mx-4 md:rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 flex-1">New order</h2>
          {shopConfig?.qr_collect_table && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 whitespace-nowrap">Table</label>
              {tables.length > 0 ? (
                <select
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1"
                >
                  <option value="">— optional —</option>
                  {tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  placeholder="Optional"
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1 w-28"
                />
              )}
            </div>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-2">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT — Category sidebar (desktop) */}
          <div className="hidden md:flex flex-col w-44 border-r border-slate-100 flex-shrink-0 overflow-y-auto">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`text-left px-4 py-3 text-sm transition-colors border-l-2 ${
                  selectedCat === cat
                    ? 'border-teal-500 bg-teal-50 text-teal-700 font-medium'
                    : 'border-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat === 'all' ? 'All items' : cat}
                <span className="ml-1 text-xs text-slate-400">
                  ({cat === 'all' ? items.length : items.filter(i => (i.category_name || 'Other') === cat).length})
                </span>
              </button>
            ))}
          </div>

          {/* MOBILE — horizontal category tabs */}
          <div
            className="md:hidden absolute left-0 right-0 overflow-x-auto flex gap-1 px-3 py-2 bg-slate-50 border-b border-slate-100"
            style={{ top: '57px', zIndex: 10 }}
          >
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`whitespace-nowrap px-3 py-1.5 text-xs rounded-full flex-shrink-0 transition-colors ${
                  selectedCat === cat
                    ? 'bg-teal-500 text-white font-medium'
                    : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* CENTRE — Item grid (browse step) */}
          {step === 'browse' && (
            <div className="flex-1 overflow-y-auto p-3 pt-12 md:pt-3">
              {visibleItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-2xl mb-2">📭</p>
                  <p className="text-sm">No items in this category</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {visibleItems.map(item => <ItemCard key={item.id} item={item} />)}
                </div>
              )}
            </div>
          )}

          {/* CENTRE — Cart review (mobile step 2) */}
          {step === 'cart' && (
            <div className="flex-1 overflow-y-auto p-4">
              <button onClick={() => setStep('browse')} className="flex items-center gap-1 text-sm text-slate-500 mb-4">
                ← Back to menu
              </button>
              <div className="space-y-3">
                {cart.map(ci => (
                  <div key={ci.item.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-700">{ci.item.name}</p>
                      <p className="text-xs text-slate-400">{parseFloat(ci.item.price).toLocaleString()} ALL each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeItem(ci.item.id)} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">−</button>
                      <span className="text-sm font-bold w-4 text-center">{ci.qty}</span>
                      <button onClick={() => addItem(ci.item)} className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white">+</button>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 min-w-[65px] text-right">
                      {(parseFloat(ci.item.price) * ci.qty).toLocaleString()} ALL
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center px-3 py-3 mt-2 border-t border-slate-100">
                <span className="font-semibold text-slate-800">Total</span>
                <span className="text-xl font-black text-teal-600">{total.toLocaleString()} ALL</span>
              </div>
              <div className="space-y-2 mt-3">
                <input
                  type="text"
                  placeholder="Pickup name (optional)"
                  value={pickupName}
                  onChange={e => setPickupName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
                <textarea
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none"
                />
              </div>
              {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-3 py-2.5 mt-3">{error}</div>}
            </div>
          )}

          {/* RIGHT — Desktop cart panel */}
          <div className="hidden md:flex flex-col w-64 border-l border-slate-100 flex-shrink-0">
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {cart.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">Tap items to add them</p>
              ) : (
                cart.map(ci => (
                  <div key={ci.item.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{ci.item.name}</p>
                      <p className="text-xs text-slate-400">{(parseFloat(ci.item.price) * ci.qty).toLocaleString()} ALL</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => removeItem(ci.item.id)} className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 text-xs">−</button>
                      <span className="text-xs font-bold w-3 text-center">{ci.qty}</span>
                      <button onClick={() => addItem(ci.item)} className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs">+</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 && (
              <div className="border-t border-slate-100 p-3 space-y-2 flex-shrink-0">
                <div className="flex justify-between">
                  <span className="text-sm font-semibold text-slate-700">Total</span>
                  <span className="text-sm font-black text-teal-600">{total.toLocaleString()} ALL</span>
                </div>
                <input
                  type="text"
                  placeholder="Pickup name (optional)"
                  value={pickupName}
                  onChange={e => setPickupName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                />
                <textarea
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs resize-none"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={placeOrder}
                  disabled={submitting}
                  className="w-full py-2.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition-colors"
                >
                  {submitting ? 'Creating…' : `Place order · ${total.toLocaleString()} ALL`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* MOBILE — sticky bottom bar */}
        <div className="md:hidden border-t border-slate-100 p-3 flex-shrink-0">
          {step === 'browse' ? (
            cart.length > 0 ? (
              <button
                onClick={() => setStep('cart')}
                className="w-full py-3 bg-teal-500 text-white font-semibold rounded-xl text-sm"
              >
                View order · {itemCount} items · {total.toLocaleString()} ALL
              </button>
            ) : (
              <p className="text-center text-sm text-slate-400 py-1">Tap items to add to order</p>
            )
          ) : (
            <button
              onClick={placeOrder}
              disabled={submitting || cart.length === 0}
              className="w-full py-3 bg-teal-500 text-white font-semibold rounded-xl text-sm disabled:opacity-40"
            >
              {submitting ? 'Creating…' : `Place order · ${total.toLocaleString()} ALL`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Orders Tab ─────────────────────────────────────────────────────────────────

function OrdersTab() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [shopConfig, setShopConfig] = useState<ShopConfig | null>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showManualOrderModal, setShowManualOrderModal] = useState(false);
  const [deliveryInfo, setDeliveryInfo] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setOrders(await shopApi.getOrders('all', date)); }
    catch (e: any) { setLoadError(e.message ?? 'Failed to load orders'); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    shopApi.getConfig().then(setShopConfig).catch(() => {});
    shopApi.getTables().then(setTables).catch(() => {});
    shopApi.getDeliveryTime().then(setDeliveryInfo).catch(() => {});
  }, []);

  async function handleStatusChange(id: string, status: string) {
    await shopApi.updateOrderStatus(id, status);
    await load();
  }

  async function handlePaidChange(id: string, isPaid: boolean) {
    await shopApi.updateOrderPaid(id, isPaid);
    await load();
  }

  const cols = ['new', 'in_progress', 'done', 'picked_up'] as const;
  const byStatus = (s: string) => orders.filter((o) => o.status === s);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3 flex-wrap">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><RefreshCw size={15} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} /></button>
        <span className="text-xs text-slate-400">{orders.filter(o => o.status !== 'cancelled').length} orders</span>
        <DeliveryTimeBadge />
        {shopConfig?.manual_orders_enabled && (
          <button
            onClick={() => setShowManualOrderModal(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> New order
          </button>
        )}
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
                  : byStatus(col).map((o) => <OrderCard key={o.id} order={o} onStatusChange={handleStatusChange} onPaidChange={handlePaidChange} onRefresh={load} shopConfig={shopConfig} deliveryInfo={deliveryInfo} />)
                }
              </div>
            </div>
          ))}
        </div>
      )}

      {showManualOrderModal && (
        <ManualOrderModal
          onClose={() => setShowManualOrderModal(false)}
          onCreated={() => { setShowManualOrderModal(false); load(); }}
          shopConfig={shopConfig}
          tables={tables}
        />
      )}
    </div>
  );
}

// ── Item Form Modal ────────────────────────────────────────────────────────────

function ItemModal({
  item,
  categories,
  photosEnabled,
  onSave,
  onClose,
}: {
  item?: ShopItem | null;
  categories: ShopCategory[];
  photosEnabled?: boolean;
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
  const [vatRate, setVatRate] = useState(item?.vat_rate || 'VAT_20');
  const [itemCode, setItemCode] = useState(item?.item_code || '');
  const [unit, setUnit] = useState(item?.unit || 'XPP');
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
      form.append('vat_rate', vatRate);
      form.append('unit', unit);
      if (itemCode) form.append('item_code', itemCode);
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
          {/* Fiscal fields */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-500 font-medium">VAT Rate</label>
              <select value={vatRate} onChange={e => setVatRate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="VAT_20">20%</option>
                <option value="VAT_10">10%</option>
                <option value="VAT_6">6%</option>
                <option value="VAT_0">0%</option>
                <option value="EXEMPT">Exempt</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Item code</label>
              <input value={itemCode} onChange={e => setItemCode(e.target.value)}
                placeholder="e.g. 879899"
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Unit</label>
              <select value={unit} onChange={e => setUnit(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="XPP">Piece (XPP)</option>
                <option value="KGM">Kg (KGM)</option>
                <option value="LTR">Litre (LTR)</option>
                <option value="MTR">Metre (MTR)</option>
              </select>
            </div>
          </div>
          {photosEnabled && (
            <div>
              <label className="text-xs text-slate-500 font-medium">Photo</label>
              {item?.photo_url && !photo && (
                <img src={item.photo_url} alt="" className="mt-1 h-16 w-16 rounded-lg object-cover border border-slate-200" />
              )}
              <input type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] || null)} className="mt-1 w-full text-xs text-slate-500" />
            </div>
          )}
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
  const [photosEnabled, setPhotosEnabled] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [c, i, cfg] = await Promise.all([shopApi.getCategories(), shopApi.getItems(), shopApi.getConfig()]);
      setCategories(c); setItems(i);
      setPhotosEnabled(!!cfg.shop_photos_enabled);
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
              {photosEnabled && item.photo_url
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
        <ItemModal item={editItem} categories={categories} photosEnabled={photosEnabled} onSave={() => { setEditItem(undefined); load(); }} onClose={() => setEditItem(undefined)} />
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

function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: any; onChange: (v: boolean) => void }) {
  const on = Boolean(value);
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-teal-500' : 'bg-slate-200'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function ConfigTab() {
  const [cfg, setCfg]           = useState<Partial<ShopConfig>>({});
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [saved, setSaved]       = useState(false);
  const [configError, setConfigError] = useState('');
  const [tables, setTables]     = useState<any[]>([]);
  const [newTableName, setNewTableName] = useState('');
  const [bulkPrefix, setBulkPrefix] = useState('Table');
  const [bulkCount, setBulkCount]   = useState(10);
  const [showBulk, setShowBulk]     = useState(false);
  const [showTableQr, setShowTableQr] = useState<any>(null);
  const [middlewares, setMiddlewares] = useState<{ value: string; label: string }[]>([{ value: 'nexia', label: 'Nexia' }]);
  const logoRef                 = useRef<HTMLInputElement>(null);

  const origin = window.location.origin;

  useEffect(() => {
    shopApi.getConfig().then(c => { setCfg(c); setLoading(false); }).catch(() => setLoading(false));
    shopApi.getTables().then(setTables).catch(() => {});
    shopApi.getFiscalMiddlewares().then((list: any) => { if (Array.isArray(list)) setMiddlewares(list); }).catch(() => {});
  }, []);

  function set(key: keyof ShopConfig, value: any) { setCfg(prev => ({ ...prev, [key]: value })); }

  async function save() {
    setBusy(true); setConfigError('');
    try {
      await shopApi.putConfig(cfg);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setConfigError(e.message || 'Save failed');
    } finally { setBusy(false); }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await shopApi.uploadLogo(file);
      setCfg(prev => ({ ...prev, shop_logo_url: (res as any).logo_url }));
    } catch (e: any) { alert(e.message); }
  }

  async function removeLogo() {
    try { await shopApi.deleteLogo(); setCfg(prev => ({ ...prev, shop_logo_url: undefined, shop_logo_filename: undefined })); }
    catch (e: any) { alert(e.message); }
  }

  async function addTable() {
    if (!newTableName.trim()) return;
    try {
      const t = await shopApi.createTable({ name: newTableName.trim(), sort_order: tables.length });
      setTables(prev => [...prev, t]);
      setNewTableName('');
    } catch (e: any) { alert(e.message); }
  }

  async function bulkGenerate() {
    try {
      const created = await shopApi.bulkCreateTables(bulkCount, bulkPrefix);
      setTables(prev => {
        const existingIds = new Set(prev.map((t: any) => t.id));
        return [...prev, ...(created as any[]).filter((t: any) => !existingIds.has(t.id))];
      });
      setShowBulk(false);
    } catch (e: any) { alert(e.message); }
  }

  async function deleteTable(id: string) {
    if (!confirm('Delete this table?')) return;
    try { await shopApi.deleteTable(id); setTables(prev => prev.filter((t: any) => t.id !== id)); }
    catch (e: any) { alert(e.message); }
  }

  async function handleRegisterCashDeposit() {
    try {
      const result = await shopApi.registerCashDeposit(cfg.fiscal_initial_cash);
      if (result.Status === true) alert('Cash deposit registered successfully.');
      else alert(`Failed: ${result.Error?.ErrorText || JSON.stringify(result)}`);
    } catch (e: any) { alert(e.message); }
  }

  function downloadQr(id: string, name: string) {
    const canvas = document.getElementById(`qr-${id}`) as HTMLCanvasElement;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `qr-${name.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
  }

  if (loading) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Loading…</div>;

  const slugUrl = cfg.qr_slug ? `${origin}/shop/${cfg.qr_slug}` : '';

  return (
    <div className="max-w-lg space-y-5 overflow-y-auto h-full">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h4 className="font-medium text-slate-800">Shop Settings</h4>
        <Field label="Shop Name" value={cfg.shop_name || ''} onChange={v => set('shop_name', v)} placeholder="My Shop" />
        <Field label="Opening Hours" value={cfg.opening_hours || ''} onChange={v => set('opening_hours', v)} placeholder="Mon–Sat 9:00–20:00" />
        <Field label="Address" value={cfg.address || ''} onChange={v => set('address', v)} placeholder="Street, City" />
        <Field label="Phone" value={cfg.phone || ''} onChange={v => set('phone', v)} placeholder="+355 69 123 4567" />
        <div className="space-y-3">
          <div>
            <h5 className="text-xs text-slate-500 font-medium mb-0.5">Estimated delivery time</h5>
            <p className="text-xs text-slate-400">Set different times based on how busy the shop is. Active orders = New + In Progress.</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-green-700 mb-2">🟢 Tier 1 — Quiet</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-green-600">0 to</span>
              <input type="number" value={cfg.delivery_threshold_1 ?? 5} onChange={e => set('delivery_threshold_1', +e.target.value)} min={1}
                className="w-16 rounded-lg border border-green-200 px-2 py-1.5 text-sm text-center bg-white" />
              <span className="text-xs text-green-600">active orders →</span>
              <input type="number" value={cfg.delivery_time_1 ?? 15} onChange={e => set('delivery_time_1', +e.target.value)} min={1}
                className="w-16 rounded-lg border border-green-200 px-2 py-1.5 text-sm text-center bg-white" />
              <span className="text-xs text-green-600">min</span>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-700 mb-2">🟡 Tier 2 — Busy</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-amber-600">{cfg.delivery_threshold_1 ?? 5} to</span>
              <input type="number" value={cfg.delivery_threshold_2 ?? 15} onChange={e => set('delivery_threshold_2', +e.target.value)} min={(cfg.delivery_threshold_1 ?? 5) + 1}
                className="w-16 rounded-lg border border-amber-200 px-2 py-1.5 text-sm text-center bg-white" />
              <span className="text-xs text-amber-600">active orders →</span>
              <input type="number" value={cfg.delivery_time_2 ?? 30} onChange={e => set('delivery_time_2', +e.target.value)} min={1}
                className="w-16 rounded-lg border border-amber-200 px-2 py-1.5 text-sm text-center bg-white" />
              <span className="text-xs text-amber-600">min</span>
            </div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700 mb-2">🔴 Tier 3 — Very busy</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-600">{cfg.delivery_threshold_2 ?? 15}+ active orders →</span>
              <input type="number" value={cfg.delivery_time_3 ?? 45} onChange={e => set('delivery_time_3', +e.target.value)} min={1}
                className="w-16 rounded-lg border border-red-200 px-2 py-1.5 text-sm text-center bg-white" />
              <span className="text-xs text-red-600">min</span>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-600">Summary</p>
            <p>0–{cfg.delivery_threshold_1 ?? 5} orders → {cfg.delivery_time_1 ?? 15} min</p>
            <p>{cfg.delivery_threshold_1 ?? 5}–{cfg.delivery_threshold_2 ?? 15} orders → {cfg.delivery_time_2 ?? 30} min</p>
            <p>{cfg.delivery_threshold_2 ?? 15}+ orders → {cfg.delivery_time_3 ?? 45} min</p>
          </div>
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
          <textarea rows={2} value={cfg.fallback_message || ''} onChange={e => set('fallback_message', e.target.value)}
            placeholder="We are temporarily unable to process your order online."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
          <p className="text-xs text-slate-400">Shown to guest when the AI encounters an error</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Backup WhatsApp number</label>
          <input type="text" value={cfg.fallback_backup_number || ''} onChange={e => set('fallback_backup_number', e.target.value)}
            placeholder="+355691234567" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <p className="text-xs text-slate-400">Shared with guest when error threshold is reached. Leave empty to not share.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Share backup number after</label>
          <select value={cfg.fallback_after_attempts ?? 1} onChange={e => set('fallback_after_attempts', parseInt(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
            <option value={1}>1st error (immediately)</option>
            <option value={2}>2nd consecutive error</option>
            <option value={3}>3rd consecutive error</option>
          </select>
        </div>
        {cfg.fallback_backup_number && (
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-1">Preview — after {cfg.fallback_after_attempts ?? 1} error(s):</p>
            <p className="text-xs text-slate-700 whitespace-pre-wrap">
              {cfg.fallback_message || 'We are temporarily unable to process your order online.'}
              {'\n\nPlease contact us directly on WhatsApp:\n📱 '}{cfg.fallback_backup_number}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h4 className="font-medium text-slate-800">Order Settings</h4>
        <Toggle
          label="Manual order creation"
          desc="Allow staff to create orders directly from the dashboard"
          value={cfg.manual_orders_enabled}
          onChange={v => set('manual_orders_enabled', v)}
        />
      </div>

      {/* QR Self-Ordering */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <QrCode size={16} className="text-teal-600" />
          <h4 className="font-medium text-slate-800">QR Self-Ordering</h4>
        </div>
        <Toggle
          label="Enable QR ordering"
          desc="Let customers scan a QR code to order directly from their phone"
          value={cfg.qr_ordering_enabled}
          onChange={v => set('qr_ordering_enabled', v)}
        />

        {cfg.qr_ordering_enabled ? (
          <>
            <div>
              <label className="text-xs text-slate-500 font-medium">Shop URL slug *</label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-slate-400 whitespace-nowrap">{origin}/shop/</span>
                <input
                  value={cfg.qr_slug || ''}
                  onChange={e => set('qr_slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))}
                  placeholder="my-shop-name"
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm min-w-0"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">Used in QR codes and the ordering URL. Cannot be changed after sharing.</p>
            </div>

            <Toggle label="Ask customer for name" value={cfg.qr_collect_name ?? 1} onChange={v => set('qr_collect_name', v)} />
            <Toggle label="Enable table QR codes" value={cfg.qr_collect_table} onChange={v => set('qr_collect_table', v)} />

            <div>
              <label className="text-xs text-slate-500 font-medium">Welcome message</label>
              <textarea rows={2} value={cfg.qr_welcome_message || ''} onChange={e => set('qr_welcome_message', e.target.value)}
                placeholder="Welcome! Please enter your name to start ordering."
                className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
            </div>

            {/* Logo upload */}
            <div>
              <label className="text-xs text-slate-500 font-medium">Shop logo (shown on ordering page)</label>
              {cfg.shop_logo_url ? (
                <div className="flex items-center gap-3 mt-1 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  <img src={cfg.shop_logo_url} alt="Logo" className="h-10 object-contain" />
                  <button onClick={removeLogo} className="text-xs text-red-400 hover:text-red-600 ml-auto">Remove</button>
                </div>
              ) : (
                <div onClick={() => logoRef.current?.click()}
                  className="mt-1 border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-teal-400 transition-colors">
                  <p className="text-xs text-slate-400">Click to upload logo · PNG, JPG, WebP · max 5 MB</p>
                </div>
              )}
              <input ref={logoRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleLogoUpload} />
            </div>

            {/* QR code display */}
            {cfg.qr_slug && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <p className="text-xs font-medium text-slate-600 mb-3">Shop QR Code</p>
                <div className="flex items-start gap-4">
                  <QRCodeCanvas id="qr-shop" value={slugUrl} size={100} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 break-all mb-2">{slugUrl}</p>
                    <button onClick={() => downloadQr('shop', cfg.qr_slug!)}
                      className="text-xs font-medium text-teal-600 hover:text-teal-700">
                      ↓ Download PNG
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-400">Enable QR ordering to configure the self-service menu and generate QR codes.</p>
        )}
      </div>

      {/* Tables section */}
      {cfg.qr_ordering_enabled && cfg.qr_collect_table && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-slate-800">Tables</h4>
            <div className="flex gap-3">
              <button onClick={() => setShowBulk(b => !b)} className="text-xs text-slate-500 hover:text-slate-700">Bulk generate</button>
              <button onClick={() => setNewTableName('+')} className="text-xs font-medium text-teal-600 hover:text-teal-700">+ Add table</button>
            </div>
          </div>

          {showBulk && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-xs font-medium text-slate-600 mb-2">Bulk generate tables</p>
              <div className="flex items-center gap-2">
                <input value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)} placeholder="Prefix"
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                <input type="number" value={bulkCount} onChange={e => setBulkCount(+e.target.value)} min={1} max={100}
                  className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                <button onClick={bulkGenerate}
                  className="text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600">
                  Generate
                </button>
              </div>
            </div>
          )}

          {newTableName !== '' && (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newTableName === '+' ? '' : newTableName}
                onChange={e => setNewTableName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTable(); if (e.key === 'Escape') setNewTableName(''); }}
                placeholder="Table name"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
              <button onClick={addTable} className="text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg">Add</button>
              <button onClick={() => setNewTableName('')} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          )}

          <div className="space-y-2">
            {tables.map((table: any) => (
              <div key={table.id} className="flex items-center gap-3 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-700 flex-1">{table.name}</span>
                <button onClick={() => setShowTableQr(table)} className="text-xs text-teal-600 hover:text-teal-700">Show QR</button>
                <button onClick={() => deleteTable(table.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
              </div>
            ))}
            {tables.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No tables yet. Add tables above.</p>}
          </div>
        </div>
      )}

      {/* Inventory Module */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h4 className="font-medium text-slate-800">Inventory Module</h4>
          <p className="text-xs text-slate-400 mt-0.5">Track ingredients, recipes, and stock levels</p>
        </div>
        <Toggle label="Enable inventory module" value={cfg.inventory_enabled} onChange={v => set('inventory_enabled', v)} />
        {cfg.inventory_enabled ? (
          <>
            <div>
              <label className="text-xs font-medium text-slate-500">Low-stock alert mode</label>
              <div className="flex gap-2 mt-1">
                {([['immediate', 'Immediate (on each order)'], ['daily', 'Daily digest']] as const).map(([val, lbl]) => (
                  <button key={val}
                    onClick={() => set('inventory_alert_mode', val)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      (cfg.inventory_alert_mode ?? 'daily') === val
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            {(cfg.inventory_alert_mode ?? 'daily') === 'daily' && (
              <div>
                <label className="text-xs font-medium text-slate-500">Daily digest time (Europe/Tirane)</label>
                <input
                  type="time" value={cfg.inventory_alert_time ?? '09:00'}
                  onChange={e => set('inventory_alert_time', e.target.value)}
                  className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}
            <Toggle
              label="Send low-stock alerts via WhatsApp"
              desc="Uses the backup WhatsApp number configured above"
              value={cfg.inventory_alert_whatsapp}
              onChange={v => set('inventory_alert_whatsapp', v)}
            />
          </>
        ) : (
          <p className="text-xs text-slate-400">Enable inventory to configure stock alerts and recipe tracking.</p>
        )}
      </div>

      {configError && <p className="text-xs text-red-500">{configError}</p>}

      <button onClick={save} disabled={busy} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">
        {busy ? 'Saving…' : saved ? <><Check size={14} /> Saved!</> : 'Save Settings'}
      </button>

      {/* Table QR modal */}
      {/* Fiscalization */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h4 className="font-medium text-slate-800">Fiscalization</h4>
          <p className="text-xs text-slate-400 mt-0.5">Albanian e-Fiskalizimi integration</p>
        </div>
        <Toggle label="Enable fiscalization" value={cfg.fiscal_enabled} onChange={v => set('fiscal_enabled', v)} />
        {cfg.fiscal_enabled ? (
          <>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Fiscal middleware</label>
              <select
                value={cfg.fiscal_middleware || 'nexia'}
                onChange={e => set('fiscal_middleware', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {middlewares.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Select the fiscal middleware provider for this shop</p>
            </div>
            <div className="flex gap-3">
              {(['test', 'production'] as const).map(env => (
                <button
                  key={env}
                  onClick={() => set('fiscal_environment', env)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    (cfg.fiscal_environment || 'test') === env
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  {env === 'test' ? '🧪 Test' : '🏦 Production'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Username</label>
                <input value={cfg.fiscal_username || ''} onChange={e => set('fiscal_username', e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Password</label>
                <input type="password" value={cfg.fiscal_password || ''} onChange={e => set('fiscal_password', e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">NUIS</label>
                <input value={cfg.fiscal_nuis || ''} onChange={e => set('fiscal_nuis', e.target.value)}
                  placeholder="e.g. L82210031Q"
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">TCR Code</label>
                <input value={cfg.fiscal_tcr_code || ''} onChange={e => set('fiscal_tcr_code', e.target.value)}
                  placeholder="e.g. xv496nk445"
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Business Unit Code</label>
                <input value={cfg.fiscal_busun_code || ''} onChange={e => set('fiscal_busun_code', e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Software Code</label>
                <input value={cfg.fiscal_soft_code || ''} onChange={e => set('fiscal_soft_code', e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Default client name</label>
                <input value={cfg.fiscal_default_client || 'Klient i Pergjithshem'}
                  onChange={e => set('fiscal_default_client', e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Initial cash deposit (ALL)</label>
                <input type="number" value={cfg.fiscal_initial_cash ?? 0}
                  onChange={e => set('fiscal_initial_cash', +e.target.value)}
                  className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
              </div>
            </div>
            <button
              onClick={handleRegisterCashDeposit}
              className="text-xs font-medium px-3 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
            >
              Register today's cash deposit ({cfg.fiscal_initial_cash || 0} ALL)
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-400">Enable fiscalization to configure the Albanian e-Fiskalizimi integration.</p>
        )}
      </div>

      {showTableQr && cfg.qr_slug && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <h3 className="text-base font-semibold text-slate-800 mb-1">{showTableQr.name}</h3>
            <p className="text-xs text-slate-400 mb-4 break-all">
              {origin}/shop/{cfg.qr_slug}/table/{showTableQr.id}
            </p>
            <div className="flex justify-center mb-4">
              <QRCodeCanvas
                id={`qr-${showTableQr.id}`}
                value={`${origin}/shop/${cfg.qr_slug}/table/${showTableQr.id}`}
                size={180}
              />
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => downloadQr(showTableQr.id, showTableQr.name)}
                className="text-sm font-medium px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600">
                ↓ Download PNG
              </button>
              <button onClick={() => setShowTableQr(null)}
                className="text-sm px-4 py-2 text-slate-500 hover:bg-slate-50 rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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

type Tab = 'orders' | 'menu' | 'conversations' | 'faq' | 'config' | 'reports' | 'users' | 'inventory';

interface TabDef { id: Tab; label: string; icon: React.ReactNode; roles: string[] }

const TABS: TabDef[] = [
  { id: 'orders',        label: 'Orders',   icon: <ShoppingBag size={16} />, roles: ['operator','supervisor','admin'] },
  { id: 'conversations', label: 'Chats',    icon: <MessageSquare size={16} />, roles: ['operator','supervisor','admin'] },
  { id: 'menu',          label: 'Menu',     icon: <Package size={16} />, roles: ['supervisor','admin'] },
  { id: 'faq',           label: 'FAQ',      icon: <HelpCircle size={16} />, roles: ['supervisor','admin'] },
  { id: 'reports',       label: 'Reports',  icon: <BarChart2 size={16} />, roles: ['admin'] },
  { id: 'inventory',     label: 'Inventory', icon: <Boxes size={16} />, roles: ['admin'] },
  { id: 'config',        label: 'Settings', icon: <Settings size={16} />, roles: ['admin'] },
  { id: 'users',         label: 'Users',    icon: <Users size={16} />, roles: ['admin'] },
];

// ── Staff Login Modal ──────────────────────────────────────────────────────────

function StaffLoginModal({ tenantId, onLogin, onClose }: {
  tenantId: string;
  onLogin: (user: any, token: string) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true); setError('');
    try {
      const result = await shopApi.shopLogin(username.trim().toLowerCase(), password, tenantId);
      localStorage.setItem('shopUserToken', result.token);
      localStorage.setItem('shopUser', JSON.stringify(result.user));
      onLogin(result.user, result.token);
    } catch (e: any) {
      setError(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Staff sign in</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="text-xs font-medium text-slate-600">Username</label>
            <input
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="e.g. artan.hoxha"
              className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!username || !password || busy}
            className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export function ShopDashboard({ onLogout, tenantId }: { onLogout: () => void; tenantId?: string }) {
  const [tab, setTab]               = useState<Tab>('orders');
  const [showStaffLogin, setShowStaffLogin] = useState(false);

  // Shop sub-user state
  const [shopUser, setShopUser] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem('shopUser') || 'null'); } catch { return null; }
  });
  const role = (shopUser?.role as string) || 'admin';

  // Tenant ID for staff login: prop (super_admin) takes priority, then stored user's tenant
  const storedMainUser = getStoredUser();
  const loginTenantId = tenantId || storedMainUser?.tenantId || '';

  // Filter tabs by role
  const visibleTabs = TABS.filter(t => t.roles.includes(role));

  // When role changes (login/logout), make sure current tab is still accessible
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === tab)) setTab('orders');
  }, [role]);

  // When super_admin views a specific shop, inject tenantId into all API requests
  useEffect(() => {
    setViewTenantId(tenantId ?? null);
    return () => setViewTenantId(null);
  }, [tenantId]);

  function signOutStaff() {
    localStorage.removeItem('shopUserToken');
    localStorage.removeItem('shopUser');
    setShopUser(null);
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 flex items-center gap-1">
        <div className="flex items-center gap-2 py-3 mr-4">
          <ShoppingBag size={18} className="text-brand-600" />
          <span className="font-semibold text-slate-800 text-sm">Shop</span>
        </div>
        {visibleTabs.map(t => (
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

        {/* Right side: staff user info OR staff sign-in link + main logout */}
        <div className="ml-auto flex items-center gap-3">
          {shopUser ? (
            <>
              <span className="text-sm font-medium text-slate-700">{shopUser.name} {shopUser.surname}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                role === 'admin'      ? 'bg-purple-50 text-purple-700' :
                role === 'supervisor' ? 'bg-blue-50 text-blue-700' :
                                        'bg-slate-100 text-slate-600'
              }`}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </span>
              <button onClick={signOutStaff} className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
                Sign out staff
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowStaffLogin(true)}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              Staff sign in
            </button>
          )}
          <button onClick={onLogout} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors py-3 px-1">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden p-4">
        {tab === 'orders'        && <OrdersTab />}
        {tab === 'conversations' && <ConversationsTab />}
        {tab === 'menu'          && <MenuTab />}
        {tab === 'faq'           && <FaqTab />}
        {tab === 'reports'       && <ShopReports />}
        {tab === 'inventory'     && <ShopInventory />}
        {tab === 'config'        && <ConfigTab />}
        {tab === 'users'         && <ShopUsers />}
      </div>

      {showStaffLogin && loginTenantId && (
        <StaffLoginModal
          tenantId={loginTenantId}
          onLogin={(user) => { setShopUser(user); setShowStaffLogin(false); }}
          onClose={() => setShowStaffLogin(false)}
        />
      )}
    </div>
  );
}
