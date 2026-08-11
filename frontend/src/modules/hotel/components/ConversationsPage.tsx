import { useState, useEffect } from 'react';
import { Mail, RefreshCw, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { Spinner } from '../ui';
import type { EmailConversation, EmailMessage } from '../types';

export function ConversationsPage() {
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [selected, setSelected] = useState<EmailConversation | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getEmailConversations();
      setConversations(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function selectConv(conv: EmailConversation) {
    setSelected(conv);
    setMsgLoading(true);
    try {
      const msgs = await api.getEmailMessages(conv.id);
      setMessages(msgs);
    } catch { setMessages([]); }
    finally { setMsgLoading(false); }
  }

  function displayAddress(conv: EmailConversation) {
    const raw = conv.channel_user_id.replace(/^email:/, '');
    return conv.from_name ? `${conv.from_name} <${raw}>` : raw;
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="h-full flex gap-4 min-h-0">
      {/* Conversation list */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Email Inbox</h2>
            <p className="text-xs text-slate-400">{conversations.length} thread{conversations.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <p className="p-4 text-xs text-red-500">{error}</p>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-slate-400 py-12">
            <Mail size={28} className="text-slate-300" />
            <p className="text-xs">No email threads yet</p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {conversations.map(conv => (
              <li key={conv.id}>
                <button
                  onClick={() => selectConv(conv)}
                  className={clsx(
                    'w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors',
                    selected?.id === conv.id && 'bg-brand-50 border-r-2 border-brand-500'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {displayAddress(conv)}
                    </span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(conv.updated_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{conv.subject ?? '(no subject)'}</p>
                  {conv.last_body && (
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">{conv.last_body}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
            <ChevronRight size={24} className="text-slate-300" />
            <p className="text-sm">Select a thread</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800 truncate">{selected.subject ?? '(no subject)'}</h3>
              <p className="text-xs text-slate-400 truncate">{displayAddress(selected)}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {msgLoading ? (
                <Spinner />
              ) : messages.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No messages found</p>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={clsx(
                      'rounded-xl p-4 text-sm max-w-[85%]',
                      msg.direction === 'inbound'
                        ? 'bg-slate-100 text-slate-800 self-start'
                        : 'bg-brand-500 text-white self-end ml-auto'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded',
                        msg.direction === 'inbound' ? 'bg-slate-200 text-slate-600' : 'bg-brand-600 text-white'
                      )}>
                        {msg.direction === 'inbound' ? 'Guest' : 'AI'}
                      </span>
                      <span className={clsx('text-[10px]', msg.direction === 'inbound' ? 'text-slate-400' : 'text-brand-200')}>
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.body_text}</p>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
