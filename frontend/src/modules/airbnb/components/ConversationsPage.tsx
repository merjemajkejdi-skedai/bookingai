import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, RefreshCw, Send, User, Bot, UserCheck, PauseCircle, PlayCircle, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { airbnbApi } from '../api';
import type { AirbnbConversation } from '../types';

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

function displayUserId(id: string) {
  return id.replace('whatsapp:', '');
}

function channelBadge(ch: string) {
  if (ch === 'instagram') return 'IG';
  if (ch === 'messenger') return 'FB';
  return 'WA';
}

export function AirbnbConversationsPage() {
  const [convos, setConvos] = useState<AirbnbConversation[]>([]);
  const [selected, setSelected] = useState<AirbnbConversation | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    try { setConvos(await airbnbApi.getConversations()); } catch { /* silent */ }
  }, []);

  const loadThread = useCallback(async () => {
    if (!selected) return;
    try { setSelected(await airbnbApi.getConversation(selected.id)); } catch { /* silent */ }
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

  const isPaused = (c: AirbnbConversation) => !!c.ai_paused_until && new Date(c.ai_paused_until) > new Date();

  async function handleSend() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await airbnbApi.sendReply(selected.id, reply.trim());
      setReply('');
      await loadThread();
      await loadInbox();
    } catch (e: any) { alert(e.message); }
    finally { setSending(false); }
  }

  async function handleTakeover() {
    if (!selected) return;
    try { await airbnbApi.takeoverConversation(selected.id, 60); await loadThread(); await loadInbox(); }
    catch (e: any) { alert(e.message); }
  }

  async function handleResume() {
    if (!selected) return;
    try { await airbnbApi.resumeConversation(selected.id); await loadThread(); await loadInbox(); }
    catch (e: any) { alert(e.message); }
  }

  async function handleCheckout() {
    if (!selected) return;
    if (!confirm('Mark this guest as checked out? If they messaged within the last 24 hours, a satisfaction survey will be sent immediately.')) return;
    try {
      const result = await airbnbApi.checkoutConversation(selected.id);
      await loadThread();
      await loadInbox();
      if (!result.survey_sent) {
        const reasons: Record<string, string> = {
          already_sent: 'A survey was already sent for this conversation.',
          no_guest_messages: 'No guest messages found — nothing to survey.',
          outside_24h_window: "The guest's last message was more than 24 hours ago, so no survey was sent.",
          send_failed: 'Marked checked out, but the survey failed to send.',
        };
        alert(reasons[result.reason || ''] || 'Marked checked out.');
      }
    } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex min-h-0 gap-4">
      {/* Inbox list */}
      <div className={clsx('flex-shrink-0 w-full sm:w-72 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col', selected && 'hidden sm:flex')}>
        <div className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
          <MessageSquare size={14} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Conversations</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convos.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No conversations yet</p>}
          {convos.map(c => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={clsx('w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors',
                selected?.id === c.id && 'bg-brand-50')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">{displayUserId(c.channel_user_id)}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{channelBadge(c.channel)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-500 truncate">{c.listing_name || 'Not identified yet'}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(c.updated_at)}</span>
              </div>
              {isPaused(c) && <span className="inline-block mt-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">AI paused</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      {selected ? (
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{displayUserId(selected.channel_user_id)}</p>
              <p className="text-xs text-slate-400 truncate">{selected.listing_name || 'Listing not identified yet'}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setSelected(null)} className="sm:hidden text-xs text-slate-400 px-2">Back</button>
              {isPaused(selected) ? (
                <button onClick={handleResume} className="flex items-center gap-1 text-xs text-brand-600 px-2 py-1 rounded-lg hover:bg-brand-50">
                  <PlayCircle size={14} /> Resume AI
                </button>
              ) : (
                <button onClick={handleTakeover} className="flex items-center gap-1 text-xs text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-50">
                  <PauseCircle size={14} /> Take over
                </button>
              )}
              {selected.checked_out_at ? (
                <span className="text-xs text-slate-400 px-2 py-1">Checked out</span>
              ) : (
                <button onClick={handleCheckout} className="flex items-center gap-1 text-xs text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-50">
                  <LogOut size={14} /> Mark checked out
                </button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {(selected.messages || []).map((m, i) => (
              <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-start' : 'justify-end')}>
                <div className={clsx('max-w-[75%] rounded-xl px-3 py-2 text-sm',
                  m.role === 'user' ? 'bg-slate-100 text-slate-800' :
                  m.role === 'staff' ? 'bg-violet-100 text-violet-800' : 'bg-brand-500 text-white')}>
                  <div className="flex items-center gap-1 mb-0.5 opacity-70 text-[10px]">
                    {m.role === 'user' ? <User size={10} /> : m.role === 'staff' ? <UserCheck size={10} /> : <Bot size={10} />}
                    {formatTime(m.ts)}
                  </div>
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-slate-100 flex items-center gap-2">
            <input value={reply} onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type a reply..."
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            <button onClick={handleSend} disabled={sending || !reply.trim()}
              className="p-2 rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors">
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden sm:flex flex-1 items-center justify-center text-sm text-slate-400">
          Select a conversation to view the thread
        </div>
      )}
    </div>
  );
}
