/**
 * Chat companion — FR-09 / FR-10 / FR-11.
 *
 * A warm, conversational companion ("Aria") that can chat about memories,
 * offer encouragement, and quietly observe patterns. The history is loaded
 * once, then each message appends the reply.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { message, showToast } = useToast();
  const threadEnd = useRef(null);

  useEffect(() => {
    api
      .getChatHistory()
      .then((res) => setMessages(res.messages || []))
      .catch((err) => showToast(err.message))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setMessages((m) => [...m, { messageid: `tmp-${Date.now()}`, role: 'user', messagetext: text }]);
    setDraft('');
    setBusy(true);
    try {
      const res = await api.sendChatMessage(text);
      setMessages((m) => [
        ...m,
        { messageid: `ai-${Date.now()}`, role: 'assistant', messagetext: res.reply },
      ]);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Opening your conversation…" />;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <header className="stage-header">
        <h1>Your companion, Aria</h1>
        <p>Happy to chat, listen, or help you think something through.</p>
      </header>

      <div className="chat-shell">
        <div className="chat-thread" role="log" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && (
            <div className="empty-state">
              <h3>Say hello</h3>
              <p>Aria is here whenever you would like a friendly word.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.messageid} className={`chat-row ${m.role === 'user' ? 'is-user' : 'is-ai'}`}>
              <div className="chat-bubble">
                <div className="chat-sender">{m.role === 'user' ? 'You' : 'Aria'}</div>
                {m.messagetext}
              </div>
            </div>
          ))}
          <div ref={threadEnd} />
        </div>

        <form className="chat-input-row" onSubmit={send}>
          <div className="chat-input-field">
            <label htmlFor="chat-input">Write a message to Aria</label>
            <textarea
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your message…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            {busy ? 'Sending…' : (
              <>
                <Icon name="send" size={20} />
                Send
              </>
            )}
          </button>
        </form>
      </div>
      </div>
    </>
  );
}
