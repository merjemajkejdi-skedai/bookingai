import { useState, useEffect } from 'react';
import { Save, Phone, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Spinner } from '../ui';

export function ConfigPage() {
  const [ownerWhatsapp, setOwnerWhatsapp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then(c => setOwnerWhatsapp(c.ownerWhatsapp || ''))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.updateConfig({ ownerWhatsapp });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center pt-16"><Spinner /></div>;

  return (
    <div className="h-full flex flex-col gap-4 max-w-lg">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Studio Settings</h1>
        <p className="text-xs text-slate-400">Configure how the AI assistant handles special event inquiries</p>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-5">
        {/* Owner WhatsApp */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Phone size={15} className="text-brand-500" />
            <p className="text-sm font-semibold text-slate-700">Owner WhatsApp Number</p>
          </div>
          <Input
            label="Phone number (with country code)"
            value={ownerWhatsapp}
            onChange={e => setOwnerWhatsapp(e.target.value)}
            placeholder="e.g. +355691234567"
          />
          <p className="text-xs text-slate-400 leading-relaxed">
            When a customer inquires about a special event, a WhatsApp notification with their details is sent to this number.
            This number is also shared with customers who ask to speak with a human.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : <><Save size={14} /> Save settings</>}
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
