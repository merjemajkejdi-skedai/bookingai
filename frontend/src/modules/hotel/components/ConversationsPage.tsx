import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, RefreshCw, Send, User, Bot, UserCheck, Search } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Conversation, HotelMessage } from '../types';
import { Spinner, Button } from '../ui';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  return phone.replace('whatsapp:', '');
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
                  'bg-blue-100 text-blue-600'
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

        {/* Bubble */}
        <div className={clsx(
          'px-3 py-2 rounded-2xl text-sm leading-relaxed',
          isGuest
            ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
            : isAI
              ? 'bg-brand-500 text-white rounded-tr-sm'
              : 'bg-blue-500 text-white rounded-tr-sm'
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

function ThreadPanel({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const [messages, setMessages]   = useState<HotelMessage[]>(conv.messages ?? []);
  const [reply, setReply]         = useState('');
  const [sending, setSending]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load full thread on mount
  useEffect(() => {
    setLoading(true);
    api.getConversation(conv.guest_phone)
      .then(full => { if (full?.messages) setMessages(full.messages); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [conv.guest_phone]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.replyToGuest(conv.guest_phone, text);
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
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center">
              <User size={15} className="text-brand-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {conv.guest_name ?? displayPhone(conv.guest_phone)}
              </p>
              <p className="text-xs text-slate-400">
                {displayPhone(conv.guest_phone)}
                {conv.room_number && ` · Room ${conv.room_number}`}
              </p>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100">
          ← Back
        </button>
      </div>

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
          Message sent via WhatsApp as <span className="font-medium">Front Office</span>
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ConversationsPage() {
  const [convs, setConvs]         = useState<Conversation[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Conversation | null>(null);
  const [search, setSearch]       = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getConversations()
      .then(setConvs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = convs.filter(c => {
    const q = search.toLowerCase();
    return !q
      || (c.guest_name ?? '').toLowerCase().includes(q)
      || displayPhone(c.guest_phone).includes(q)
      || (c.room_number ?? '').includes(q);
  });

  // If a conv is selected, show the thread panel full-width
  if (selected) {
    return (
      <div className="h-full flex flex-col">
        <ThreadPanel conv={selected} onClose={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-semibold text-slate-800">Conversations</h1>
        <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
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
              const preview = c.last_message_preview;
              const isStaff = preview?.role === 'staff';
              const isAI    = preview?.role === 'assistant';
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 min-w-0">
                      {/* Avatar */}
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center">
                        <User size={16} className="text-brand-500" />
                      </div>

                      {/* Content */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {c.guest_name ?? displayPhone(c.guest_phone)}
                          </span>
                          {c.room_number && (
                            <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">
                              Rm {c.room_number}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mb-1 truncate">
                          {displayPhone(c.guest_phone)}
                        </p>
                        {preview && (
                          <p className="text-xs text-slate-500 truncate">
                            <span className={clsx(
                              'font-medium mr-1',
                              isStaff ? 'text-blue-500' : isAI ? 'text-brand-500' : 'text-slate-400'
                            )}>
                              {isStaff ? 'You:' : isAI ? 'AI:' : ''}
                            </span>
                            {preview.content}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] text-slate-400">{timeAgo(c.updated_at)}</span>
                      <span className="text-[10px] text-slate-400">{c.message_count} msg{c.message_count !== 1 ? 's' : ''}</span>
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
