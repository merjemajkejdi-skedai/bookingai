import { useState, useEffect, useRef, useCallback } from 'react';
import { shopPublicApi } from '../modules/shop/api';

type PageState = 'loading' | 'name-input' | 'menu' | 'confirming' | 'success' | 'expired' | 'error';

export function ShopOrderPage({ slug, tableId }: { slug: string; tableId?: string }) {
  const [state, setState]           = useState<PageState>('loading');
  const [shopInfo, setShopInfo]     = useState<any>(null);
  const [tableInfo, setTableInfo]   = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart]             = useState<{ item: any; qty: number; hours?: number }[]>([]);
  const [placedOrder, setPlacedOrder] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [deliveryInfo, setDeliveryInfo] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const sessionId                   = useRef(crypto.randomUUID());
  const inactivityTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => setState('expired'), 20 * 60 * 1000);
  }, []);

  useEffect(() => {
    if (state === 'menu' || state === 'confirming') {
      resetTimer();
      window.addEventListener('touchstart', resetTimer);
      window.addEventListener('click', resetTimer);
      return () => {
        window.removeEventListener('touchstart', resetTimer);
        window.removeEventListener('click', resetTimer);
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      };
    }
  }, [state, resetTimer]);

  useEffect(() => {
    async function load() {
      try {
        const [shopRes, deliveryRes] = await Promise.all([
          shopPublicApi.getShop(slug),
          shopPublicApi.getDeliveryTime(slug).catch(() => null),
        ]);
        if (!shopRes.success) { setState('error'); return; }
        setShopInfo(shopRes.data);
        if (deliveryRes && deliveryRes.minutes) setDeliveryInfo(deliveryRes);
        if (tableId) {
          const tr = await shopPublicApi.getTable(slug, tableId);
          if (tr.success) setTableInfo(tr.data);
        }
        const nextState = shopRes.data.qr_collect_name ? 'name-input' : 'menu';
        setState(nextState);
        if (nextState === 'menu') setSelectedCategory('all');
      } catch {
        setState('error');
      }
    }
    load();
  }, [slug, tableId]);

  function addToCart(item: any, qty = 1, hours?: number) {
    setCart(c => {
      if (item.pricing_type === 'hourly') {
        const ex = c.find(ci => ci.item.id === item.id);
        if (ex) return c.map(ci => ci.item.id === item.id ? { ...ci, qty, hours: hours ?? 1 } : ci);
        return [...c, { item, qty, hours: hours ?? 1 }];
      }
      const ex = c.find(ci => ci.item.id === item.id);
      if (ex) return c.map(ci => ci.item.id === item.id ? { ...ci, qty: ci.qty + qty } : ci);
      return [...c, { item, qty }];
    });
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) setCart(c => c.filter(ci => ci.item.id !== itemId));
    else setCart(c => c.map(ci => ci.item.id === itemId ? { ...ci, qty } : ci));
  }

  function cartLineTotal(ci: { item: any; qty: number; hours?: number }) {
    const price = parseFloat(ci.item.price);
    return ci.item.pricing_type === 'hourly' ? price * ci.qty * (ci.hours ?? 1) : price * ci.qty;
  }

  const total = cart.reduce((sum, ci) => sum + cartLineTotal(ci), 0);

  async function placeOrder() {
    setSubmitting(true);
    setError('');
    try {
      const res = await shopPublicApi.placeOrder(slug, {
        customer_name: customerName || undefined,
        table_name:    tableInfo?.name || undefined,
        items:         cart.map(ci => ({
          item_id:      ci.item.id,
          quantity:     ci.qty,
          ...(ci.item.pricing_type === 'hourly' ? { rental_hours: ci.hours ?? 1 } : {}),
        })),
        qr_session:    sessionId.current,
      });
      if (!res.success) throw new Error(res.error || 'Failed to place order');
      setPlacedOrder(res.data);
      if (res.data?.estimated_minutes) setDeliveryInfo({ minutes: res.data.estimated_minutes, label: res.data.delivery_label });
      setState('success');
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  // ── Rental item card ─────────────────────────────────────────────────────────

  function RentalItemCard({ item }: { item: any }) {
    const inCart = cart.find(ci => ci.item.id === item.id);
    const [qty, setQty]     = useState(inCart?.qty ?? 1);
    const [hours, setHours] = useState(inCart?.hours ?? 1);
    const lineTotal = parseFloat(item.price) * qty * hours;
    return (
      <div className="col-span-2 sm:col-span-3 md:col-span-4 bg-white rounded-xl border-2 border-slate-200 p-4 space-y-3">
        <div className="flex gap-3">
          {!!shopInfo?.shop_photos_enabled && item.photo_url ? (
            <img src={item.photo_url} alt={item.name} className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 text-sm">{item.name}</p>
            {item.description && <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-sm font-bold text-teal-600">{parseFloat(item.price).toLocaleString()} {item.currency}</span>
              <span className="text-xs text-slate-400">/ orë</span>
              <span className="ml-auto text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">⏱ Qira</span>
            </div>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <p className="text-xs font-medium text-slate-600">Sa orë? (min. 1)</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setHours(h => Math.max(1, h - 1))}
                className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 text-lg flex items-center justify-center">−</button>
              <span className="w-6 text-center font-bold text-slate-800 text-sm">{hours}</span>
              <button onClick={() => setHours(h => h + 1)}
                className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 text-lg flex items-center justify-center">+</button>
              <span className="text-xs text-slate-400 ml-1">orë</span>
            </div>
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-xs font-medium text-slate-600">Sasi</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setQty(q => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 text-lg flex items-center justify-center">−</button>
              <span className="w-6 text-center font-bold text-slate-800 text-sm">{qty}</span>
              <button onClick={() => setQty(q => q + 1)}
                className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 text-lg flex items-center justify-center">+</button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
          <span className="text-xs text-slate-500">{qty} × {hours} orë × {parseFloat(item.price).toLocaleString()} {item.currency}</span>
          <span className="text-sm font-bold text-slate-800">{lineTotal.toLocaleString()} {item.currency}</span>
        </div>
        <button onClick={() => { addToCart(item, qty, hours); resetTimer(); }}
          className={`w-full py-2.5 text-sm font-semibold rounded-xl transition-colors ${
            inCart ? 'bg-teal-600 text-white' : 'bg-teal-500 text-white hover:bg-teal-600'
          }`}>
          {inCart ? '✓ Përditëso porosinë' : 'Shto në porosi'}
        </button>
      </div>
    );
  }

  // ── States ────────────────────────────────────────────────────────────────────

  if (state === 'loading') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading menu…</p>
      </div>
    </div>
  );

  if (state === 'error') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-3xl mb-3">😕</p>
        <p className="text-slate-700 font-semibold">Shop not found</p>
        <p className="text-sm text-slate-400 mt-1">Please scan the QR code again</p>
      </div>
    </div>
  );

  if (state === 'expired') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-4xl mb-3">⏱</p>
        <p className="text-slate-700 font-semibold text-lg">Session expired</p>
        <p className="text-sm text-slate-400 mt-2 mb-4">20 minutes of inactivity</p>
        <p className="text-sm text-slate-500">Scan the QR code again to start a new order.</p>
      </div>
    </div>
  );

  if (state === 'success' && placedOrder) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-lg">
        {shopInfo?.shop_logo_url && (
          <img src={shopInfo.shop_logo_url} alt="Logo" className="h-12 object-contain mx-auto mb-4" />
        )}
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Order placed!</h2>
        {deliveryInfo && placedOrder?.pickup_mode !== 'notify_when_ready' ? (
          <p className="text-slate-500 text-sm mb-6">Ready in approximately <span className="font-semibold text-teal-600">{deliveryInfo.label}</span></p>
        ) : placedOrder?.pickup_mode === 'notify_when_ready' ? (
          <p className="text-slate-500 text-sm mb-6">We'll notify you when your order is ready 📱</p>
        ) : (
          <p className="text-slate-500 text-sm mb-6">{shopInfo?.shop_name} will prepare your order shortly.</p>
        )}
        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400 mb-1">Your order number</p>
          <p className="text-4xl font-black text-teal-600">#{placedOrder.order_number}</p>
          {placedOrder.customer_name && placedOrder.customer_name !== 'Walk-in' && (
            <p className="text-sm text-slate-500 mt-1">{placedOrder.customer_name}</p>
          )}
          {placedOrder.table_name && (
            <p className="text-sm text-slate-500">📍 {placedOrder.table_name}</p>
          )}
        </div>
        <div className="text-left space-y-1 mb-4">
          {cart.map(ci => (
            <div key={ci.item.id} className="flex justify-between text-sm">
              <span className="text-slate-600">
                {ci.item.name} × {ci.qty}
                {ci.item.pricing_type === 'hourly' && <span className="text-blue-500 ml-1">× {ci.hours ?? 1}h</span>}
              </span>
              <span className="text-slate-700 font-medium">{cartLineTotal(ci).toLocaleString()} ALL</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-100">
            <span>Total</span>
            <span className="text-teal-600">{placedOrder.total.toLocaleString()} ALL</span>
          </div>
        </div>
        <p className="text-xs text-slate-400">Payment at pickup · Please keep your order number</p>
      </div>
    </div>
  );

  if (state === 'name-input') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
        {shopInfo?.shop_logo_url && (
          <img src={shopInfo.shop_logo_url} alt="Logo" className="h-10 object-contain mx-auto mb-4" />
        )}
        <h1 className="text-xl font-bold text-slate-800 text-center mb-1">{shopInfo?.shop_name}</h1>
        {tableInfo && <p className="text-sm text-teal-600 text-center font-medium mb-3">📍 {tableInfo.name}</p>}
        <p className="text-sm text-slate-500 text-center mb-6">
          {shopInfo?.qr_welcome_message || 'Welcome! Please enter your name to start ordering.'}
        </p>
        <input
          type="text"
          placeholder="Your name"
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && customerName.trim() && setState('menu')}
          autoFocus
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base mb-4 focus:outline-none focus:border-teal-400"
        />
        <button
          onClick={() => { setState('menu'); setSelectedCategory('all'); }}
          disabled={!customerName.trim()}
          className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white font-semibold rounded-xl disabled:opacity-40 transition-colors"
        >
          View Menu →
        </button>
      </div>
    </div>
  );

  // ── Menu ──────────────────────────────────────────────────────────────────────

  const categories = [
    'all',
    ...Array.from(new Set((shopInfo?.items || []).map((i: any) => i.category_name || 'Other'))),
  ] as string[];

  const visibleItems = selectedCategory === 'all'
    ? (shopInfo?.items || [])
    : (shopInfo?.items || []).filter((i: any) => (i.category_name || 'Other') === selectedCategory);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Sticky header */}
      <div className="bg-white sticky top-0 z-10 shadow-sm flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-3">
          {shopInfo?.shop_logo_url && (
            <img src={shopInfo.shop_logo_url} alt="Logo" className="h-8 object-contain flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-800 truncate">{shopInfo?.shop_name}</h1>
            {(tableInfo || customerName) && (
              <p className="text-xs text-slate-400">
                {tableInfo?.name}{tableInfo?.name && customerName ? ' · ' : ''}{customerName}
              </p>
            )}
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setState('confirming')}
              className="flex items-center gap-1.5 bg-teal-500 text-white px-3 py-1.5 rounded-xl text-sm font-medium flex-shrink-0"
            >
              🛒 {cart.reduce((s, ci) => s + ci.qty, 0)} · {total.toLocaleString()} ALL
            </button>
          )}
        </div>
      </div>

      {/* Menu */}
      {state === 'menu' && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT — Category sidebar (desktop) */}
          <div
            className="hidden sm:flex flex-col w-36 bg-white border-r border-slate-100 flex-shrink-0 overflow-y-auto sticky top-[57px]"
            style={{ height: 'calc(100vh - 57px)' }}
          >
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`text-left px-3 py-3 text-sm border-l-2 transition-colors ${
                  selectedCategory === cat
                    ? 'border-teal-500 bg-teal-50 text-teal-700 font-medium'
                    : 'border-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* TOP — Category tabs (mobile) */}
          <div
            className="sm:hidden fixed left-0 right-0 overflow-x-auto flex gap-1.5 px-3 py-2 bg-white border-b border-slate-100 shadow-sm z-10"
            style={{ top: '57px' }}
          >
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-3 py-1.5 text-xs rounded-full flex-shrink-0 transition-colors ${
                  selectedCategory === cat
                    ? 'bg-teal-500 text-white font-semibold'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* RIGHT — Item grid */}
          <div className="flex-1 overflow-y-auto p-3 sm:pt-3 pt-14 pb-28">
            {visibleItems.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <p className="text-2xl mb-2">📭</p>
                <p className="text-sm">No items available</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {visibleItems.map((item: any) => {
                  if (item.pricing_type === 'hourly') {
                    return <RentalItemCard key={item.id} item={item} />;
                  }
                  const inCart = cart.find(ci => ci.item.id === item.id);
                  const qty    = inCart?.qty || 0;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { addToCart(item); resetTimer(); }}
                      className={`relative rounded-xl border-2 cursor-pointer select-none transition-all active:scale-95 ${
                        qty > 0 ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      {!!shopInfo?.shop_photos_enabled && item.photo_url ? (
                        <img src={item.photo_url} alt={item.name} className="w-full h-28 object-cover rounded-t-xl" />
                      ) : (
                        <div className="w-full h-28 bg-slate-100 rounded-t-xl flex items-center justify-center">
                          <span className="text-4xl">🛍️</span>
                        </div>
                      )}
                      <div className="p-2.5">
                        <p className="text-xs font-semibold text-slate-800 line-clamp-2 leading-tight mb-1">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-slate-400 line-clamp-1 mb-1">{item.description}</p>
                        )}
                        <p className="text-sm font-bold text-teal-600">
                          {parseFloat(item.price).toLocaleString()} {item.currency}
                        </p>
                      </div>
                      {qty > 0 && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-teal-500 rounded-full shadow px-1.5 py-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); updateQty(item.id, qty - 1); }}
                            className="text-white text-sm w-5 h-5 flex items-center justify-center"
                          >−</button>
                          <span className="text-white text-xs font-bold">{qty}</span>
                          <button
                            onClick={e => { e.stopPropagation(); addToCart(item); }}
                            className="text-white text-sm w-5 h-5 flex items-center justify-center"
                          >+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order confirmation */}
      {state === 'confirming' && (
        <div className="max-w-lg mx-auto p-4 pb-8">
          <button onClick={() => setState('menu')} className="flex items-center gap-1 text-sm text-slate-500 mb-4">
            ← Back to menu
          </button>
          <h2 className="text-lg font-bold text-slate-800 mb-4">Your order</h2>
          <div className="bg-white rounded-2xl p-4 mb-4 space-y-3">
            {cart.map(ci => (
              <div key={ci.item.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{ci.item.name}</p>
                  {ci.item.pricing_type === 'hourly' ? (
                    <p className="text-xs text-blue-500">{ci.hours ?? 1} orë × {parseFloat(ci.item.price).toLocaleString()} ALL/orë</p>
                  ) : (
                    <p className="text-xs text-slate-400">{parseFloat(ci.item.price).toLocaleString()} ALL each</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => updateQty(ci.item.id, ci.qty - 1)}
                    className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">−</button>
                  <span className="text-sm font-bold w-4 text-center">{ci.qty}</span>
                  {ci.item.pricing_type !== 'hourly' && (
                    <button onClick={() => addToCart(ci.item)}
                      className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white">+</button>
                  )}
                </div>
                <span className="text-sm font-semibold text-slate-700 w-20 text-right flex-shrink-0">
                  {cartLineTotal(ci).toLocaleString()} ALL
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-3 border-t border-slate-100">
              <span className="font-bold text-slate-800">Total</span>
              <span className="font-black text-teal-600 text-lg">{total.toLocaleString()} ALL</span>
            </div>
          </div>
          {tableInfo && (
            <div className="bg-teal-50 rounded-xl px-4 py-2.5 mb-4 text-sm text-teal-700 font-medium">
              📍 {tableInfo.name}
            </div>
          )}
          {deliveryInfo && shopInfo?.pickup_mode !== 'notify_when_ready' && (
            <div className="bg-teal-50 rounded-xl px-4 py-3 mb-3 text-center">
              <p className="text-xs text-teal-600 font-medium">⏱ Estimated ready in <span className="font-bold">{deliveryInfo.label}</span></p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
          )}
          <p className="text-xs text-slate-400 text-center mb-3">Payment at pickup · Cash or card</p>
          <button
            onClick={placeOrder}
            disabled={submitting || cart.length === 0}
            className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white font-bold text-base rounded-2xl disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Placing order…' : `Place order · ${total.toLocaleString()} ALL`}
          </button>
        </div>
      )}

      {/* Fixed cart bar */}
      {state === 'menu' && cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 safe-area-bottom">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => setState('confirming')}
              className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white font-bold text-base rounded-2xl transition-colors"
            >
              View order · {cart.reduce((s, ci) => s + ci.qty, 0)} items · {total.toLocaleString()} ALL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
