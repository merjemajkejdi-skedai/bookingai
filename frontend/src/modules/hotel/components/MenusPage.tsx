import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Pencil, Trash2, Upload, X, FileText, Image, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Input, Select, Textarea } from '../ui';
import { api } from '../api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MENU_TYPES = [
  { value: 'room_service', label: 'Room Service', icon: '🍽️' },
  { value: 'bar',          label: 'Bar',           icon: '🍹' },
  { value: 'restaurant',   label: 'Restaurant',    icon: '🥘' },
  { value: 'laundry',      label: 'Laundry',       icon: '👔' },
  { value: 'spa',          label: 'Spa',           icon: '💆' },
  { value: 'breakfast',    label: 'Breakfast',     icon: '☕' },
  { value: 'other',        label: 'Other',         icon: '📋' },
];

function typeInfo(value: string) {
  return MENU_TYPES.find(t => t.value === value) ?? { value, label: value, icon: '📋' };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Menu {
  id: string;
  name: string;
  menu_type: string;
  description?: string;
  is_active: boolean;
  file_url?: string;
  file_name?: string;
  file_type?: string;
  keywords: string[];
  display_order: number;
  item_count?: number;
  items?: MenuItem[];
}

interface MenuItem {
  id: string;
  menu_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  price?: number;
  currency: string;
  category?: string;
  is_available: boolean;
  display_order: number;
}

// ---------------------------------------------------------------------------
// FileUploadZone
// ---------------------------------------------------------------------------
function FileUploadZone({ menuId, currentUrl, currentType, currentName, onUploaded, onRemoved }: {
  menuId: string;
  currentUrl?: string;
  currentType?: string;
  currentName?: string;
  onUploaded: (url: string, type: string, name: string) => void;
  onRemoved: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function doUpload(file: File) {
    setUploading(true);
    setError('');
    try {
      const data = await api.uploadMenuFile(menuId, file);
      onUploaded(data.file_url, data.file_type, file.name);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  }

  async function removeFile() {
    if (!confirm('Remove file from this menu?')) return;
    try {
      await api.removeMenuFile(menuId);
      onRemoved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (currentUrl) {
    const isPdf = currentType === 'pdf';
    return (
      <div className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
        {isPdf
          ? <FileText size={28} className="text-red-500 shrink-0" />
          : <Image size={28} className="text-blue-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 truncate">{currentName || 'Uploaded file'}</p>
          <a href={currentUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-brand-500 hover:underline truncate block">{currentUrl}</a>
        </div>
        <Button variant="danger" size="sm" onClick={removeFile}>
          <X size={14} /> Remove
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'}`}
      >
        <Upload size={24} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-600">
          {uploading ? 'Uploading…' : 'Drag & drop or click to browse'}
        </p>
        <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG — max 16 MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f); }}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddItemForm
// ---------------------------------------------------------------------------
function AddItemForm({ menuId, onAdded }: { menuId: string; onAdded: (item: MenuItem) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const item = await api.addMenuItem(menuId, {
        name: name.trim(),
        description: description.trim() || undefined,
        price: price !== '' ? Number(price) : undefined,
        currency,
        category: category.trim() || undefined,
      });
      onAdded(item);
      setName(''); setDescription(''); setPrice(''); setCategory('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-dashed border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add item</p>
      <div className="grid grid-cols-2 gap-2">
        <Input
          label="Name *"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Caesar Salad"
        />
        <Input
          label="Category"
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="e.g. Salads"
        />
      </div>
      <Input
        label="Description"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Optional description"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          label="Price"
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Currency"
          value={currency}
          onChange={e => setCurrency(e.target.value)}
          placeholder="ALL"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" size="sm" disabled={saving || !name.trim()}>
        <Plus size={14} /> {saving ? 'Adding…' : 'Add item'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// MenuEditor — slide-in side panel
// ---------------------------------------------------------------------------
function MenuEditor({ menu, onClose, onSaved }: {
  menu: Menu | null;
  onClose: () => void;
  onSaved: (m: Menu) => void;
}) {
  const isNew = !menu?.id;

  const [name, setName] = useState(menu?.name ?? '');
  const [menuType, setMenuType] = useState(menu?.menu_type ?? 'other');
  const [description, setDescription] = useState(menu?.description ?? '');
  const [keywords, setKeywords] = useState((menu?.keywords ?? []).join(', '));
  const [displayOrder, setDisplayOrder] = useState(String(menu?.display_order ?? 0));
  const [isActive, setIsActive] = useState(menu?.is_active !== false);

  const [currentUrl, setCurrentUrl] = useState(menu?.file_url ?? '');
  const [currentType, setCurrentType] = useState(menu?.file_type ?? '');
  const [currentName, setCurrentName] = useState(menu?.file_name ?? '');

  const [items, setItems] = useState<MenuItem[]>(menu?.items ?? []);
  const [itemsLoaded, setItemsLoaded] = useState(!!menu?.items);
  const [showItems, setShowItems] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load items when section is first expanded
  useEffect(() => {
    if (showItems && !itemsLoaded && menu?.id) {
      api.getMenuItems(menu.id)
        .then(rows => { setItems(rows); setItemsLoaded(true); })
        .catch(() => {});
    }
  }, [showItems, itemsLoaded, menu?.id]);

  async function saveBasic() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const kwArr = keywords.split(',').map(k => k.trim()).filter(Boolean);
      let saved: Menu;
      if (isNew) {
        saved = await api.createMenu({
          name: name.trim(),
          menu_type: menuType,
          description: description.trim() || undefined,
          keywords: kwArr,
          display_order: Number(displayOrder) || 0,
        });
      } else {
        saved = await api.updateMenu(menu!.id, {
          name: name.trim(),
          menu_type: menuType,
          description: description.trim() || undefined,
          keywords: kwArr,
          display_order: Number(displayOrder) || 0,
          is_active: isActive,
        });
      }
      onSaved({ ...saved, file_url: currentUrl, file_type: currentType, file_name: currentName, items });
      if (isNew) onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(itemId: string) {
    if (!menu?.id) return;
    if (!confirm('Delete this item?')) return;
    try {
      await api.deleteMenuItem(menu.id, itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
    } catch (e: any) {
      alert(e.message);
    }
  }

  // Group items by category
  const grouped: Record<string, MenuItem[]> = {};
  for (const item of items) {
    const cat = item.category || 'Uncategorized';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">
            {isNew ? 'New Menu' : `Edit: ${menu?.name}`}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Basic info */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Basic Info</h3>
            <Input label="Name *" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Room Service Menu" />
            <Select label="Type" value={menuType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMenuType(e.target.value)}>
              {MENU_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </Select>
            <Textarea label="Description" value={description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} placeholder="Optional description shown to staff" />
            <Input
              label="Keywords (comma-separated)"
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="e.g. food, drinks, snacks"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Display Order"
                type="number"
                min="0"
                value={displayOrder}
                onChange={e => setDisplayOrder(e.target.value)}
              />
              {!isNew && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Active</span>
                  <button
                    type="button"
                    onClick={() => setIsActive(v => !v)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
                      ${isActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                  >
                    {isActive
                      ? <><ToggleRight size={18} className="text-green-500" /> Active</>
                      : <><ToggleLeft size={18} className="text-slate-400" /> Inactive</>}
                  </button>
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={saveBasic} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : isNew ? 'Create Menu' : 'Save Changes'}
            </Button>
          </section>

          {/* File upload — only shown after menu is created */}
          {!isNew && menu?.id && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Menu File (PDF / Image)</h3>
              <FileUploadZone
                menuId={menu.id}
                currentUrl={currentUrl}
                currentType={currentType}
                currentName={currentName}
                onUploaded={(url, type, fname) => {
                  setCurrentUrl(url);
                  setCurrentType(type);
                  setCurrentName(fname);
                  onSaved({ ...menu, name, menu_type: menuType, description, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean), display_order: Number(displayOrder), is_active: isActive, file_url: url, file_type: type, file_name: fname, items });
                }}
                onRemoved={() => {
                  setCurrentUrl('');
                  setCurrentType('');
                  setCurrentName('');
                  onSaved({ ...menu, name, menu_type: menuType, description, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean), display_order: Number(displayOrder), is_active: isActive, file_url: undefined, file_type: undefined, file_name: undefined, items });
                }}
              />
            </section>
          )}

          {/* Menu items — only shown after menu is created */}
          {!isNew && menu?.id && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setShowItems(v => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide w-full text-left"
              >
                Menu Items ({items.length})
                {showItems ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showItems && (
                <div className="space-y-3">
                  {Object.keys(grouped).length > 0 && Object.entries(grouped).map(([cat, catItems]) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-slate-400 mb-1">{cat}</p>
                      {catItems.map(item => (
                        <div key={item.id} className="flex items-start justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-slate-400 truncate">{item.description}</p>
                            )}
                            {item.price !== null && item.price !== undefined && (
                              <p className="text-xs text-slate-500">{item.price} {item.currency}</p>
                            )}
                          </div>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                            title="Delete item"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}

                  <AddItemForm
                    menuId={menu.id}
                    onAdded={item => setItems(prev => [...prev, item])}
                  />
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuCard
// ---------------------------------------------------------------------------
function MenuCard({ menu, onEdit, onDelete, onToggle }: {
  menu: Menu;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const type = typeInfo(menu.menu_type);
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3 shadow-sm
      ${!menu.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">{type.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 truncate">{menu.name}</p>
          <p className="text-xs text-slate-400">{type.label}</p>
        </div>
        <button
          onClick={onToggle}
          title={menu.is_active ? 'Deactivate' : 'Activate'}
          className="shrink-0 text-slate-400 hover:text-brand-500 transition-colors"
        >
          {menu.is_active
            ? <ToggleRight size={22} className="text-green-500" />
            : <ToggleLeft size={22} />}
        </button>
      </div>

      {menu.description && (
        <p className="text-xs text-slate-500 line-clamp-2">{menu.description}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {menu.item_count !== undefined && menu.item_count > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">
            {menu.item_count} item{menu.item_count !== 1 ? 's' : ''}
          </span>
        )}
        {menu.file_url && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
            ${menu.file_type === 'pdf' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {menu.file_type === 'pdf' ? <FileText size={10} /> : <Image size={10} />}
            {menu.file_type?.toUpperCase() ?? 'FILE'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenusPage
// ---------------------------------------------------------------------------
export function MenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Menu | null | undefined>(undefined); // undefined = closed, null = new

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await api.getMenus();
      setMenus(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteMenu(id: string) {
    if (!confirm('Delete this menu and all its items?')) return;
    try {
      await api.deleteMenu(id);
      setMenus(prev => prev.filter(m => m.id !== id));
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function toggleActive(menu: Menu) {
    try {
      const updated = await api.updateMenu(menu.id, { is_active: !menu.is_active });
      setMenus(prev => prev.map(m => m.id === menu.id ? { ...m, ...updated } : m));
    } catch (e: any) {
      alert(e.message);
    }
  }

  function handleEditorSaved(saved: Menu) {
    setMenus(prev => {
      const idx = prev.findIndex(m => m.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...saved };
        return next;
      }
      return [saved, ...prev];
    });
  }

  async function openEdit(menu: Menu) {
    // Load full menu with items
    try {
      const full = await api.getMenu(menu.id);
      setEditing(full);
    } catch {
      setEditing(menu);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Hotel Menus</h1>
          <p className="text-xs text-slate-500">Manage menus shared with guests via AI concierge</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus size={15} /> New Menu
        </Button>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
      )}
      {!loading && error && (
        <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
      )}
      {!loading && !error && menus.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <span className="text-4xl">🍽️</span>
          <p className="text-sm">No menus yet. Create your first menu to get started.</p>
          <Button onClick={() => setEditing(null)}>
            <Plus size={15} /> New Menu
          </Button>
        </div>
      )}
      {!loading && !error && menus.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {menus.map(menu => (
              <MenuCard
                key={menu.id}
                menu={menu}
                onEdit={() => openEdit(menu)}
                onDelete={() => deleteMenu(menu.id)}
                onToggle={() => toggleActive(menu)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Editor panel */}
      {editing !== undefined && (
        <MenuEditor
          menu={editing}
          onClose={() => setEditing(undefined)}
          onSaved={handleEditorSaved}
        />
      )}
    </div>
  );
}
