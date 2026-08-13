import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, RefreshCw, Send, User, Bot, UserCheck, Search, Bell, BellOff, LogOut, PauseCircle, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Conversation, HotelMessage } from '../types';
import { Spinner, Button } from '../ui';

// ── Constants ─────────────────────────────────────────────────────────────────

const INBOX_POLL_MS        = 8_000;
const THREAD_POLL_MS       = 4_000;
const NOTIF_COOLDOWN_MS    = 30_000;
const BANNER_DISMISSED_KEY = 'hotel_notif_banner_dismissed';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function displayPhone(phone: string) {
  return phone.replace('whatsapp:', '').replace('instagram:', 'IG:');
}

function igDisplayName(c: { guest_name?: string | null; guest_username?: string | null; channel_user_id?: string | null }) {
  const { guest_name: name, guest_username: username, channel_user_id: psid } = c;
  if (name && username) return `${name} (@${username})`;
  if (name) return name;
  if (username) return `@${username}`;
  return `Instagram User ${psid ?? ''}`.trim();
}

// ── fireNotification ──────────────────────────────────────────────────────────

function fireNotification(
  phone: string,
  name: string | null,
  preview: string,
  cooldownRef: React.MutableRefObject<Map<string, number>>,
) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now  = Date.now();
  const last = cooldownRef.current.get(phone) ?? 0;
  if (now - last < NOTIF_COOLDOWN_MS) return;
  cooldownRef.current.set(phone, now);

  const notif = new Notification(`New message from ${name ?? displayPhone(phone)}`, {
    body: preview.slice(0, 100),
    icon: '/favicon.ico',
    tag:  `hotel-${phone}`,
  });
  notif.onclick = () => {
    window.focus();
    window.dispatchEvent(new CustomEvent('hotel:open-conversation', { detail: { guestPhone: phone } }));
    notif.close();
  };
}

// ── useNotificationPermission ─────────────────────────────────────────────────

function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );

  async function request() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  return { permission, request };
}

// ── LiveIndicator ─────────────────────────────────────────────────────────────

function LiveIndicator() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span className="text-[10px] font-medium text-green-600">Live</span>
    </span>
  );
}

// ── CountdownTimer ────────────────────────────────────────────────────────────

function CountdownTimer({
  pausedUntil,
  onExpired,
}: {
  pausedUntil: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function tick() {
      const diff = new Date(pausedUntil).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('0:00');
        onExpired();
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pausedUntil, onExpired]);

  return <span className="font-mono font-semibold">{remaining}</span>;
}

// ── usePauseStatus ─────────────────────────────────────────────────────────────

interface PauseStatus {
  paused: boolean;
  paused_until: string | null;
  minutes_remaining: number;
}

function usePauseStatus(guestPhone: string) {
  const [status, setStatus]   = useState<PauseStatus>({ paused: false, paused_until: null, minutes_remaining: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.getPauseStatus(guestPhone);
      setStatus({ paused: s.paused, paused_until: s.paused_until, minutes_remaining: s.minutes_remaining });
    } catch {}
  }, [guestPhone]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function takeOver() {
    setLoading(true);
    try {
      const s = await api.pauseAI(guestPhone, 15);
      setStatus({ paused: true, paused_until: s.paused_until, minutes_remaining: s.minutes_remaining });
    } catch {} finally { setLoading(false); }
  }

  async function resumeAI() {
    setLoading(true);
    try {
      await api.resumeAI(guestPhone);
      setStatus({ paused: false, paused_until: null, minutes_remaining: 0 });
    } catch {} finally { setLoading(false); }
  }

  return { status, loading, takeOver, resumeAI, reload: load };
}

// ── NotificationBanner ────────────────────────────────────────────────────────

function NotificationBanner({ permission, onRequest }: {
  permission: NotificationPermission;
  onRequest: () => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(BANNER_DISMISSED_KEY) === '1',
  );

  if (dismissed || permission !== 'default') return null;

  function dismiss() {
    localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs flex-shrink-0">
      <span className="flex items-center gap-2 text-amber-800">
        <Bell size={13} className="flex-shrink-0 text-amber-500" />
        Enable desktop notifications to be alerted when guests message you.
      </span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onRequest}
          className="px-2.5 py-1 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
        >
          Enable
        </button>
        <button
          onClick={dismiss}
          className="text-amber-400 hover:text-amber-600"
          aria-label="Dismiss"
        >
          <BellOff size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, guestName, roomNumber }: {
  msg: HotelMessage;
  guestName: string | null;
  roomNumber: string | null;
}) {
  const isGuest = msg.role === 'user';
  const isAI    = msg.role === 'assistant';
  const isStaff = msg.role === 'staff';

  return (
    <div className={clsx('flex gap-2 max-w-[85%]', isGuest ? 'self-start' : 'self-end flex-row-reverse')}>
      {/* Avatar */}
      <div className={clsx(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1',
        isGuest ? 'bg-slate-200 text-slate-500' :
        isAI    ? 'bg-brand-100 text-brand-600' :
                  'bg-blue-100 text-blue-600',
      )}>
        {isGuest ? <User size={13} /> : isAI ? <Bot size={13} /> : <UserCheck size={13} />}
      </div>

      <div className={clsx('flex flex-col gap-1', isGuest ? 'items-start' : 'items-end')}>
        {/* Label */}
        <span className="text-[10px] text-slate-400 px-1">
          {isGuest
            ? `${guestName ?? 'Guest'}${roomNumber ? ` · Room ${roomNumber}` : ''}`
            : isAI ? 'SkedAI' : 'Front Office'}
        </span>

        {/* Email subject label (shown above bubble when present) */}
        {msg.subject && (
          <div className={clsx('px-1', isGuest ? 'text-left' : 'text-right')}>
            <span className="text-[10px] font-semibold text-slate-500">{msg.subject}</span>
            {msg.from && (
              <span className="text-[10px] text-slate-400 ml-1.5">{msg.from}</span>
            )}
          </div>
        )}

        {/* Bubble */}
        <div className={clsx(
          'px-3 py-2 rounded-2xl text-sm leading-relaxed',
          isGuest
            ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
            : isAI
              ? 'bg-brand-500 text-white rounded-tr-sm'
              : 'bg-blue-500 text-white rounded-tr-sm',
        )}>
          {msg.content}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-slate-400 px-1">{formatTime(msg.ts)}</span>
      </div>
    </div>
  );
}

// ── Thread panel ──────────────────────────────────────────────────────────────

function ThreadPanel({
  conv,
  onClose,
  onCheckout,
  surveyEnabled,
}: {
  conv: Conversation;
  onClose: () => void;
  onCheckout: () => void;
  surveyEnabled: boolean;
}) {
  const [messages,    setMessages]    = useState<HotelMessage[]>(conv.messages ?? []);
  const [reply,       setReply]       = useState('');
  const [sending,     setSending]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const pause = usePauseStatus(conv.guest_phone);
  // Live stay info — refreshed from the full conversation endpoint
  const [stayInfo, setStayInfo] = useState({
    stay_id:      conv.stay_id,
    guest_status: conv.guest_status,
    survey_sent:  conv.survey_sent,
    survey_score: conv.survey_score,
  });
  const bottomRef           = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef<number>(0);
  const isInitialLoadRef    = useRef<boolean>(true);

  function loadThread() {
    return api.getConversation(conv.guest_phone)
      .then(full => {
        if (full?.messages) setMessages(full.messages);
        // Refresh stay info from the full response
        setStayInfo({
          stay_id:      (full as any)?.stay_id      ?? null,
          guest_status: (full as any)?.guest_status ?? null,
          survey_sent:  !!(full as any)?.survey_sent,
          survey_score: (full as any)?.survey_score ?? null,
        });
      })
      .catch(() => {});
  }

  // Reset scroll tracking when conversation changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    prevMessageCountRef.current = 0;
  }, [conv.guest_phone]);

  // Load full thread on mount / conversation change
  useEffect(() => {
    setLoading(true);
    loadThread().finally(() => setLoading(false));
  }, [conv.guest_phone]);

  // Poll thread every 4s
  useEffect(() => {
    const id = setInterval(loadThread, THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [conv.guest_phone]);

  // Controlled scroll — only on initial open or new customer message on idle conversation
  useEffect(() => {
    if (messages.length === 0) return;

    if (isInitialLoadRef.current) {
      // First load of this conversation — scroll to bottom once
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      isInitialLoadRef.current = false;
      prevMessageCountRef.current = messages.length;
      return;
    }

    const hasNewMessage = messages.length > prevMessageCountRef.current;
    if (hasNewMessage) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        // Only scroll if conversation was idle (5+ min since second-to-last message)
        const secondToLast = messages[messages.length - 2];
        const wasIdle = !secondToLast ||
          Date.now() - new Date(secondToLast.ts).getTime() > 5 * 60 * 1000;
        if (wasIdle) {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
      prevMessageCountRef.current = messages.length;
    }
  }, [messages]);

  async function handleCheckout() {
    if (!stayInfo.stay_id) return;
    if (!window.confirm(`Check out ${conv.guest_name ?? 'this guest'} and send a satisfaction survey?`)) return;
    setCheckingOut(true);
    try {
      await api.checkoutAndSurvey(stayInfo.stay_id);
      await loadThread();
      onCheckout(); // refresh parent inbox list
    } catch (e: any) {
      alert(`Checkout failed: ${e.message}`);
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleSend() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.replyToGuest(conv.id, text);
      const staffMsg: HotelMessage = { role: 'staff', content: text, ts: new Date().toISOString() };
      setMessages(m => [...m, staffMsg]);
      setReply('');
    } catch (e: any) {
      alert(`Failed to send: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
            <User size={15} className="text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {conv.channel === 'instagram'
                ? igDisplayName(conv)
                : conv.channel === 'email'
                  ? (conv.email_from_name ?? conv.email_from_address ?? displayPhone(conv.guest_phone))
                  : (conv.guest_name ?? displayPhone(conv.guest_phone))}
            </p>
            <p className="text-xs text-slate-400 truncate">
              {conv.channel === 'email'
                ? (conv.email_subject ? `Re: ${conv.email_subject}` : conv.email_from_address ?? displayPhone(conv.guest_phone))
                : `${displayPhone(conv.guest_phone)}${conv.room_number ? ` · Room ${conv.room_number}` : ''}`}
            </p>
          </div>
        </div>

        {/* Controls: takeover + survey + back */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* ── Takeover buttons ── */}
          {pause.status.paused ? (
            <>
              <button
                onClick={pause.resumeAI}
                disabled={pause.loading}
                className="text-xs font-medium px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-40"
              >
                ▶ Resume AI
              </button>
              <button
                onClick={pause.takeOver}
                disabled={pause.loading}
                className="text-xs font-medium px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-40"
              >
                ⏸ +15 min
              </button>
            </>
          ) : (
            <button
              onClick={pause.takeOver}
              disabled={pause.loading}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-colors disabled:opacity-40"
            >
              {pause.loading ? <RefreshCw size={11} className="animate-spin" /> : '✋'}
              Take over
            </button>
          )}

          {/* ── Survey / checkout ── */}
          {surveyEnabled && !stayInfo.survey_sent &&
           conv.last_guest_message_at != null &&
           (Date.now() - new Date(conv.last_guest_message_at).getTime()) < 86_400_000 && (
            <button
              onClick={handleCheckout}
              disabled={checkingOut}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {checkingOut
                ? <RefreshCw size={12} className="animate-spin" />
                : <LogOut size={12} />}
              Send survey
            </button>
          )}
          {stayInfo.survey_sent && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Survey sent</span>
              {stayInfo.survey_score != null && (
                <span className={`font-semibold ${stayInfo.survey_score >= 8 ? 'text-green-600' : 'text-red-500'}`}>
                  · {stayInfo.survey_score}/10
                </span>
              )}
              {stayInfo.survey_score == null && (
                <span className="text-amber-500 font-medium">· Awaiting reply</span>
              )}
            </div>
          )}
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100">
            ← Back
          </button>
        </div>
      </div>

      {/* Pause banner — shown when AI is paused */}
      {pause.status.paused && pause.status.paused_until && (
        <div className="flex-shrink-0 mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PauseCircle size={18} className="text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800">AI paused · you have control</p>
              <p className="text-xs text-amber-600 mt-0.5">
                AI resumes automatically in{' '}
                <CountdownTimer
                  pausedUntil={pause.status.paused_until}
                  onExpired={() => {
                    pause.reload();
                  }}
                />
              </p>
            </div>
          </div>
          <button
            onClick={pause.resumeAI}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 flex-shrink-0 whitespace-nowrap"
          >
            Resume now →
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {loading ? <Spinner /> : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No messages yet</div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              guestName={conv.guest_name}
              roomNumber={conv.room_number}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply as Front Office… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
          />
          <Button
            onClick={handleSend}
            disabled={!reply.trim() || sending}
            size="sm"
            className="h-10 px-3"
          >
            {sending
              ? <RefreshCw size={14} className="animate-spin" />
              : <Send size={14} />}
          </Button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1 ml-1">
          Message sent via {conv.channel === 'instagram' ? 'Instagram' : conv.channel === 'email' ? 'Email' : 'WhatsApp'} as <span className="font-medium">Front Office</span>
        </p>
      </div>
    </div>
  );
}

// ── FaqExtractModal ───────────────────────────────────────────────────────────

interface FaqExtractData {
  question: string;
  answer: string;
  suggested_category: string;
  answer_source: 'staff' | 'ai_suggested';
  similar_faqs: { id: string; question: string; category: string }[];
  existing_categories: string[];
}

interface FaqModalState {
  noFaqFound: boolean;
  result: FaqExtractData | null;
}

function FaqExtractModal({ state, onClose, onSaved }: {
  state: FaqModalState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = state.result;
  const [question,    setQuestion]    = useState(r?.question           ?? '');
  const [answer,      setAnswer]      = useState(r?.answer             ?? '');
  const [category,    setCategory]    = useState(r?.suggested_category ?? '');
  const [showNewCat,  setShowNewCat]  = useState(false);
  const [newCat,      setNewCat]      = useState('');
  const [saving,      setSaving]      = useState(false);

  const allCategories = r ? [
    ...r.existing_categories,
    ...(r.suggested_category && !r.existing_categories.includes(r.suggested_category)
      ? [r.suggested_category] : []),
  ] : [];
  const isNewSuggested = r && r.suggested_category && !r.existing_categories.includes(r.suggested_category);

  async function handleSave() {
    const finalCategory = showNewCat ? newCat.trim() : category;
    if (!question.trim() || !answer.trim() || !finalCategory) return;
    setSaving(true);
    try {
      await api.createFaq({ question: question.trim(), answer: answer.trim(), category: finalCategory });
      onSaved();
    } catch (e: any) {
      alert(`Failed to save FAQ: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-brand-500" />
            <h2 className="font-semibold text-slate-800 text-sm">Add to FAQ</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {state.noFaqFound ? (
          <div className="px-5 py-10 text-center">
            <BookOpen size={32} className="text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">No general FAQ question found</p>
            <p className="text-xs text-slate-400 mt-1">Only guest-specific requests were detected in this conversation.</p>
            <button onClick={onClose} className="mt-5 px-5 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium text-slate-700 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Similar FAQ warning */}
            {r && r.similar_faqs.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700">⚠ Similar FAQ already exists:</p>
                {r.similar_faqs.map(f => (
                  <p key={f.id} className="text-xs text-amber-600">
                    "{f.question}" <span className="text-amber-400">({f.category})</span>
                  </p>
                ))}
                <p className="text-xs text-amber-500">You can still proceed — this will create an additional entry.</p>
              </div>
            )}

            {/* Question */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Question</label>
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
            </div>

            {/* Answer */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Answer</label>
              <textarea
                rows={4}
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
              {r?.answer_source === 'ai_suggested' && (
                <p className="text-xs text-amber-600 mt-1">ℹ This answer was suggested by AI — please review before saving.</p>
              )}
              {r?.answer_source === 'staff' && (
                <p className="text-xs text-green-600 mt-1">✓ Based on your team's reply in the conversation.</p>
              )}
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Category</label>
              {!showNewCat ? (
                <select
                  value={category}
                  onChange={e => {
                    if (e.target.value === '__new__') { setShowNewCat(true); setNewCat(r?.suggested_category ?? ''); }
                    else setCategory(e.target.value);
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 bg-white"
                >
                  {allCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}{isNewSuggested && cat === r?.suggested_category ? ' (new)' : ''}
                    </option>
                  ))}
                  <option value="__new__">＋ Create new category</option>
                </select>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    type="text"
                    value={newCat}
                    onChange={e => setNewCat(e.target.value)}
                    placeholder="New category name"
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  />
                  <button
                    onClick={() => { setShowNewCat(false); setCategory(r?.suggested_category ?? category); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 flex-shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1 pb-1">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !question.trim() || !answer.trim() || (!showNewCat && !category) || (showNewCat && !newCat.trim())}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm transition-colors"
              >
                {saving ? 'Saving…' : 'Add to FAQ'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ConversationsPage({ surveyEnabled = false, addToFaqEnabled = false }: { surveyEnabled?: boolean; addToFaqEnabled?: boolean }) {
  const [convs, setConvs]             = useState<Conversation[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<Conversation | null>(null);
  const [search, setSearch]           = useState('');
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [extractingId, setExtractingId]   = useState<string | null>(null);
  const [faqModal, setFaqModal]           = useState<FaqModalState | null>(null);
  const [faqToast, setFaqToast]           = useState(false);

  const { permission, request: requestNotifPermission } = useNotificationPermission();

  // Stable refs — safe to use inside setInterval / event listeners
  const convsRef         = useRef<Conversation[]>([]);
  const lastSeenRef      = useRef(new Map<string, string>());   // phone → updated_at (ISO)
  const lastOpenedRef    = useRef(new Map<string, string>());   // phone → ISO when opened
  const notifCooldownRef = useRef(new Map<string, number>());   // phone → epoch ms of last notif
  const initializedRef   = useRef(false);

  // ── Load / poll convs ─────────────────────────────────────────────────────
  const loadConvs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const fresh = await api.getConversations();
      setConvs(fresh);
      convsRef.current = fresh;

      if (!initializedRef.current) {
        // First load — seed lastSeen baseline, no notifications
        fresh.forEach(c => lastSeenRef.current.set(c.guest_phone, c.updated_at));
        initializedRef.current = true;
      } else {
        // Subsequent polls — detect new inbound guest messages
        fresh.forEach(c => {
          const prev  = lastSeenRef.current.get(c.guest_phone);
          const isNew = !prev || new Date(c.updated_at) > new Date(prev);
          if (isNew && c.last_message_preview?.role === 'user') {
            fireNotification(
              c.guest_phone,
              c.guest_name,
              c.last_message_preview.content,
              notifCooldownRef,
            );
          }
          lastSeenRef.current.set(c.guest_phone, c.updated_at);
        });
      }
    } catch {
      // Silently ignore network errors during background polling
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadConvs(); }, [loadConvs]);

  // Inbox poll every 8s (silent — no loading spinner flicker)
  useEffect(() => {
    const id = setInterval(() => loadConvs(true), INBOX_POLL_MS);
    return () => clearInterval(id);
  }, [loadConvs]);

  // Listen for notification-click events → open that conversation
  useEffect(() => {
    function handler(e: Event) {
      const { guestPhone } = (e as CustomEvent<{ guestPhone: string }>).detail;
      const conv = convsRef.current.find(c => c.guest_phone === guestPhone);
      if (conv) {
        lastOpenedRef.current.set(conv.guest_phone, new Date().toISOString());
        setSelected(conv);
      }
    }
    window.addEventListener('hotel:open-conversation', handler);
    return () => window.removeEventListener('hotel:open-conversation', handler);
  }, []);

  // Open a conversation and mark it as read
  function openConversation(c: Conversation) {
    lastOpenedRef.current.set(c.guest_phone, new Date().toISOString());
    setSelected(c);
  }

  // Extract FAQ from conversation
  async function handleExtractFaq(e: React.MouseEvent, c: Conversation) {
    e.stopPropagation();
    setExtractingId(c.id);
    try {
      const result = await api.extractFaq(c.id);
      if (result.no_question_found) {
        setFaqModal({ noFaqFound: true, result: null });
      } else {
        setFaqModal({
          noFaqFound: false,
          result: {
            question:           result.question           ?? '',
            answer:             result.answer             ?? '',
            suggested_category: result.suggested_category ?? 'General',
            answer_source:      result.answer_source      ?? 'ai_suggested',
            similar_faqs:       result.similar_faqs       ?? [],
            existing_categories: result.existing_categories ?? [],
          },
        });
      }
    } catch (err: any) {
      alert(`Analysis failed: ${err.message}`);
    } finally {
      setExtractingId(null);
    }
  }

  // Check out a guest directly from the list
  async function handleCheckoutFromList(e: React.MouseEvent, c: Conversation) {
    e.stopPropagation();
    if (!c.stay_id) return;
    if (!window.confirm(`Check out ${c.guest_name ?? 'this guest'} and send a satisfaction survey?`)) return;
    setCheckingOutId(c.stay_id);
    try {
      await api.checkoutAndSurvey(c.stay_id);
      await loadConvs(true);
    } catch (err: any) {
      alert(`Checkout failed: ${err.message}`);
    } finally {
      setCheckingOutId(null);
    }
  }

  const filtered = convs.filter(c => {
    const q = search.toLowerCase();
    return !q
      || (c.guest_name ?? '').toLowerCase().includes(q)
      || displayPhone(c.guest_phone).includes(q)
      || (c.room_number ?? '').includes(q)
      || (c.email_from_address ?? '').toLowerCase().includes(q)
      || (c.email_from_name ?? '').toLowerCase().includes(q)
      || (c.email_subject ?? '').toLowerCase().includes(q);
  });

  // If a conv is selected, show the thread panel full-width
  if (selected) {
    return (
      <div className="h-full flex flex-col">
        <ThreadPanel
          conv={selected}
          onClose={() => setSelected(null)}
          onCheckout={() => loadConvs(true)}
          surveyEnabled={surveyEnabled}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* FAQ extract modal */}
      {faqModal && (
        <FaqExtractModal
          state={faqModal}
          onClose={() => setFaqModal(null)}
          onSaved={() => {
            setFaqModal(null);
            setFaqToast(true);
            setTimeout(() => setFaqToast(false), 3000);
          }}
        />
      )}
      {/* FAQ saved toast */}
      {faqToast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold z-50 pointer-events-none">
          Added to FAQ ✅
        </div>
      )}

      {/* Notification permission banner */}
      <NotificationBanner permission={permission} onRequest={requestNotifPermission} />

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-800">Conversations</h1>
          <LiveIndicator />
        </div>
        <button
          onClick={() => loadConvs()}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <div className="relative flex-shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or room…"
          className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 bg-white"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <MessageSquare size={32} className="mb-2 opacity-30" />
            <p className="text-sm">{search ? 'No matching conversations' : 'No conversations yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const preview    = c.last_message_preview;
              const isStaff    = preview?.role === 'staff';
              const isAI       = preview?.role === 'assistant';
              const lastOpened = lastOpenedRef.current.get(c.guest_phone);
              const isUnread   = preview?.role === 'user' &&
                (!lastOpened || new Date(c.updated_at) > new Date(lastOpened));

              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c)}
                  className={clsx(
                    'w-full text-left bg-white border rounded-xl p-4 hover:border-brand-300 hover:shadow-sm transition-all',
                    isUnread ? 'border-brand-300 shadow-sm' : 'border-slate-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 min-w-0">
                      {/* Avatar + unread dot */}
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center">
                          <User size={16} className="text-brand-500" />
                        </div>
                        {isUnread && (
                          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-500 border-2 border-white" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={clsx(
                            'text-sm truncate',
                            isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800',
                          )}>
                            {c.channel === 'instagram'
                              ? igDisplayName(c)
                              : c.channel === 'email'
                                ? (c.email_from_name ?? c.email_from_address ?? displayPhone(c.guest_phone))
                                : (c.guest_name ?? displayPhone(c.guest_phone))}
                          </span>
                          {c.channel === 'instagram' && (
                            <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded flex-shrink-0">
                              📷 IG
                            </span>
                          )}
                          {c.channel === 'email' && (
                            <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">
                              📧 Email
                            </span>
                          )}
                          {c.room_number && (
                            <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">
                              Rm {c.room_number}
                            </span>
                          )}
                          {c.ai_paused_until && new Date(c.ai_paused_until) > new Date() && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">
                              ⏸ Staff
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mb-1 truncate">
                          {c.channel === 'email'
                            ? (c.email_from_address ?? displayPhone(c.guest_phone))
                            : displayPhone(c.guest_phone)}
                        </p>
                        {(preview || (c.channel === 'email' && c.email_subject)) && (
                          <p className={clsx(
                            'text-xs truncate',
                            isUnread ? 'text-slate-700 font-medium' : 'text-slate-500',
                          )}>
                            {c.channel === 'email' && !preview
                              ? c.email_subject
                              : (
                                <>
                                  <span className={clsx(
                                    'font-medium mr-1',
                                    isStaff ? 'text-blue-500' : isAI ? 'text-brand-500' : 'text-slate-400',
                                  )}>
                                    {isStaff ? 'You:' : isAI ? 'AI:' : ''}
                                  </span>
                                  {preview?.content}
                                </>
                              )}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-slate-400">{timeAgo(c.updated_at)}</span>
                      <span className="text-[10px] text-slate-400">{c.message_count} msg{c.message_count !== 1 ? 's' : ''}</span>
                      {/* Survey button — visible when survey is enabled AND guest messaged in last 24h */}
                      {surveyEnabled && !c.survey_sent &&
                       c.last_guest_message_at != null &&
                       (Date.now() - new Date(c.last_guest_message_at).getTime()) < 86_400_000 && (
                        <button
                          onClick={e => handleCheckoutFromList(e, c)}
                          disabled={checkingOutId === c.stay_id}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
                        >
                          {checkingOutId === c.stay_id
                            ? <RefreshCw size={9} className="animate-spin" />
                            : <LogOut size={9} />}
                          Send survey
                        </button>
                      )}
                      {/* Survey status badge */}
                      {c.guest_status === 'checked_out' && c.survey_sent && (
                        <span className={`text-[10px] font-semibold ${
                          c.survey_score != null
                            ? c.survey_score >= 8 ? 'text-green-600' : 'text-red-500'
                            : 'text-amber-500'
                        }`}>
                          {c.survey_score != null ? `★ ${c.survey_score}/10` : 'Survey pending'}
                        </span>
                      )}
                      {/* Add to FAQ button */}
                      {addToFaqEnabled && (
                        <button
                          onClick={e => handleExtractFaq(e, c)}
                          disabled={extractingId === c.id}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 text-brand-700 rounded-md border border-brand-200 transition-colors"
                        >
                          {extractingId === c.id
                            ? <RefreshCw size={9} className="animate-spin" />
                            : <BookOpen size={9} />}
                          {extractingId === c.id ? 'Analyzing…' : 'Add to FAQ'}
                        </button>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
