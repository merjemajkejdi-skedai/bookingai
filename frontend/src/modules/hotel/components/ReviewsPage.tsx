import { useState, useEffect, useCallback } from 'react';
import {
  Flag, Plus, RefreshCw, Check, X,
  Settings, ChevronDown, ChevronUp, Pencil, BookOpen,
  AlertTriangle, Copy,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { HotelReview, ReviewStats, ReviewConfig } from '../types';
import { Button, Input, Textarea, Modal, Spinner } from '../ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  booking:     'Booking.com',
  tripadvisor: 'TripAdvisor',
  google:      'Google',
  manual:      'Manual',
  unknown:     'Unknown',
};

const SOURCE_COLORS: Record<string, string> = {
  booking:     'bg-blue-50 text-blue-700',
  tripadvisor: 'bg-green-50 text-green-700',
  google:      'bg-red-50 text-red-700',
  manual:      'bg-slate-100 text-slate-600',
  unknown:     'bg-slate-100 text-slate-500',
};

function ScoreBadge({ score, max = 10 }: { score: number | null; max?: number }) {
  if (score == null) return <span className="text-xs text-slate-400">—</span>;
  const pct = score / max;
  const color = pct >= 0.8 ? 'text-green-600' : pct >= 0.6 ? 'text-amber-500' : 'text-red-500';
  return (
    <span className={clsx('text-sm font-bold tabular-nums', color)}>
      {score}/{max}
    </span>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig]   = useState<ReviewConfig>({ slug: '', email: null, owner_phone: '', notification_frequency: 'immediate' });
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
          <p className="text-xs text-slate-500">
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
            <p className="text-xs text-brand-600 font-mono -mt-2">
              → forward reviews to: {config.slug}@reviews.skedai.net
            </p>
          )}
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

// ── Add review modal ──────────────────────────────────────────────────────────

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
  const [open, setOpen]          = useState(review.is_flagged === 1);
  const [response, setResponse]  = useState(review.final_response ?? review.suggested_response ?? '');
  const [editing, setEditing]    = useState(false);
  const [regenerating, setRegen] = useState(false);
  const [acting, setActing]      = useState(false);
  const [copied, setCopied]      = useState(false);

  const isFlagged  = review.is_flagged === 1;
  const isPositive = review.score != null && review.score_max > 0 && (review.score / review.score_max) >= 0.8;
  const isDone     = review.status === 'replied' || review.status === 'ignored';

  // Always show the most critical text in the card header preview
  const previewText = review.negative_text || review.full_review_text || review.positive_text;

  async function handleCopyAndReply() {
    try { await navigator.clipboard.writeText(response); } catch { /* clipboard denied */ }
    setCopied(true);
    setActing(true);
    try {
      await onUpdate(review.id, { status: 'replied', final_response: response });
    } finally {
      setActing(false);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  async function handleRegenerate() {
    setRegen(true);
    try {
      const r = await api.regenerateResponse(review.id);
      setResponse(r.suggested_response ?? '');
    } finally {
      setRegen(false);
    }
  }

  async function handleIgnore() {
    setActing(true);
    try {
      await onUpdate(review.id, { status: 'ignored' });
    } finally {
      setActing(false);
    }
  }

  return (
    <div className={clsx(
      'rounded-xl overflow-hidden border border-l-4',
      isFlagged
        ? 'border-slate-200 border-l-red-500 bg-red-50'
        : isPositive
          ? 'border-slate-200 border-l-green-400 bg-white'
          : 'border-slate-200 border-l-amber-300 bg-white',
    )}>
      {/* ── Collapsed header ─────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex-1 min-w-0">
          {/* Badges row */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isFlagged && <Flag size={12} className="text-red-500 flex-shrink-0" />}
            <span className={clsx(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              SOURCE_COLORS[review.source] ?? SOURCE_COLORS.unknown,
            )}>
              {SOURCE_LABELS[review.source] ?? review.source}
            </span>
            <ScoreBadge score={review.score} max={review.score_max} />
            <span className="text-xs text-slate-600 font-medium truncate">
              {review.reviewer_name || 'Anonymous'}
            </span>
            {review.status === 'replied' && (
              <span className="text-xs text-green-600 font-medium flex items-center gap-0.5">
                <Check size={11} /> Replied
              </span>
            )}
            {review.status === 'ignored' && (
              <span className="text-xs text-slate-400 font-medium">Ignored</span>
            )}
          </div>
          {/* Preview text — always visible, uses negative copy first */}
          {previewText && (
            <p className="text-sm text-slate-600 line-clamp-2 leading-snug">{previewText}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-slate-400 mt-0.5">
          <span className="whitespace-nowrap">{new Date(review.created_at).toLocaleDateString()}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* ── Expanded body ────────────────────────────────────────────────── */}
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-3">

          {/* Flag reason — prominent red block */}
          {isFlagged && review.flag_reason && (
            <div className="flex items-start gap-2 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 leading-snug font-medium">{review.flag_reason}</p>
            </div>
          )}

          {/* Review content */}
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

          {/* ── Response section (pending/approved only) ───────────────── */}
          {!isDone && (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-slate-500">Suggested Response</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditing(e => !e)}
                    className="text-xs text-brand-600 hover:underline flex items-center gap-1"
                  >
                    <Pencil size={11} /> {editing ? 'Done' : 'Edit'}
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-40"
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
                <p className="text-sm text-slate-600 bg-white rounded-lg border border-slate-200 p-3 leading-relaxed whitespace-pre-wrap min-h-[60px]">
                  {response
                    ? response
                    : <span className="italic text-slate-400">No response generated</span>}
                </p>
              )}

              <div className="flex gap-2 mt-2 flex-wrap">
                <Button
                  size="sm"
                  disabled={acting || !response}
                  onClick={handleCopyAndReply}
                  className="flex items-center gap-1.5"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied & marked replied!' : 'Copy & mark replied'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={acting}
                  onClick={handleIgnore}
                  className="text-slate-400 hover:text-slate-600 flex items-center gap-1"
                >
                  <X size={13} /> Ignore
                </Button>
              </div>
            </div>
          )}

          {/* ── Replied state ─────────────────────────────────────────── */}
          {review.status === 'replied' && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                <Check size={12} className="text-green-500" />
                Response sent
                {review.replied_at && (
                  <span className="font-normal text-slate-400 ml-1">
                    · {new Date(review.replied_at).toLocaleDateString()}
                  </span>
                )}
              </p>
              {review.final_response && (
                <p className="text-sm text-slate-600 bg-white rounded-lg border border-slate-200 p-3 leading-relaxed whitespace-pre-wrap">
                  {review.final_response}
                </p>
              )}
            </div>
          )}

          {/* ── Ignored state ─────────────────────────────────────────── */}
          {review.status === 'ignored' && (
            <p className="text-xs text-slate-400 italic">This review was marked as ignored.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'flagged' | 'pending' | 'replied';

export function ReviewsPage() {
  const [reviews, setReviews]         = useState<HotelReview[]>([]);
  const [stats, setStats]             = useState<ReviewStats | null>(null);
  const [filter, setFilter]           = useState<Filter>('all');
  const [loading, setLoading]         = useState(true);
  const [showManual, setShowManual]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([api.getReviews(), api.getReviewStats()]);
      // Sort: flagged-pending first → flagged-done → non-flagged, all by date desc
      (r as HotelReview[]).sort((a, b) => {
        const aScore = a.is_flagged === 1 && a.status === 'pending' ? 2
                     : a.is_flagged === 1 ? 1 : 0;
        const bScore = b.is_flagged === 1 && b.status === 'pending' ? 2
                     : b.is_flagged === 1 ? 1 : 0;
        return bScore - aScore || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setReviews(r);
      setStats(s);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(id: string, data: { status?: string; final_response?: string }) {
    await api.updateReview(id, data);
    setReviews(rs => rs.map(r =>
      r.id === id ? { ...r, ...data, status: (data.status ?? r.status) as any } : r,
    ));
    api.getReviewStats().then(setStats).catch(() => {});
  }

  // Filter on the frontend so sort order is preserved
  const filtered = reviews.filter(r => {
    if (filter === 'flagged') return r.is_flagged === 1;
    if (filter === 'pending') return r.status === 'pending';
    if (filter === 'replied') return r.status === 'replied';
    return true;
  });

  // Flagged reviews that still need action
  const flaggedPending = reviews.filter(r => r.is_flagged === 1 && r.status === 'pending').length;

  // Response rate
  const responseRate = stats && stats.total > 0
    ? Math.round((stats.replied / stats.total) * 100)
    : 0;

  const FILTER_TABS: { id: Filter; label: string; badge?: number; red?: boolean }[] = [
    { id: 'all',     label: 'All' },
    { id: 'flagged', label: 'Flagged', badge: stats?.flagged, red: true },
    { id: 'pending', label: 'Pending', badge: stats?.pending },
    { id: 'replied', label: 'Replied' },
  ];

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Reviews</h1>
          <p className="text-xs text-slate-400">AI-analysed guest reviews with suggested responses</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowSettings(true)}>
            <Settings size={13} /> Setup
          </Button>
          <Button size="sm" onClick={() => setShowManual(true)}>
            <Plus size={14} /> Add Review
          </Button>
        </div>
      </div>

      {/* ── Alert banner ─────────────────────────────────────────────────── */}
      {flaggedPending > 0 && (
        <div className="flex items-center justify-between bg-red-600 text-white rounded-xl px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span className="text-sm font-medium">
              {flaggedPending} flagged review{flaggedPending !== 1 ? 's' : ''}{' '}
              need{flaggedPending === 1 ? 's' : ''} your attention
            </span>
          </div>
          <button
            onClick={() => setFilter('flagged')}
            className="text-sm font-semibold hover:underline whitespace-nowrap ml-4 opacity-90 hover:opacity-100"
          >
            View now →
          </button>
        </div>
      )}

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 flex-shrink-0">
          {/* Avg Score */}
          <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-center">
            <p className={clsx(
              'text-xl font-bold',
              stats.avg_score == null    ? 'text-slate-400'
                : stats.avg_score >= 8  ? 'text-green-600'
                : stats.avg_score >= 6  ? 'text-amber-500'
                : 'text-red-500',
            )}>
              {stats.avg_score != null ? stats.avg_score.toFixed(1) : '—'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Avg Score</p>
          </div>

          {/* Need Response */}
          <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-center">
            <p className={clsx('text-xl font-bold', stats.pending > 0 ? 'text-amber-500' : 'text-slate-800')}>
              {stats.pending}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Need Response</p>
          </div>

          {/* Flagged */}
          <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-center">
            <p className={clsx('text-xl font-bold', flaggedPending > 0 ? 'text-red-500' : 'text-slate-800')}>
              {stats.flagged}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Flagged</p>
          </div>

          {/* Response Rate */}
          <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-center">
            <p className={clsx(
              'text-xl font-bold',
              stats.total === 0     ? 'text-slate-400'
                : responseRate >= 80 ? 'text-green-600'
                : responseRate >= 50 ? 'text-amber-500'
                : 'text-slate-800',
            )}>
              {stats.total === 0 ? '—' : `${responseRate}%`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Response Rate</p>
          </div>
        </div>
      )}

      {/* ── Filter tabs ──────────────────────────────────────────────────── */}
      <div className="bg-slate-100 rounded-xl p-1 flex gap-1 flex-shrink-0">
        {FILTER_TABS.map(tab => {
          const hasBadge = (tab.badge ?? 0) > 0;
          const isActive = filter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                isActive
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {/* Red dot for Flagged tab */}
              {tab.red && hasBadge && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              )}
              {tab.label}
              {/* Count badge */}
              {hasBadge && (
                <span className={clsx(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-none',
                  tab.red
                    ? isActive ? 'bg-red-100 text-red-600' : 'bg-white/80 text-red-500'
                    : isActive ? 'bg-slate-100 text-slate-600' : 'bg-white/80 text-slate-500',
                )}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Review list ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <BookOpen size={32} className="mb-2 opacity-30" />
            <p className="text-sm">
              {filter === 'flagged' ? 'No flagged reviews — all clear!' :
               filter === 'pending' ? 'No pending reviews — great job!' :
               filter === 'replied' ? 'No replied reviews yet' :
               'No reviews yet'}
            </p>
            {filter === 'all' && (
              <p className="text-xs mt-1">Add one manually or set up email forwarding in Setup</p>
            )}
          </div>
        ) : (
          <div className="space-y-2 pb-2">
            {filtered.map(r => (
              <ReviewCard key={r.id} review={r} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>

      {showManual && (
        <AddReviewModal onClose={() => setShowManual(false)} onAdded={load} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
