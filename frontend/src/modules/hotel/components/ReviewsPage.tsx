import { useState, useEffect, useCallback } from 'react';
import {
  Star, Flag, MessageSquare, Plus, RefreshCw, Check, X,
  Settings, ChevronDown, ChevronUp, Pencil, BookOpen,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { HotelReview, ReviewStats, ReviewConfig } from '../types';
import { Button, Input, Textarea, Modal, Spinner } from '../ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  booking: 'Booking.com',
  tripadvisor: 'TripAdvisor',
  google: 'Google',
  manual: 'Manual',
  unknown: 'Unknown',
};

const SOURCE_COLORS: Record<string, string> = {
  booking:     'bg-blue-50 text-blue-700',
  tripadvisor: 'bg-green-50 text-green-700',
  google:      'bg-red-50 text-red-700',
  manual:      'bg-slate-100 text-slate-600',
  unknown:     'bg-slate-100 text-slate-500',
};

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  replied:  'bg-green-50 text-green-700',
  ignored:  'bg-slate-100 text-slate-400',
};

function ScoreBadge({ score, max = 10 }: { score: number | null; max?: number }) {
  if (score == null) return <span className="text-xs text-slate-400">—</span>;
  const pct = score / max;
  const color = pct >= 0.8 ? 'text-green-600' : pct >= 0.6 ? 'text-amber-600' : 'text-red-600';
  return (
    <span className={clsx('text-sm font-semibold tabular-nums', color)}>
      {score}/{max}
    </span>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig]   = useState<ReviewConfig>({ slug: '', email: null, owner_phone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getReviewConfig()
      .then(c => setConfig(c))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateReviewConfig({
        slug: config.slug ?? '',
        owner_phone: config.owner_phone ?? '',
      });
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Review Inbox Settings" onClose={onClose} wide>
      {loading ? <Spinner /> : (
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <p className="text-xs text-slate-500 mb-3">
              Set your email slug to receive review notifications. Forward review emails from
              Booking.com / TripAdvisor / Google to this address.
            </p>
            <Input
              label="Email slug"
              placeholder="e.g. lafavorita"
              value={config.slug ?? ''}
              onChange={e => setConfig(c => ({ ...c, slug: e.target.value }))}
            />
            {config.slug && (
              <p className="text-xs text-brand-600 mt-1 font-mono">
                → forward reviews to: {config.slug}@reviews.skedai.net
              </p>
            )}
          </div>
          <Input
            label="Owner WhatsApp (for instant alerts)"
            placeholder="+355 6X XXX XXXX"
            value={config.owner_phone ?? ''}
            onChange={e => setConfig(c => ({ ...c, owner_phone: e.target.value }))}
          />
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Manual review modal ───────────────────────────────────────────────────────

function AddReviewModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    source: 'booking',
    reviewer_name: '',
    score: '',
    positive_text: '',
    negative_text: '',
    full_review_text: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createManualReview({
        ...form,
        score: form.score ? parseFloat(form.score) : undefined,
      });
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const f = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value })),
  });

  return (
    <Modal title="Add Review Manually" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
            <select
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
              {...f('source')}
            >
              {['booking', 'tripadvisor', 'google', 'manual'].map(s => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <Input label="Score (out of 10)" placeholder="e.g. 7.5" {...f('score')} />
        </div>
        <Input label="Reviewer name" placeholder="e.g. John D." {...f('reviewer_name')} />
        <Textarea label="Positive comments" placeholder="What they liked…" {...f('positive_text') as any} />
        <Textarea label="Negative comments" placeholder="What they didn't like…" {...f('negative_text') as any} />
        <Textarea label="Full review text (if no split)" placeholder="Full review…" {...f('full_review_text') as any} />
        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? 'Analysing…' : 'Add & Analyse'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Review card ───────────────────────────────────────────────────────────────

function ReviewCard({
  review,
  onUpdate,
}: {
  review: HotelReview;
  onUpdate: (id: string, data: { status?: string; final_response?: string }) => Promise<void>;
}) {
  const [open, setOpen]             = useState(review.is_flagged === 1);
  const [response, setResponse]     = useState(review.final_response ?? review.suggested_response ?? '');
  const [editing, setEditing]       = useState(false);
  const [regenerating, setRegen]    = useState(false);
  const [acting, setActing]         = useState(false);

  async function handleRegenerate() {
    setRegen(true);
    try {
      const r = await api.regenerateResponse(review.id);
      setResponse(r.suggested_response ?? '');
    } finally {
      setRegen(false);
    }
  }

  async function handleAction(status: string) {
    setActing(true);
    try {
      await onUpdate(review.id, {
        status,
        final_response: status !== 'ignored' ? response : undefined,
      });
    } finally {
      setActing(false);
    }
  }

  const isDone = review.status === 'replied' || review.status === 'ignored';

  return (
    <div className={clsx(
      'bg-white rounded-xl border overflow-hidden',
      review.is_flagged === 1 && review.status === 'pending'
        ? 'border-red-200'
        : 'border-slate-200',
    )}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        {review.is_flagged === 1 && review.status === 'pending' && (
          <Flag size={13} className="text-red-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', SOURCE_COLORS[review.source] || SOURCE_COLORS.unknown)}>
              {SOURCE_LABELS[review.source] || review.source}
            </span>
            <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full capitalize', STATUS_COLORS[review.status] || STATUS_COLORS.pending)}>
              {review.status}
            </span>
            <ScoreBadge score={review.score} max={review.score_max} />
          </div>
          <p className="text-sm text-slate-700 truncate">
            {review.reviewer_name || 'Anonymous'
            }{review.flag_reason ? ` — ${review.flag_reason}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-slate-400 text-xs">
          {new Date(review.created_at).toLocaleDateString()}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50 space-y-3">
          {/* Review text */}
          {review.positive_text && (
            <div>
              <p className="text-xs font-semibold text-green-600 mb-0.5">Positive</p>
              <p className="text-sm text-slate-600 leading-relaxed">{review.positive_text}</p>
            </div>
          )}
          {review.negative_text && (
            <div>
              <p className="text-xs font-semibold text-red-500 mb-0.5">Negative</p>
              <p className="text-sm text-slate-600 leading-relaxed">{review.negative_text}</p>
            </div>
          )}
          {!review.positive_text && !review.negative_text && review.full_review_text && (
            <p className="text-sm text-slate-600 leading-relaxed">{review.full_review_text}</p>
          )}

          {/* Suggested response */}
          {!isDone && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-slate-500">Suggested Response</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(e => !e)}
                    className="text-xs text-brand-600 hover:underline flex items-center gap-1"
                  >
                    <Pencil size={11} /> {editing ? 'Done editing' : 'Edit'}
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="text-xs text-slate-500 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} />
                    Regenerate
                  </button>
                </div>
              </div>
              {editing ? (
                <Textarea
                  value={response}
                  onChange={(e: any) => setResponse(e.target.value)}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm text-slate-600 bg-white rounded-lg border border-slate-200 p-3 leading-relaxed">
                  {response || <span className="italic text-slate-400">No response generated</span>}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() => handleAction('replied')}
                  className="flex items-center gap-1"
                >
                  <Check size={13} /> Mark Replied
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => handleAction('ignored')}
                  className="text-slate-500"
                >
                  <X size={13} /> Ignore
                </Button>
              </div>
            </div>
          )}

          {/* Final response if done */}
          {isDone && review.final_response && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">Your Response</p>
              <p className="text-sm text-slate-600 bg-white rounded-lg border border-slate-200 p-3 leading-relaxed">
                {review.final_response}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'flagged' | 'pending' | 'replied' | 'ignored';

export function ReviewsPage() {
  const [reviews, setReviews]     = useState<HotelReview[]>([]);
  const [stats, setStats]         = useState<ReviewStats | null>(null);
  const [filter, setFilter]       = useState<Filter>('all');
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [showSettings, setSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params =
        filter === 'flagged' ? { flagged: true } :
        filter === 'all'     ? {} :
        { status: filter };
      const [r, s] = await Promise.all([api.getReviews(params), api.getReviewStats()]);
      setReviews(r);
      setStats(s);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(id: string, data: { status?: string; final_response?: string }) {
    await api.updateReview(id, data);
    setReviews(rs => rs.map(r =>
      r.id === id ? { ...r, ...data, status: (data.status ?? r.status) as any } : r,
    ));
    // Refresh stats
    api.getReviewStats().then(setStats).catch(() => {});
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all',     label: 'All' },
    { id: 'flagged', label: `Flagged${stats?.flagged ? ` (${stats.flagged})` : ''}` },
    { id: 'pending', label: `Pending${stats?.pending ? ` (${stats.pending})` : ''}` },
    { id: 'replied', label: 'Replied' },
    { id: 'ignored', label: 'Ignored' },
  ];

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Reviews</h1>
          <p className="text-xs text-slate-400">AI-analysed guest reviews with suggested responses</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSettings(true)}>
            <Settings size={13} /> Setup
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Review
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 flex-shrink-0">
          {[
            { label: 'Total',    value: stats.total },
            { label: 'Flagged',  value: stats.flagged,  danger: true },
            { label: 'Pending',  value: stats.pending },
            { label: 'Avg score', value: stats.avg_score != null ? stats.avg_score.toFixed(1) : '—' },
          ].map(({ label, value, danger }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 px-3 py-2 text-center">
              <p className={clsx('text-lg font-semibold', danger && Number(value) > 0 ? 'text-red-500' : 'text-slate-800')}>
                {value}
              </p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 flex-shrink-0 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              filter === f.id
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <BookOpen size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No reviews yet</p>
            <p className="text-xs mt-1">Add one manually or set up email forwarding in Setup</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reviews.map(r => (
              <ReviewCard key={r.id} review={r} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddReviewModal onClose={() => setShowAdd(false)} onAdded={load} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setSettings(false)} />
      )}
    </div>
  );
}
