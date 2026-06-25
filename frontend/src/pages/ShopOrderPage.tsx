import { useState, useEffect, useRef, useCallback } from 'react';
import { shopPublicApi } from '../modules/shop/api';

type PageState = 'loading' | 'name-input' | 'menu' | 'confirming' | 'success' | 'expired' | 'error';

export function ShopOrderPage({ slug, tableId }: { slug: string; tableId?: string }) {
  const [state, setState]           = useState<PageState>('loading');
  const [shopInfo, setShopInfo]     = useState<any>(null);
  const [tableInfo, setTableInfo]   = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart]             = useState<{ item: any; qty: number }[]>([]);
  const [placedOrder, setPlacedOrder] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
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
        const res = await shopPublicApi.getShop(slug);
        if (!res.success) { setState('error'); return; }
        setShopInfo(res.data);
        if (tableId) {
          const tr = await shopPublicApi.getTable(slug, tableId);
          if (tr.success) setTableInfo(tr.data);
        }
        setState(res.data.qr_collect_name ? 'name-input' : 'menu');
      } catch {
        setState('error');
      }
    }
    load();
  }, [slug, tableId]);

  function addToCart(item: any) {
    setCart(c => {
      const ex = c.find(ci => ci.item.id === item.id);
      if (ex) return c.map(ci => ci.item.id === item.id ? { ...ci, qty: ci.qty + 1 } : ci);
      return [...c, { item, qty: 1 }];
    });
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) setCart(c => c.filter(ci => ci.item.id !== itemId));
    else setCart(c => c.map(ci => ci.item.id === itemId ? { ...ci, qty } : ci));
  }

  const total = cart.reduce((sum, ci) => sum + parseFloat(ci.item.price) * ci.qty, 0);

  async function placeOrder() {
    setSubmitting(true);
    setError('');
    try {
      const res = await shopPublicApi.placeOrder(slug, {
        customer_name: customerName || undefined,
        table_name:    tableInfo?.name || undefined,
        items:         cart.map(ci => ({ item_id: ci.item.id, quantity: ci.qty })),
        qr_session:    sessionId.current,
      });
      if (!res.success) throw new Error(res.error || 'Failed to place order');
      setPlacedOrder(res.data);
      setState('success');
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
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
        <p className="text-slate-500 text-sm mb-6">{shopInfo?.shop_name} will prepare your order shortly.</p>
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
              <span className="text-slate-600">{ci.item.name} × {ci.qty}</span>
              <span className="text-slate-700 font-medium">{(parseFloat(ci.item.price) * ci.qty).toLocaleString()} ALL</span>
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
          onClick={() => setState('menu')}
          disabled={!customerName.trim()}
          className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white font-semibold rounded-xl disabled:opacity-40 transition-colors"
        >
          View Menu →
        </button>
      </div>
    </div>
  );

  // ── Menu ──────────────────────────────────────────────────────────────────────

  const categories = [...new Set((shopInfo?.items || []).map((i: any) => i.category_name || 'Other'))] as string[];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky header */}
      <div className="bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
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
        <div className="max-w-lg mx-auto pb-32">
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-4 py-2 bg-slate-100 sticky top-[60px] z-[5]">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{cat}</p>
              </div>
              {(shopInfo?.items || [])
                .filter((i: any) => (i.category_name || 'Other') === cat)
                .map((item: any) => {
                  const inCart = cart.find(ci => ci.item.id === item.id);
                  return (
                    <div key={item.id} className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
                      {item.photo_url && (
                        <img src={item.photo_url} alt={item.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{item.description}</p>
                        )}
                        <p className="text-sm font-bold text-teal-600 mt-1">
                          {parseFloat(item.price).toLocaleString()} {item.currency}
                        </p>
                      </div>
                      {inCart ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => updateQty(item.id, inCart.qty - 1)}
                            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-lg font-medium">−</button>
                          <span className="text-sm font-bold w-4 text-center">{inCart.qty}</span>
                          <button onClick={() => addToCart(item)}
                            className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-lg font-medium">+</button>
                        </div>
                      ) : (
                        <button onClick={() => addToCart(item)}
                          className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xl font-medium flex-shrink-0">+</button>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
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
                  <p className="text-xs text-slate-400">{parseFloat(ci.item.price).toLocaleString()} ALL each</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => updateQty(ci.item.id, ci.qty - 1)}
                    className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">−</button>
                  <span className="text-sm font-bold w-4 text-center">{ci.qty}</span>
                  <button onClick={() => addToCart(ci.item)}
                    className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white">+</button>
                </div>
                <span className="text-sm font-semibold text-slate-700 w-20 text-right flex-shrink-0">
                  {(parseFloat(ci.item.price) * ci.qty).toLocaleString()} ALL
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
