import { useState, useRef } from 'react';
import { Plus, Image as ImageIcon, Trash2, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { Modal } from '../../../components/ui';
import { airbnbApi } from '../api';
import type { AirbnbListing, InstructionBlock } from '../types';

interface Props {
  listing: AirbnbListing;
  onClose: () => void;
  onSaved: () => void;
}

// Check-in instructions are an ordered list of text and photo blocks rather
// than free-form rich text: WhatsApp can't render rich text anyway, so each
// block is sent to the guest as its own message, in this order.
export function InstructionsEditor({ listing, onClose, onSaved }: Props) {
  const [blocks, setBlocks] = useState<InstructionBlock[]>(listing.checkin_instructions ?? []);
  const [backup, setBackup] = useState(listing.backup_owner_number ?? '');
  const [sendTime, setSendTime] = useState((listing.checkin_send_time ?? '').slice(0, 5));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function update(i: number, patch: Partial<InstructionBlock>) {
    setBlocks(bs => bs.map((b, idx) => (idx === i ? ({ ...b, ...patch } as InstructionBlock) : b)));
  }
  function remove(i: number) { setBlocks(bs => bs.filter((_, idx) => idx !== i)); }
  function move(i: number, dir: -1 | 1) {
    setBlocks(bs => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await airbnbApi.uploadInstructionImage(listing.id, file);
      setBlocks(bs => [...bs, { type: 'image', url }]);
    } catch (err: any) { alert(err.message); }
    finally { setUploading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await airbnbApi.saveCheckinSettings(listing.id, {
        checkin_instructions: blocks.filter(b => b.type === 'image' || b.text.trim()),
        backup_owner_number: backup.trim(),
        checkin_send_time: sendTime,
      });
      onSaved();
      onClose();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`Check-in instructions — ${listing.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Sent to the guest on check-in day. Each block below is delivered as its own WhatsApp message, in this order
          — text as a message, photos as image messages. Include door code, parking, wifi and arrival directions.
        </p>

        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-2 flex gap-2">
              <div className="flex-1 min-w-0">
                {b.type === 'text' ? (
                  <textarea
                    value={b.text} rows={3}
                    onChange={e => update(i, { text: e.target.value })}
                    placeholder="Message text…"
                    className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-300" />
                ) : (
                  <div className="flex gap-2 items-start">
                    <img src={b.url} alt="" className="w-20 h-20 object-cover rounded border border-slate-200 flex-shrink-0" />
                    <input
                      value={b.caption ?? ''} onChange={e => update(i, { caption: e.target.value })}
                      placeholder="Caption (optional)"
                      className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown size={14} /></button>
                <button onClick={() => remove(i)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {blocks.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No instructions yet.</p>}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setBlocks(bs => [...bs, { type: 'text', text: '' }])}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
            <Plus size={14} /> Text
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {uploading ? <RefreshCw size={14} className="animate-spin" /> : <ImageIcon size={14} />} Photo
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFile} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          <label className="text-xs text-slate-600 space-y-1 block">
            <span className="font-medium">Backup contact number</span>
            <input value={backup} onChange={e => setBackup(e.target.value)} placeholder="+355691234567"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            <span className="text-slate-400 block">Given to a guest we can't match to a reservation.</span>
          </label>
          <label className="text-xs text-slate-600 space-y-1 block">
            <span className="font-medium">Proactive send time</span>
            <input type="time" value={sendTime} onChange={e => setSendTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            <span className="text-slate-400 block">Only used once proactive sending is enabled.</span>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
