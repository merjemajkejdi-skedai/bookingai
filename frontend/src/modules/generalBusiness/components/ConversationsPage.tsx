import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, RefreshCw, Send, User, Bot, UserCheck, Search, PauseCircle, PlayCircle } from 'lucide-react';
import clsx from 'clsx';
import { gbApi } from '../api';
import type { GbConversation } from '../types';

const INBOX_POLL_MS = 8_000;
const THREAD_POLL_MS = 4_000;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function displayPhone(phone: string) {
  return phone
    .replace('whatsapp:', '')
    .replace('instagram:', 'IG:')
    .replace('messenger:', 'FB:')
    .replace('email:', '');
}

function channelBadge(ch: string) {
  if (ch === 'instagram') return 'IG';
  if (ch === 'messenger') return 'FB';
  if (ch === 'email') return 'Email';
  return 'WA';
}

function guestLabel(c: GbConversation) {
  if (c.guest_name) return c.guest_name;
  if (c.guest_username) return `@${c.guest_username}`;
  if (c.guest_email) return c.guest_email;
  if (c.guest_phone) return displayPhone(c.guest_phone);
  return 'Unknown';
}

export function GbConversationsPage() {
  const [convos, setConvos] = useState<GbConversation[]>([]);
  const [selected, setSelected] = useState<GbConversation | null>(null);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    try {
      const list = await gbApi.getConversations();
      setConvos(list);
    } catch { /* silent */ }
  }, []);

  const loadThread = useCallback(async () => {
    if (!selected) return;
    try {
      const c = await gbApi.getConversation(selected.id);
      setSelected(c);
    } catch { /* silent */ }
  }, [selected?.id]);

  useEffect(() => {
    loadInbox().then(() => setLoading(false));
    const i = setInterval(loadInbox, INBOX_POLL_MS);
    return () => clearInterval(i);
  }, [loadInbox]);

  useEffect(() => {
    if (!selected) return;
    const i = setInterval(loadThread, THREAD_POLL_MS);
    return () => clearInterval(i);
  }, [loadThread, selected?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [selected?.messages?.length]);

  const filtered = convos.filter(c => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      guestLabel(c).toLowerCase().includes(q) ||
      (c.last_message || '').toLowerCase().includes(q) ||
      (c.guest_phone || '').toLowerCase().includes(q)
    );
  });

  const isPaused = selected?.ai_paused_until && new Date(selected.ai_paused_until) > new Date();

  async function handleSend() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await gbApi.sendReply(selected.id, reply.trim());
      setReply('');
      await loadThread();
    } catch (e: any) { alert(e.message); }
    setSending(false);
  }

  async function handleTakeover() {
    if (!selected) return;
    try {
      await gbApi.takeoverConversation(selected.id);
      await loadThread();
    } catch (e: any) { alert(e.message); }
  }

  async function handleResume() {
    if (!selected) return;
    try {
      await gbApi.resumeConversation(selected.id);
      await loadThread();
    } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex flex-1 min-h-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 flex flex-col">
        <div className="p-3 border-b border-slate-100 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>
          <div className="flex gap-1">
            {['all', 'whatsapp', 'instagram', 'messenger', 'email'].map(ch => (
              <button key={ch} onClick={() => setChannelFilter(ch)}
                className={clsx('px-2 py-1 rounded-md text-xs font-medium transition-colors',
                  channelFilter === ch ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
                {ch === 'all' ? 'All' : channelBadge(ch)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No conversations</p>
          )}
          {filtered.map(c => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={clsx('w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors',
                selected?.id === c.id && 'bg-brand-50')}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-800 truncate">{guestLabel(c)}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {channelBadge(c.channel)}
                  </span>
                  {c.updated_at && <span className="text-[10px] text-slate-400">{timeAgo(c.updated_at)}</span>}
                </div>
              </div>
              <p className="text-xs text-slate-500 truncate">{c.last_message || 'No messages'}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare size={40} className="mb-3 text-slate-300" />
            <p className="text-sm">Select a conversation</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div>
                <p className="text-sm font-semibold text-slate-800">{guestLabel(selected)}</p>
                <p className="text-xs text-slate-400">{selected.guest_phone ? displayPhone(selected.guest_phone) : selected.channel}</p>
              </div>
              <div className="flex items-center gap-2">
                {isPaused ? (
                  <button onClick={handleResume}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                    <PlayCircle size={14} /> Resume AI
                  </button>
                ) : (
                  <button onClick={handleTakeover}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">
                    <PauseCircle size={14} /> Take Over
                  </button>
                )}
              </div>
            </div>

            {isPaused && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-center gap-1.5">
                <UserCheck size={13} /> AI paused — you're handling this conversation manually
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {(selected.messages ?? []).map((msg, i) => {
                const isUser = msg.role === 'user';
                const isStaff = msg.role === 'staff';
                return (
                  <div key={i} className={clsx('flex gap-2', isUser ? 'justify-start' : 'justify-end')}>
                    {isUser && (
                      <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <User size={14} className="text-slate-500" />
                      </div>
                    )}
                    <div className={clsx('max-w-[70%] rounded-2xl px-4 py-2.5',
                      isUser ? 'bg-slate-100 text-slate-800'
                        : isStaff ? 'bg-green-100 text-green-900'
                        : 'bg-brand-500 text-white')}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={clsx('text-[10px] mt-1', isUser ? 'text-slate-400' : isStaff ? 'text-green-600' : 'text-brand-200')}>
                        {isStaff && <><UserCheck size={10} className="inline mr-1" />Staff &middot; </>}
                        {!isUser && !isStaff && <><Bot size={10} className="inline mr-1" />AI &middot; </>}
                        {msg.ts ? formatTime(msg.ts) : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-200 px-4 py-3 flex items-center gap-2">
              <input value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Type a reply..."
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
              <button onClick={handleSend} disabled={sending || !reply.trim()}
                className="p-2.5 rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors">
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
