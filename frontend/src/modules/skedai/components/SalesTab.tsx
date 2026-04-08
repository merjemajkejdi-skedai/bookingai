import { useState } from 'react';
import { Plus, Trash2, Save, CheckCircle2, ChevronDown, ChevronRight, Building2, X } from 'lucide-react';
import { api } from '../api';
import type { SkedAIConfig, Industry, Tier } from '../types';

function uid() { return Math.random().toString(36).slice(2); }

interface Props { config: SkedAIConfig; onSaved: (c: Partial<SkedAIConfig>) => void }

// ── Tier editor ───────────────────────────────────────────────────────────────
function TierEditor({ tier, onChange, onDelete }: {
  tier: Tier;
  onChange: (t: Tier) => void;
  onDelete: () => void;
}) {
  const [featureInput, setFeatureInput] = useState('');

  function addFeature() {
    const v = featureInput.trim();
    if (!v) return;
    onChange({ ...tier, features: [...tier.features, v] });
    setFeatureInput('');
  }

  function removeFeature(i: number) {
    onChange({ ...tier, features: tier.features.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {/* Tier name */}
        <input value={tier.name} onChange={e => onChange({ ...tier, name: e.target.value })}
          placeholder="Tier name e.g. Starter"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 font-medium" />
        {/* Price */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-slate-400 text-sm">€</span>
          <input type="number" min={0} value={tier.price}
            onChange={e => onChange({ ...tier, price: Number(e.target.value) })}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 text-right"
            placeholder="0" />
          <span className="text-slate-400 text-xs">/mo</span>
        </div>
        <button type="button" onClick={onDelete}
          className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Features */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500 font-medium">Included features</p>
        <div className="flex flex-wrap gap-1.5">
          {tier.features.map((f, i) => (
            <span key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-xs text-brand-700">
              {f}
              <button type="button" onClick={() => removeFeature(i)}
                className="text-brand-400 hover:text-brand-700 flex-shrink-0">
                <X size={10} />
              </button>
            </span>
          ))}
          {tier.features.length === 0 && (
            <span className="text-xs text-slate-400 italic">No features yet</span>
          )}
        </div>
        <div className="flex gap-2">
          <input value={featureInput} onChange={e => setFeatureInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); }}}
            placeholder="Add feature and press Enter"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
          <button type="button" onClick={addFeature}
            className="px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 text-xs font-medium hover:bg-brand-100 transition-colors">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Industry card ─────────────────────────────────────────────────────────────
function IndustryCard({ industry, onChange, onDelete }: {
  industry: Industry;
  onChange: (i: Industry) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);

  function addTier() {
    onChange({ ...industry, tiers: [...industry.tiers, { id: uid(), name: '', price: 0, features: [] }] });
  }

  function updateTier(id: string, t: Tier) {
    onChange({ ...industry, tiers: industry.tiers.map(x => x.id === id ? t : x) });
  }

  function removeTier(id: string) {
    onChange({ ...industry, tiers: industry.tiers.filter(x => x.id !== id) });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <button type="button" onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-600">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <input value={industry.name} onChange={e => onChange({ ...industry, name: e.target.value })}
          placeholder="Industry name e.g. Barbershops & Salons"
          className="flex-1 text-sm font-semibold text-slate-800 bg-transparent focus:outline-none placeholder:text-slate-400 placeholder:font-normal" />
        <span className="text-xs text-slate-400">{industry.tiers.length} tier{industry.tiers.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={onDelete}
          className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Tiers */}
      {open && (
        <div className="p-5 flex flex-col gap-3">
          {industry.tiers.map(tier => (
            <TierEditor key={tier.id} tier={tier}
              onChange={t => updateTier(tier.id, t)}
              onDelete={() => removeTier(tier.id)} />
          ))}
          <button type="button" onClick={addTier}
            className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium mt-1">
            <Plus size={12} /> Add tier
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export function SalesTab({ config, onSaved }: Props) {
  const [industries, setIndustries] = useState<Industry[]>(() => config.industries || []);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  function addIndustry() {
    setIndustries(i => [...i, { id: uid(), name: '', tiers: [] }]);
  }

  function updateIndustry(id: string, ind: Industry) {
    setIndustries(i => i.map(x => x.id === id ? ind : x));
  }

  function removeIndustry(id: string) {
    setIndustries(i => i.filter(x => x.id !== id));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.saveSales({ industries });
      onSaved({ industries });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-brand-500" />
          <p className="text-sm font-semibold text-slate-700">Industries & Pricing</p>
        </div>
        <button type="button" onClick={addIndustry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors">
          <Plus size={12} /> Add industry
        </button>
      </div>
      <p className="text-xs text-slate-400 -mt-3">The sales agent uses this pricing when answering questions about cost. Each industry can have multiple tiers.</p>

      {industries.length === 0
        ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2 bg-white rounded-2xl border border-slate-200">
            <Building2 size={28} className="opacity-30" />
            <p className="text-sm">No industries configured yet</p>
            <button type="button" onClick={addIndustry}
              className="text-xs text-brand-500 hover:text-brand-600 font-medium">
              Add your first industry
            </button>
          </div>
        )
        : industries.map(ind => (
          <IndustryCard key={ind.id} industry={ind}
            onChange={i => updateIndustry(ind.id, i)}
            onDelete={() => removeIndustry(ind.id)} />
        ))
      }

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle2 size={14} /> Saved</span>}
      </div>
    </form>
  );
}
