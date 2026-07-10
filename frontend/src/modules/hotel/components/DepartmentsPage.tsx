import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Building2, Phone, Check, Clock, Calendar, X, Moon } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Department, DepartmentSchedule } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

const DEPT_LANGUAGES = [
  { value: 'en', label: '🇬🇧 English' },
  { value: 'sq', label: '🇦🇱 Albanian' },
  { value: 'it', label: '🇮🇹 Italian' },
  { value: 'de', label: '🇩🇪 German' },
  { value: 'fr', label: '🇫🇷 French' },
  { value: 'es', label: '🇪🇸 Spanish' },
  { value: 'tr', label: '🇹🇷 Turkish' },
  { value: 'ru', label: '🇷🇺 Russian' },
];

const ALL_REQUEST_TYPES = [
  { id: 'room_service',       label: 'Room Service',  emoji: '🍽️' },
  { id: 'housekeeping',       label: 'Housekeeping',  emoji: '🛏️' },
  { id: 'maintenance',        label: 'Maintenance',   emoji: '🔧' },
  { id: 'concierge_question', label: 'Concierge',     emoji: '💬' },
  { id: 'complaint',          label: 'Complaint',     emoji: '⚠️' },
  { id: 'other',              label: 'Other',         emoji: '📋' },
];

const DAY_TYPES = [
  { value: 'both',    label: 'Every day' },
  { value: 'weekday', label: 'Weekdays' },
  { value: 'weekend', label: 'Weekends' },
];

type FormData = {
  name: string;
  whatsapp: string;
  request_types: string[];
  response_time_minutes: number;
  language: string;
  scheduling_enabled: number;
  after_hours_message: string;
  confirmation_mode: 'with_estimate' | 'notify_only';
};

type ScheduleRow = {
  id?: string;
  day_type: 'weekday' | 'weekend' | 'both';
  start_time: string;
  end_time: string;
  response_time_minutes: number;
};

const EMPTY_FORM: FormData = {
  name: '',
  whatsapp: '',
  request_types: [],
  response_time_minutes: 30,
  language: 'en',
  scheduling_enabled: 0,
  after_hours_message: '',
  confirmation_mode: 'with_estimate',
};

const EMPTY_SCHEDULE: ScheduleRow = {
  day_type: 'both',
  start_time: '08:00',
  end_time: '22:00',
  response_time_minutes: 30,
};

// ─── tiny helper to show a human ETA ─────────────────────────────────────────
function fmtEta(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins === 60) return '1 hr';
  return `${Math.round((mins / 60) * 10) / 10} hrs`;
}

// ─── ScheduleEditor ───────────────────────────────────────────────────────────
function ScheduleEditor({
  schedules,
  onChange,
}: {
  schedules: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
}) {
  function add() {
    onChange([...schedules, { ...EMPTY_SCHEDULE }]);
  }

  function remove(i: number) {
    onChange(schedules.filter((_, idx) => idx !== i));
  }

  function update(i: number, patch: Partial<ScheduleRow>) {
    onChange(schedules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  return (
    <div className="space-y-2">
      {schedules.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-2">
          No time windows yet — add at least one window so the schedule can activate
        </p>
      )}

      {schedules.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          {/* Day type */}
          <select
            value={row.day_type}
            onChange={e => update(i, { day_type: e.target.value as ScheduleRow['day_type'] })}
            className="rounded border border-slate-200 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            {DAY_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          {/* Start → end */}
          <input
            type="time"
            value={row.start_time}
            onChange={e => update(i, { start_time: e.target.value })}
            className="rounded border border-slate-200 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="time"
            value={row.end_time}
            onChange={e => update(i, { end_time: e.target.value })}
            className="rounded border border-slate-200 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />

          {/* Response time */}
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={480}
              value={row.response_time_minutes}
              onChange={e => update(i, { response_time_minutes: parseInt(e.target.value) || 30 })}
              className="w-14 rounded border border-slate-200 text-xs px-1.5 py-1 text-center focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
            <span className="text-xs text-slate-400">min</span>
          </div>

          {/* Remove */}
          <button
            type="button"
            onClick={() => remove(i)}
            className="ml-auto p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium py-1"
      >
        <Plus size={13} /> Add time window
      </button>
    </div>
  );
}

// ─── DeptForm ─────────────────────────────────────────────────────────────────
function DeptForm({
  initial,
  initialSchedules,
  onSave,
  onCancel,
  saving,
}: {
  initial: FormData;
  initialSchedules: ScheduleRow[];
  onSave: (data: FormData, schedules: ScheduleRow[]) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm]           = useState<FormData>(initial);
  const [schedules, setSchedules] = useState<ScheduleRow[]>(initialSchedules);

  function toggleType(t: string) {
    setForm(f => ({
      ...f,
      request_types: f.request_types.includes(t)
        ? f.request_types.filter(x => x !== t)
        : [...f.request_types, t],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.request_types.length) return;
    onSave(form, schedules);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Department Name"
        placeholder="e.g. Maintenance"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        required
      />
      <Input
        label="WhatsApp Number"
        placeholder="+355691234567"
        value={form.whatsapp}
        onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
        required
      />

      {/* Response time (shown only when scheduling is disabled — serves as the default) */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          {form.scheduling_enabled ? 'Default response time (outside active hours)' : 'Response time'}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={480}
            value={form.response_time_minutes}
            onChange={e => setForm(f => ({ ...f, response_time_minutes: parseInt(e.target.value) || 30 }))}
            className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-400">minutes</span>
        </div>
        <p className="text-xs text-slate-400">Shown to guests when their request is logged</p>
      </div>

      {/* Notification language */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">Notification language</label>
        <select
          value={form.language || 'en'}
          onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {DEPT_LANGUAGES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400">Request details will be translated to this language before being sent</p>
      </div>

      {/* Request types */}
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Handles these request types</p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_REQUEST_TYPES.map(t => {
            const active = form.request_types.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleType(t.id)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all',
                  active
                    ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
              >
                <span>{t.emoji}</span>
                <span className="flex-1 text-left">{t.label}</span>
                {active && <Check size={13} className="text-brand-500" />}
              </button>
            );
          })}
        </div>
        {!form.request_types.length && (
          <p className="text-xs text-red-500 mt-1">Select at least one request type</p>
        )}
      </div>

      {/* ── Active Hours Scheduling ─────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Active Hours Scheduling</span>
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, scheduling_enabled: f.scheduling_enabled ? 0 : 1 }))}
            className={clsx(
              'relative inline-flex h-5 w-9 rounded-full transition-colors focus:outline-none',
              form.scheduling_enabled ? 'bg-brand-500' : 'bg-slate-200'
            )}
          >
            <span
              className={clsx(
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
                form.scheduling_enabled ? 'translate-x-4' : 'translate-x-0.5'
              )}
            />
          </button>
        </div>

        {!form.scheduling_enabled && (
          <p className="text-xs text-slate-400">
            When enabled, requests are only routed to this department during configured hours. Outside those hours guests receive the after-hours message.
          </p>
        )}

        {!!form.scheduling_enabled && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Define when this department is active. Overnight windows (e.g. 22:00 → 06:00) are supported.
            </p>

            <ScheduleEditor schedules={schedules} onChange={setSchedules} />

            {/* After-hours message */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Moon size={12} /> After-hours message
              </label>
              <textarea
                rows={3}
                value={form.after_hours_message}
                onChange={e => setForm(f => ({ ...f, after_hours_message: e.target.value }))}
                placeholder="Your request has been logged and will be attended to first thing in the morning. For urgent matters please call reception."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              <p className="text-xs text-slate-400">Shown to guests who send a request outside active hours</p>
            </div>

            {/* Preview chip */}
            <SchedulePreview schedules={schedules} />
          </div>
        )}
      </div>

      {/* Confirmation mode */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">Confirmation Mode</label>
        <div className="flex flex-col gap-2">
          {([
            { value: 'with_estimate', label: 'With ETA', desc: 'Confirm with expected response time (e.g. "in ~30 min")' },
            { value: 'notify_only',   label: 'Notify only', desc: 'Just confirm staff were notified — no ETA mentioned' },
          ] as const).map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="confirmation_mode"
                value={opt.value}
                checked={form.confirmation_mode === opt.value}
                onChange={() => setForm(f => ({ ...f, confirmation_mode: opt.value }))}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="text-xs font-medium text-slate-700">{opt.label}</span>
                <span className="text-xs text-slate-400">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !form.request_types.length} className="flex-1">
          {saving ? 'Saving…' : 'Save Department'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── SchedulePreview ──────────────────────────────────────────────────────────
function SchedulePreview({ schedules }: { schedules: ScheduleRow[] }) {
  if (!schedules.length) return null;

  const now    = new Date();
  const cur    = now.getHours() * 60 + now.getMinutes();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const dayType   = isWeekend ? 'weekend' : 'weekday';

  const applicable = schedules.filter(s => s.day_type === 'both' || s.day_type === dayType);

  let active: ScheduleRow | null = null;
  for (const s of applicable) {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    const start = sh * 60 + sm;
    const end   = eh * 60 + em;
    const inWindow = start <= end
      ? cur >= start && cur < end
      : cur >= start || cur < end;
    if (inWindow) { active = s; break; }
  }

  return (
    <div className={clsx(
      'rounded-lg px-3 py-2 text-xs flex items-center gap-2',
      active ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
    )}>
      <span className="text-base">{active ? '✅' : '🌙'}</span>
      {active
        ? `Currently active — ETA shown to guests: ${fmtEta(active.response_time_minutes)}`
        : 'Currently after hours — guests will receive the after-hours message'}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function DepartmentsPage() {
  const [depts, setDepts]     = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [editSchedules, setEditSchedules] = useState<DepartmentSchedule[]>([]);
  const [saving, setSaving]   = useState(false);

  function load() {
    setLoading(true);
    api.getDepartments().then(setDepts).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function startEdit(dept: Department) {
    setEditing(dept);
    try {
      const rows = await api.getDeptSchedules(dept.id);
      setEditSchedules(rows);
    } catch {
      setEditSchedules([]);
    }
  }

  async function handleCreate(form: FormData, schedules: ScheduleRow[]) {
    setSaving(true);
    try {
      const created = await api.createDepartment({
        name: form.name,
        whatsapp: form.whatsapp,
        request_types: form.request_types,
        response_time_minutes: form.response_time_minutes,
        language: form.language,
        scheduling_enabled: form.scheduling_enabled,
        after_hours_message: form.after_hours_message || null,
        confirmation_mode: form.confirmation_mode,
      });
      // Save schedules using the new dept's id
      if (schedules.length > 0) {
        await api.saveDeptSchedules(created.id, schedules);
      }
      setShowAdd(false);
      load();
    } finally { setSaving(false); }
  }

  async function handleUpdate(form: FormData, schedules: ScheduleRow[]) {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateDepartment(editing.id, {
        name: form.name,
        whatsapp: form.whatsapp,
        request_types: form.request_types,
        is_active: editing.is_active,
        response_time_minutes: form.response_time_minutes,
        language: form.language,
        scheduling_enabled: form.scheduling_enabled,
        after_hours_message: form.after_hours_message || null,
        confirmation_mode: form.confirmation_mode,
      });
      // Always save schedules (empty array = delete all)
      await api.saveDeptSchedules(editing.id, schedules);
      setEditing(null);
      setEditSchedules([]);
      load();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    await api.deleteDepartment(id);
    setDepts(d => d.filter(x => x.id !== id));
  }

  async function toggleActive(dept: Department) {
    await api.updateDepartment(dept.id, {
      name: dept.name,
      whatsapp: dept.whatsapp,
      request_types: dept.request_types,
      is_active: !dept.is_active,
      response_time_minutes: dept.response_time_minutes || 30,
      language: dept.language || 'en',
      scheduling_enabled: dept.scheduling_enabled ?? 0,
      after_hours_message: dept.after_hours_message ?? null,
      confirmation_mode: dept.confirmation_mode ?? 'with_estimate',
    });
    load();
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Departments</h1>
          <p className="text-xs text-slate-400">Each department gets a WhatsApp notification when a matching request arrives</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Department
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : depts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Building2 size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No departments yet</p>
            <p className="text-xs mt-1">Add a department to start routing guest requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            {depts.map(dept => (
              <div
                key={dept.id}
                className={clsx(
                  'bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4',
                  !dept.is_active && 'opacity-50'
                )}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Building2 size={18} className="text-brand-500" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-800">{dept.name}</p>
                    {!dept.is_active && (
                      <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                    {!!dept.scheduling_enabled && (
                      <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Calendar size={10} /> Scheduled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mb-2 flex-wrap">
                    <span className="flex items-center gap-1"><Phone size={11} /> {dept.whatsapp}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {dept.response_time_minutes || 30} min</span>
                    <span>{DEPT_LANGUAGES.find(l => l.value === (dept.language || 'en'))?.label ?? '🇬🇧 English'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dept.request_types.map(t => {
                      const info = ALL_REQUEST_TYPES.find(x => x.id === t);
                      return (
                        <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                          {info?.emoji} {info?.label || t}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(dept)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => toggleActive(dept)}
                    className={clsx(
                      'p-1.5 rounded-lg transition-colors text-xs font-medium px-2',
                      dept.is_active
                        ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                        : 'text-green-600 hover:bg-green-50'
                    )}
                  >
                    {dept.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(dept.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <Modal title="Add Department" onClose={() => setShowAdd(false)} wide>
          <DeptForm
            initial={EMPTY_FORM}
            initialSchedules={[]}
            onSave={handleCreate}
            onCancel={() => setShowAdd(false)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title={`Edit — ${editing.name}`} onClose={() => { setEditing(null); setEditSchedules([]); }} wide>
          <DeptForm
            initial={{
              name: editing.name,
              whatsapp: editing.whatsapp,
              request_types: editing.request_types,
              response_time_minutes: editing.response_time_minutes || 30,
              language: editing.language || 'en',
              scheduling_enabled: editing.scheduling_enabled ?? 0,
              after_hours_message: editing.after_hours_message ?? '',
              confirmation_mode: editing.confirmation_mode ?? 'with_estimate',
            }}
            initialSchedules={editSchedules.map(s => ({
              id: s.id,
              day_type: s.day_type,
              start_time: s.start_time,
              end_time: s.end_time,
              response_time_minutes: s.response_time_minutes,
            }))}
            onSave={handleUpdate}
            onCancel={() => { setEditing(null); setEditSchedules([]); }}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  );
}
