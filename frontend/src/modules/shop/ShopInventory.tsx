import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, X, Check, AlertTriangle, Package, Truck, FlaskConical, BarChart2, BookOpen } from 'lucide-react';
import { shopApi } from './api';

// ── tiny helpers ───────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function InputField({ label, value, onChange, type = 'text', placeholder, min, step }: {
  label: string; value: any; onChange: (v: any) => void;
  type?: string; placeholder?: string; min?: string; step?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input
        type={type} value={value ?? ''} onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        placeholder={placeholder} min={min} step={step}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: any; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const UNITS = ['pieces', 'kg', 'g', 'l', 'ml', 'bottle', 'can', 'pack', 'box', 'slice', 'portion'];

// ── Categories mini-manager ────────────────────────────────────────────────────

function CategoriesPanel({ categories, onReload }: { categories: any[]; onReload: () => void }) {
  const [name, setName]   = useState('');
  const [busy, setBusy]   = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try { await shopApi.createInvCategory({ name: name.trim(), sort_order: categories.length }); setName(''); onReload(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this category?')) return;
    try { await shopApi.deleteInvCategory(id); onReload(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Categories</h5>
      <div className="flex gap-2">
        <input
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New category name"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <button onClick={add} disabled={busy || !name.trim()}
          className="text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50">
          Add
        </button>
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {categories.map((c: any) => (
          <div key={c.id} className="flex items-center justify-between text-sm text-slate-700 py-1 px-2 hover:bg-slate-50 rounded-lg">
            <span>{c.name}</span>
            <button onClick={() => del(c.id)} className="text-red-400 hover:text-red-600 p-1"><X size={12} /></button>
          </div>
        ))}
        {categories.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No categories yet</p>}
      </div>
    </div>
  );
}

// ── Ingredient modal ───────────────────────────────────────────────────────────

function IngredientModal({ ingredient, categories, suppliers, onSave, onClose }: {
  ingredient?: any; categories: any[]; suppliers: any[];
  onSave: (data: any) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<any>(ingredient ?? {
    name: '', unit: 'pieces', current_stock: 0, reorder_threshold: 0, cost_per_unit: 0,
    category_id: '', supplier_id: '',
  });
  const [busy, setBusy] = useState(false);

  function set(k: string, v: any) { setForm((p: any) => ({ ...p, [k]: v })); }

  async function submit() {
    if (!form.name?.trim()) { alert('Name is required'); return; }
    setBusy(true);
    try { await onSave(form); onClose(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-slate-800">{ingredient ? 'Edit Ingredient' : 'Add Ingredient'}</h3>
          <button onClick={onClose}><X size={16} className="text-slate-400" /></button>
        </div>
        <InputField label="Name *" value={form.name} onChange={v => set('name', v)} placeholder="e.g. Tomatoes" />
        <SelectField label="Unit" value={form.unit} onChange={v => set('unit', v)}
          options={UNITS.map(u => ({ value: u, label: u }))} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Current stock" value={form.current_stock} onChange={v => set('current_stock', v)} type="number" min="0" step="0.01" />
          <InputField label="Reorder at" value={form.reorder_threshold} onChange={v => set('reorder_threshold', v)} type="number" min="0" step="0.01" />
        </div>
        <InputField label="Cost per unit (ALL)" value={form.cost_per_unit} onChange={v => set('cost_per_unit', v)} type="number" min="0" step="0.01" />
        <SelectField label="Category" value={form.category_id} onChange={v => set('category_id', v)}
          options={categories.map(c => ({ value: c.id, label: c.name }))} placeholder="No category" />
        <SelectField label="Supplier" value={form.supplier_id} onChange={v => set('supplier_id', v)}
          options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="No supplier" />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2 text-sm font-semibold bg-teal-500 text-white rounded-xl hover:bg-teal-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ingredients tab ────────────────────────────────────────────────────────────

function IngredientsTab({ categories, suppliers, onCategoriesReload }: {
  categories: any[]; suppliers: any[]; onCategoriesReload: () => void;
}) {
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editItem, setEditItem]       = useState<any>(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [filterCat, setFilterCat]     = useState('');

  async function load() {
    setLoading(true);
    try { setIngredients(await shopApi.getIngredients()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function saveNew(data: any) {
    await shopApi.createIngredient(data);
    await load();
  }

  async function saveEdit(data: any) {
    await shopApi.updateIngredient(editItem.id, data);
    await load();
  }

  async function del(id: string) {
    if (!confirm('Remove this ingredient?')) return;
    try { await shopApi.deleteIngredient(id); await load(); }
    catch (e: any) { alert(e.message); }
  }

  const visible = filterCat ? ingredients.filter(i => i.category_id === filterCat) : ingredients;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => setShowAdd(true)}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600">
          <Plus size={13} /> Add Ingredient
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-2">
          {visible.map((ing: any) => {
            const isLow = ing.reorder_threshold > 0 && parseFloat(ing.current_stock) <= parseFloat(ing.reorder_threshold);
            return (
              <div key={ing.id} className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${isLow ? 'border-amber-300' : 'border-slate-200'}`}>
                {isLow && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{ing.name}</span>
                    {ing.category_name && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{ing.category_name}</span>
                    )}
                    {isLow && <span className="text-xs text-amber-600 font-medium">Low stock</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {parseFloat(ing.current_stock).toFixed(2)} {ing.unit}
                    {ing.reorder_threshold > 0 && ` · reorder at ${parseFloat(ing.reorder_threshold).toFixed(2)}`}
                    {ing.supplier_name && ` · ${ing.supplier_name}`}
                  </div>
                </div>
                <div className="text-xs text-slate-400 text-right shrink-0">
                  {ing.cost_per_unit > 0 && <div>{parseFloat(ing.cost_per_unit).toFixed(0)} ALL/{ing.unit}</div>}
                </div>
                <button onClick={() => setEditItem(ing)} className="p-1.5 text-slate-400 hover:text-teal-600"><Pencil size={13} /></button>
                <button onClick={() => del(ing.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-10">No ingredients yet. Add one above.</p>
          )}
        </div>
      )}

      <CategoriesPanel categories={categories} onReload={onCategoriesReload} />

      {showAdd && (
        <IngredientModal categories={categories} suppliers={suppliers} onSave={saveNew} onClose={() => setShowAdd(false)} />
      )}
      {editItem && (
        <IngredientModal ingredient={editItem} categories={categories} suppliers={suppliers} onSave={saveEdit} onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}

// ── Suppliers tab ──────────────────────────────────────────────────────────────

function SuppliersTab({ suppliers, onReload }: { suppliers: any[]; onReload: () => void }) {
  const [form, setForm]     = useState<any>({ name: '', contact: '', phone: '', email: '', notes: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);
  const [showForm, setShowForm] = useState(false);

  function reset() { setForm({ name: '', contact: '', phone: '', email: '', notes: '' }); setEditId(null); setShowForm(false); }

  async function save() {
    if (!form.name?.trim()) { alert('Name is required'); return; }
    setBusy(true);
    try {
      if (editId) { await shopApi.updateInvSupplier(editId, form); }
      else { await shopApi.createInvSupplier(form); }
      reset(); onReload();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Deactivate this supplier?')) return;
    try { await shopApi.deleteInvSupplier(id); onReload(); }
    catch (e: any) { alert(e.message); }
  }

  function startEdit(s: any) {
    setForm({ name: s.name, contact: s.contact || '', phone: s.phone || '', email: s.email || '', notes: s.notes || '' });
    setEditId(s.id); setShowForm(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600">
          <Plus size={13} /> Add Supplier
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h5 className="text-sm font-semibold text-slate-700">{editId ? 'Edit Supplier' : 'New Supplier'}</h5>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Name *" value={form.name} onChange={v => setForm((p: any) => ({ ...p, name: v }))} />
            <InputField label="Contact person" value={form.contact} onChange={v => setForm((p: any) => ({ ...p, contact: v }))} />
            <InputField label="Phone" value={form.phone} onChange={v => setForm((p: any) => ({ ...p, phone: v }))} />
            <InputField label="Email" value={form.email} onChange={v => setForm((p: any) => ({ ...p, email: v }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm((p: any) => ({ ...p, notes: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2 text-sm font-semibold bg-teal-500 text-white rounded-xl disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {suppliers.map((s: any) => (
          <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-800">{s.name}</div>
              <div className="text-xs text-slate-400">
                {[s.contact, s.phone, s.email].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={() => startEdit(s)} className="p-1.5 text-slate-400 hover:text-teal-600"><Pencil size={13} /></button>
            <button onClick={() => del(s.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
          </div>
        ))}
        {suppliers.length === 0 && <p className="text-sm text-slate-400 text-center py-10">No suppliers yet.</p>}
      </div>
    </div>
  );
}

// ── Recipe editor ──────────────────────────────────────────────────────────────

function RecipeModal({ menuItem, ingredients, onClose }: {
  menuItem: any; ingredients: any[]; onClose: () => void;
}) {
  const [lines, setLines] = useState<{ ingredient_id: string; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    shopApi.getRecipe(menuItem.id)
      .then(r => { if (r?.lines) setLines(r.lines.map((l: any) => ({ ingredient_id: l.ingredient_id, quantity: parseFloat(l.quantity) }))); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [menuItem.id]);

  function addLine() { setLines(p => [...p, { ingredient_id: '', quantity: 1 }]); }
  function removeLine(i: number) { setLines(p => p.filter((_, j) => j !== i)); }
  function setLine(i: number, k: string, v: any) {
    setLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l));
  }

  async function save() {
    const valid = lines.filter(l => l.ingredient_id);
    setBusy(true);
    try { await shopApi.saveRecipe(menuItem.id, { lines: valid }); onClose(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function delRecipe() {
    if (!confirm('Remove recipe? This reverts the item to simple stock mode.')) return;
    try { await shopApi.deleteRecipe(menuItem.id); onClose(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Recipe</h3>
            <p className="text-xs text-slate-400">{menuItem.name}</p>
          </div>
          <button onClick={onClose}><X size={16} className="text-slate-400" /></button>
        </div>

        {loading ? <p className="text-sm text-slate-400 text-center py-4">Loading…</p> : (
          <>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={line.ingredient_id} onChange={e => setLine(i, 'ingredient_id', e.target.value)}
                    className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                    <option value="">Select ingredient…</option>
                    {ingredients.map(ing => (
                      <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                    ))}
                  </select>
                  <input
                    type="number" min="0.01" step="0.01" value={line.quantity}
                    onChange={e => setLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
                  />
                  <button onClick={() => removeLine(i)} className="p-1.5 text-red-400 hover:text-red-600"><X size={13} /></button>
                </div>
              ))}
              {lines.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-2">No ingredients yet. Add one below.</p>
              )}
            </div>

            <button onClick={addLine} className="flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700">
              <Plus size={13} /> Add ingredient
            </button>

            <div className="flex gap-2 pt-1">
              <button onClick={delRecipe} className="text-xs text-red-400 hover:text-red-600 border border-red-200 px-3 py-2 rounded-xl">
                Remove recipe
              </button>
              <div className="flex-1" />
              <button onClick={onClose} className="py-2 px-4 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
              <button onClick={save} disabled={busy} className="py-2 px-4 text-sm font-semibold bg-teal-500 text-white rounded-xl disabled:opacity-50">
                {busy ? 'Saving…' : 'Save recipe'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Recipes tab ────────────────────────────────────────────────────────────────

function RecipesTab({ ingredients }: { ingredients: any[] }) {
  const [items, setItems]       = useState<any[]>([]);
  const [recipes, setRecipes]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editItem, setEditItem] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const [allItems, allRecipes] = await Promise.all([shopApi.getItems(), shopApi.getRecipes()]);
      setItems(allItems);
      setRecipes(allRecipes);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const recipeMap = new Set(recipes.map((r: any) => r.menu_item_id));

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Assign recipes to menu items so ingredient stock is automatically deducted when orders are placed.
      </p>
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : (
        items.map((item: any) => {
          const hasRecipe = recipeMap.has(item.id);
          return (
            <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">{item.name}</div>
                <div className="text-xs text-slate-400">{item.category_name || 'No category'}</div>
              </div>
              {hasRecipe ? (
                <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">Has recipe</span>
              ) : (
                <span className="text-xs text-slate-400">No recipe</span>
              )}
              <button
                onClick={() => setEditItem(item)}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 border border-teal-200 px-3 py-1 rounded-lg"
              >
                {hasRecipe ? 'Edit' : 'Add recipe'}
              </button>
            </div>
          );
        })
      )}
      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-10">No menu items found.</p>
      )}

      {editItem && (
        <RecipeModal menuItem={editItem} ingredients={ingredients} onClose={() => { setEditItem(null); load(); }} />
      )}
    </div>
  );
}

// ── Deliveries tab ─────────────────────────────────────────────────────────────

function DeliveriesTab({ suppliers, ingredients }: { suppliers: any[]; ingredients: any[] }) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [busy, setBusy]             = useState(false);

  const emptyForm = { supplier_id: '', invoice_ref: '', notes: '', delivered_at: '', lines: [] as any[] };
  const [form, setForm] = useState<any>(emptyForm);

  async function load() {
    setLoading(true);
    try { setDeliveries(await shopApi.getDeliveries()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function addLine() { setForm((p: any) => ({ ...p, lines: [...p.lines, { ingredient_id: '', quantity: 0, cost_per_unit: 0 }] })); }
  function removeLine(i: number) { setForm((p: any) => ({ ...p, lines: p.lines.filter((_: any, j: number) => j !== i) })); }
  function setLine(i: number, k: string, v: any) {
    setForm((p: any) => ({ ...p, lines: p.lines.map((l: any, j: number) => j === i ? { ...l, [k]: v } : l) }));
  }

  async function submit() {
    const lines = form.lines.filter((l: any) => l.ingredient_id && l.quantity > 0);
    if (lines.length === 0) { alert('Add at least one line'); return; }
    setBusy(true);
    try {
      const supplier = suppliers.find(s => s.id === form.supplier_id);
      await shopApi.createDelivery({
        ...form,
        supplier_name: supplier?.name,
        lines: lines.map((l: any) => {
          const ing = ingredients.find(i => i.id === l.ingredient_id);
          return { ...l, unit: ing?.unit || 'pieces' };
        }),
      });
      setForm(emptyForm); setShowForm(false); await load();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this delivery? Stock will be reversed.')) return;
    try { await shopApi.deleteDelivery(id); await load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600">
          <Plus size={13} /> Record Delivery
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h5 className="text-sm font-semibold text-slate-700">New Delivery</h5>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Supplier" value={form.supplier_id} onChange={v => setForm((p: any) => ({ ...p, supplier_id: v }))}
              options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="Select supplier…" />
            <InputField label="Invoice ref" value={form.invoice_ref} onChange={v => setForm((p: any) => ({ ...p, invoice_ref: v }))} />
            <InputField label="Delivery date" value={form.delivered_at} onChange={v => setForm((p: any) => ({ ...p, delivered_at: v }))} type="date" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm((p: any) => ({ ...p, notes: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Delivery lines</span>
              <button onClick={addLine} className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"><Plus size={12} /> Add line</button>
            </div>
            {form.lines.map((l: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <select value={l.ingredient_id} onChange={e => setLine(i, 'ingredient_id', e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                  <option value="">Select ingredient…</option>
                  {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                </select>
                <input type="number" min="0.01" step="0.01" value={l.quantity || ''}
                  onChange={e => setLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                  placeholder="Qty" className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                <input type="number" min="0" step="0.01" value={l.cost_per_unit || ''}
                  onChange={e => setLine(i, 'cost_per_unit', parseFloat(e.target.value) || 0)}
                  placeholder="Cost/u" className="w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                <button onClick={() => removeLine(i)} className="p-1 text-red-400"><X size={13} /></button>
              </div>
            ))}
            {form.lines.length === 0 && <p className="text-xs text-slate-400">No lines. Click "Add line" above.</p>}
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setForm(emptyForm); setShowForm(false); }} className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
            <button onClick={submit} disabled={busy} className="flex-1 py-2 text-sm font-semibold bg-teal-500 text-white rounded-xl disabled:opacity-50">
              {busy ? 'Saving…' : 'Save Delivery'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d: any) => (
            <div key={d.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {d.supplier_name || 'Unknown supplier'}
                    {d.invoice_ref && <span className="ml-2 text-xs text-slate-400">#{d.invoice_ref}</span>}
                  </div>
                  <div className="text-xs text-slate-400">{fmtDate(d.delivered_at || d.created_at)} · {d.created_by}</div>
                </div>
                <div className="flex items-center gap-2">
                  {d.total_cost > 0 && (
                    <span className="text-sm font-semibold text-slate-700">{parseFloat(d.total_cost).toLocaleString()} ALL</span>
                  )}
                  <button onClick={() => del(d.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                </div>
              </div>
              {(d.lines || []).length > 0 && (
                <div className="border-t border-slate-100 pt-2 space-y-0.5">
                  {d.lines.map((l: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs text-slate-600">
                      <span>{l.ingredient_name}</span>
                      <span className="text-slate-400">{parseFloat(l.quantity).toFixed(2)} {l.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {deliveries.length === 0 && <p className="text-sm text-slate-400 text-center py-10">No deliveries recorded yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── Waste tab ──────────────────────────────────────────────────────────────────

function WasteTab({ ingredients }: { ingredients: any[] }) {
  const [waste, setWaste]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState<any>({ ingredient_id: '', quantity: 0, category: 'spillage', notes: '' });
  const [busy, setBusy]       = useState(false);

  const WASTE_CATS = ['spillage', 'expired', 'damaged', 'other'];

  async function load() {
    setLoading(true);
    try { setWaste(await shopApi.getWaste()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function submit() {
    if (!form.ingredient_id) { alert('Select an ingredient'); return; }
    if (!form.quantity || form.quantity <= 0) { alert('Enter a valid quantity'); return; }
    setBusy(true);
    try { await shopApi.logWaste(form); setForm({ ingredient_id: '', quantity: 0, category: 'spillage', notes: '' }); setShowForm(false); await load(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600">
          <Plus size={13} /> Log Waste
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h5 className="text-sm font-semibold text-slate-700">Log Waste</h5>
          <SelectField label="Ingredient *" value={form.ingredient_id}
            onChange={v => setForm((p: any) => ({ ...p, ingredient_id: v }))}
            options={ingredients.map(i => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
            placeholder="Select ingredient…" />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Quantity" value={form.quantity} onChange={v => setForm((p: any) => ({ ...p, quantity: v }))} type="number" min="0.01" step="0.01" />
            <SelectField label="Category" value={form.category} onChange={v => setForm((p: any) => ({ ...p, category: v }))}
              options={WASTE_CATS.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm((p: any) => ({ ...p, notes: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
            <button onClick={submit} disabled={busy} className="flex-1 py-2 text-sm font-semibold bg-amber-500 text-white rounded-xl disabled:opacity-50">
              {busy ? 'Saving…' : 'Log Waste'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-2">
          {waste.map((w: any) => (
            <div key={w.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-800">{w.ingredient_name}</div>
                <div className="text-xs text-slate-400">{fmtDate(w.recorded_at)} · {w.category} · {w.recorded_by}</div>
                {w.notes && <div className="text-xs text-slate-400 italic mt-0.5">{w.notes}</div>}
              </div>
              <div className="text-sm font-medium text-amber-600">
                −{parseFloat(w.quantity).toFixed(2)} {w.unit}
              </div>
            </div>
          ))}
          {waste.length === 0 && <p className="text-sm text-slate-400 text-center py-10">No waste logged yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── Reports tab ────────────────────────────────────────────────────────────────

function ReportsTab() {
  const [stockLevels, setStockLevels]   = useState<any[]>([]);
  const [stockValue, setStockValue]     = useState<any>(null);
  const [consumption, setConsumption]   = useState<any[]>([]);
  const [wasteReport, setWasteReport]   = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [days, setDays]                 = useState(30);

  async function load() {
    setLoading(true);
    try {
      const [sl, sv, c, w] = await Promise.all([
        shopApi.getStockLevels(),
        shopApi.getStockValue(),
        shopApi.getConsumption(days),
        shopApi.getWasteReport(days),
      ]);
      setStockLevels(sl);
      setStockValue(sv);
      setConsumption(c);
      setWasteReport(w);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [days]);

  const lowItems = stockLevels.filter(i => i.is_low);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-slate-500">Period:</span>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${days === d ? 'bg-teal-500 text-white border-teal-500' : 'text-slate-500 border-slate-200'}`}>
            {d}d
          </button>
        ))}
        <button onClick={load} className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-2 py-1.5 rounded-lg">Refresh</button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        <>
          {/* Total stock value */}
          {stockValue && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-semibold text-slate-700">Total Inventory Value</h5>
                <span className="text-xl font-bold text-teal-600">{parseFloat(stockValue.total_value || 0).toLocaleString()} ALL</span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(stockValue.items || []).slice(0, 10).map((i: any) => (
                  <div key={i.id} className="flex justify-between text-xs text-slate-600">
                    <span>{i.name}</span>
                    <span className="text-slate-400">{parseFloat(i.stock_value || 0).toLocaleString()} ALL</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Low stock alert */}
          {lowItems.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} className="text-amber-500" />
                <h5 className="text-sm font-semibold text-amber-800">{lowItems.length} Low Stock Items</h5>
              </div>
              <div className="space-y-1">
                {lowItems.map((i: any) => (
                  <div key={i.id} className="flex justify-between text-xs text-amber-700">
                    <span>{i.name}</span>
                    <span>{parseFloat(i.current_stock).toFixed(1)} {i.unit} · reorder at {parseFloat(i.reorder_threshold).toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock levels full list */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h5 className="text-sm font-semibold text-slate-700 mb-3">Stock Levels</h5>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {stockLevels.map((i: any) => (
                <div key={i.id} className={`flex justify-between text-xs py-1 border-b border-slate-50 ${i.is_low ? 'text-amber-700' : 'text-slate-600'}`}>
                  <span>{i.name}{i.category_name ? <span className="text-slate-400 ml-1">({i.category_name})</span> : null}</span>
                  <span>{parseFloat(i.current_stock).toFixed(2)} {i.unit}</span>
                </div>
              ))}
              {stockLevels.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No ingredients found</p>}
            </div>
          </div>

          {/* Consumption */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h5 className="text-sm font-semibold text-slate-700 mb-3">Consumption (last {days} days)</h5>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {consumption.map((r: any) => (
                <div key={r.ingredient_id} className="flex justify-between text-xs text-slate-600 py-1 border-b border-slate-50">
                  <span>{r.ingredient_name}</span>
                  <span className="text-slate-400">{parseFloat(r.total_consumed).toFixed(2)} {r.unit} · {r.order_count} orders</span>
                </div>
              ))}
              {consumption.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No consumption data</p>}
            </div>
          </div>

          {/* Waste report */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h5 className="text-sm font-semibold text-slate-700 mb-3">Waste (last {days} days)</h5>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {wasteReport.map((r: any, i: number) => (
                <div key={i} className="flex justify-between text-xs text-slate-600 py-1 border-b border-slate-50">
                  <span>{r.ingredient_name} <span className="text-slate-400">({r.category})</span></span>
                  <span className="text-amber-600">−{parseFloat(r.total_wasted).toFixed(2)} {r.unit}</span>
                </div>
              ))}
              {wasteReport.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No waste recorded</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

type InvTab = 'ingredients' | 'suppliers' | 'recipes' | 'deliveries' | 'waste' | 'reports';

const INV_TABS: { id: InvTab; label: string; icon: React.ReactNode }[] = [
  { id: 'ingredients', label: 'Ingredients', icon: <Package size={14} /> },
  { id: 'suppliers',   label: 'Suppliers',   icon: <Truck size={14} /> },
  { id: 'recipes',     label: 'Recipes',     icon: <BookOpen size={14} /> },
  { id: 'deliveries',  label: 'Deliveries',  icon: <Truck size={14} /> },
  { id: 'waste',       label: 'Waste',       icon: <AlertTriangle size={14} /> },
  { id: 'reports',     label: 'Reports',     icon: <BarChart2 size={14} /> },
];

export function ShopInventory() {
  const [tab, setTab]             = useState<InvTab>('ingredients');
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers]   = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);

  async function loadShared() {
    const [cats, sups, ings] = await Promise.all([
      shopApi.getInvCategories().catch(() => [] as any[]),
      shopApi.getInvSuppliers().catch(() => [] as any[]),
      shopApi.getIngredients().catch(() => [] as any[]),
    ]);
    setCategories(cats);
    setSuppliers(sups);
    setIngredients(ings);
  }

  async function reloadCategories() {
    setCategories(await shopApi.getInvCategories().catch(() => []));
  }

  async function reloadSuppliers() {
    setSuppliers(await shopApi.getInvSuppliers().catch(() => []));
  }

  useEffect(() => { loadShared(); }, []);

  // When switching to ingredients/recipes tabs, refresh ingredient list
  useEffect(() => {
    if (tab === 'ingredients' || tab === 'recipes') {
      shopApi.getIngredients().then(setIngredients).catch(() => {});
    }
    if (tab === 'suppliers') reloadSuppliers();
  }, [tab]);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex gap-0.5 pb-3 border-b border-slate-200 mb-4 overflow-x-auto">
        {INV_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'bg-teal-50 text-teal-700 border border-teal-200'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'ingredients' && (
          <IngredientsTab categories={categories} suppliers={suppliers} onCategoriesReload={reloadCategories} />
        )}
        {tab === 'suppliers' && (
          <SuppliersTab suppliers={suppliers} onReload={reloadSuppliers} />
        )}
        {tab === 'recipes' && (
          <RecipesTab ingredients={ingredients} />
        )}
        {tab === 'deliveries' && (
          <DeliveriesTab suppliers={suppliers} ingredients={ingredients} />
        )}
        {tab === 'waste' && (
          <WasteTab ingredients={ingredients} />
        )}
        {tab === 'reports' && (
          <ReportsTab />
        )}
      </div>
    </div>
  );
}
