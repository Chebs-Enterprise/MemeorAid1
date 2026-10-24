/**
 * Chat companion — FR-09 / FR-10 / FR-11.
 *
 * A warm, conversational companion ("Aria") that knows the user: it
 * remembers what they have told it, reaches back to older memories when
 * they are mentioned, and answers with their own details rather than
 * generic advice.
 *
 * The reply is streamed (Server-Sent Events) so it appears word by word
 * instead of after a long pause — important for an older user, who should
 * never be left staring at a spinner. Under each reply the app shows
 * *why* it was personal: the memories and facts Aria drew on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';
import { useVoiceInput } from '../lib/voice.js';

/** How long to wait after the last spoken word before sending, in ms. */
const VOICE_AUTO_SEND_DELAY = 1800;

function truncate(text, max = 70) {
  const value = (text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

/** The little "because you mentioned…" hints under Aria's reply. */
function ContextChips({ meta }) {
  if (!meta) return null;
  const facts = meta.facts || [];
  const memories = meta.memories || [];
  if (!facts.length && !memories.length) return null;

  return (
    <div className="chat-context">
      <span className="chat-context-label">
        <Icon name="brain" size={16} />
        From what you've told me
      </span>
      <div className="chat-chips">
        {facts.map((fact) => (
          <span className="chat-chip is-fact" key={`fact-${fact.factid}`}>
            {truncate(fact.facttext, 60)}
          </span>
        ))}
        {memories.map((memory) => (
          <span className="chat-chip is-memory" key={`mem-${memory.memoryid}`}>
            {truncate(memory.content, 70)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Three dots while Aria is thinking / writing. */
function TypingIndicator() {
  return (
    <div className="chat-row is-ai">
      <div className="chat-bubble">
        <div className="chat-sender">Aria</div>
        <span className="chat-typing" aria-label="Aria is writing">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}

/**
 * The "shall I keep this?" card Aria shows when something the user said looks
 * worth remembering. Nothing is written until they choose — the buttons call
 * the backend, and the card only reports a save the server actually confirmed.
 */
function MemorySaveCard({ memory, saved, busy, onConfirm, onDecline }) {
  if (saved) {
    return (
      <div className="chat-memory-card is-saved">
        <span className="chat-memory-card-head">
          <Icon name="check" size={18} />
          Saved to your memories
        </span>
        <p className="chat-memory-card-body">{saved.content}</p>
        {saved.category && <span className="chat-chip is-memory">{saved.category}</span>}
      </div>
    );
  }

  if (!memory) return null;

  return (
    <div className="chat-memory-card">
      <span className="chat-memory-card-head">
        <Icon name="brain" size={18} />
        Would you like me to remember this?
      </span>
      <p className="chat-memory-card-body">{memory.content}</p>
      <div className="chat-memory-card-actions">
        {memory.category && <span className="chat-chip is-memory">{memory.category}</span>}
        <button type="button" className="btn btn-primary chat-memory-save" onClick={onConfirm} disabled={busy}>
          <Icon name="check" size={18} />
          Yes, save it
        </button>
        <button type="button" className="btn btn-secondary chat-memory-skip" onClick={onDecline} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const [voiceHint, setVoiceHint] = useState('');
  const [memoryBusy, setMemoryBusy] = useState(null);
  const { message, showToast } = useToast();
  const threadEnd = useRef(null);
  const abortRef = useRef(null);
  const voiceBaseRef = useRef('');
  const voiceTimerRef = useRef(null);
  const draftRef = useRef('');
  const busyRef = useRef(false);
  // Filled in by the voice hook below; lets `send` stop dictation without
  // creating a circular dependency between the two.
  const stopVoiceRef = useRef(() => {});

  // Keep the draft ref current so the voice callbacks below never capture
  // stale state (the recognition instance outlives a single render).
  useEffect(() => {
    draftRef.current = draft;
  });

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

  // Abort an in-flight stream if the page is left.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Dictation sits directly in the message box: as the user speaks, the words
  // appear in the textarea. When they stop talking, the message is sent on its
  // own — typing is never required.
  const clearVoiceTimer = useCallback(() => {
    if (voiceTimerRef.current) {
      clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }, []);

  // Accepts either a form submit event (Send button / Enter) or a plain
  // string from the voice auto-send timer. Defined with useCallback so the
  // voice hook below can hold a stable reference to the latest `send`.
  const send = useCallback(
    async (eventOrText) => {
      if (eventOrText && typeof eventOrText.preventDefault === 'function') {
        eventOrText.preventDefault();
      }
      const text = (typeof eventOrText === 'string' ? eventOrText : draftRef.current).trim();

      // Sending ends the dictation: whatever was spoken has been handed over,
      // so the microphone stops rather than keep listening in the background.
      clearVoiceTimer();
      stopVoiceRef.current?.();

      if (!text || busyRef.current) return;

      voiceBaseRef.current = '';
      setVoiceHint('');

      const aiId = `ai-${Date.now()}`;
      setMessages((m) => [
        ...m,
        { messageid: `user-${Date.now()}`, role: 'user', messagetext: text },
        { messageid: aiId, role: 'assistant', messagetext: '' },
      ]);
      setDraft('');
      setBusy(true);
      busyRef.current = true;

      let reply = '';
      let meta = null;
      let failure = null;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await api.streamChatMessage(text, {
          mode: deepMode ? 'deep' : 'standard',
          signal: controller.signal,
          onEvent: ({ event, data }) => {
            if (event === 'meta') {
              meta = data;
            } else if (event === 'token') {
              reply += data.text || '';
              const chunk = reply;
              setMessages((m) =>
                m.map((msg) => (msg.messageid === aiId ? { ...msg, messagetext: chunk } : msg)),
              );
            } else if (event === 'done') {
              reply = data.reply || reply;
              const finalMeta = data.meta || meta;
              setMessages((m) =>
                m.map((msg) =>
                  msg.messageid === aiId ? { ...msg, messagetext: reply, meta: finalMeta } : msg,
                ),
              );
            } else if (event === 'error') {
              failure = data.message || 'Something went wrong.';
            }
          },
        });
      } catch (err) {
        failure = err.message;
      } finally {
        abortRef.current = null;
        setBusy(false);
        busyRef.current = false;
      }

      if (failure) {
        showToast(failure);
        setMessages((m) => m.filter((msg) => msg.messageid !== aiId));
      }
    },
    [clearVoiceTimer, deepMode, showToast],
  );

  // Confirming or declining the memory Aria offered on a turn. The card only
  // shows "Saved" once the backend has replied that the row really exists.
  const confirmMemory = useCallback(
    async (messageid) => {
      if (memoryBusy) return;
      setMemoryBusy(messageid);
      try {
        const res = await api.confirmChatMemory();
        setMessages((m) =>
          m.map((msg) =>
            msg.messageid === messageid
              ? { ...msg, pending_memory: null, saved_memory: res.memory }
              : msg,
          ),
        );
        showToast(res.message || 'Saved to your memories.');
      } catch (err) {
        showToast(err.message);
      } finally {
        setMemoryBusy(null);
      }
    },
    [memoryBusy, showToast],
  );

  const declineMemory = useCallback(
    async (messageid) => {
      if (memoryBusy) return;
      setMemoryBusy(messageid);
      try {
        await api.declineChatMemory();
        setMessages((m) =>
          m.map((msg) =>
            msg.messageid === messageid ? { ...msg, pending_memory: null } : msg,
          ),
        );
      } catch (err) {
        showToast(err.message);
      } finally {
        setMemoryBusy(null);
      }
    },
    [memoryBusy, showToast],
  );

  const voice = useVoiceInput({
    onTranscript: (spoken, isFinal) => {      const base = voiceBaseRef.current;
      const joined = base && spoken ? `${base} ${spoken}` : base || spoken;
      setDraft(joined);
      setVoiceHint(isFinal ? '' : 'Listening…');
      if (!isFinal) return;

      voiceBaseRef.current = joined;
      clearVoiceTimer();
      voiceTimerRef.current = setTimeout(() => {
        const text = (voiceBaseRef.current || draftRef.current).trim();
        if (text) send(text);
      }, VOICE_AUTO_SEND_DELAY);
    },
    onError: (message) => {
      setVoiceHint('');
      showToast(message);
    },
  });

  useEffect(() => {
    stopVoiceRef.current = voice.stop;
  }, [voice.stop]);

  const voiceIdleHint = voice.supported
    ? 'Prefer not to type? Tap “Speak”, say your message, and press “Stop”.'
    : '';

  useEffect(() => () => clearVoiceTimer(), [clearVoiceTimer]);

  const toggleVoice = () => {
    if (voice.listening) {
      clearVoiceTimer();
      voice.stop();
      setVoiceHint('');
    } else {
      clearVoiceTimer();
      voiceBaseRef.current = draft.trim();
      setVoiceHint('Listening…');
      voice.start();
    }
  };

  if (loading) return <Loading label="Opening your conversation…" />;

  const last = messages[messages.length - 1];
  const awaitingText = busy && last && last.role === 'assistant' && !last.messagetext;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <header className="stage-header chat-header">
        <div>
          <h1>Your companion, Aria</h1>
          <p>Here to remember the people and moments that matter to you.</p>
        </div>
        <button
          type="button"
          className={`chat-mode-toggle ${deepMode ? 'is-on' : ''}`}
          aria-pressed={deepMode}
          onClick={() => setDeepMode((value) => !value)}
        >
          <Icon name="sparkles" size={18} />
          <span className="chat-mode-label">
            Deep reflection
            <small>{deepMode ? 'On — Aria thinks longer' : 'Off'}</small>
          </span>
        </button>
      </header>

      <div className="chat-shell">
        <div className="chat-thread" role="log" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && (
            <div className="empty-state">
              <h3>Say hello</h3>
              <p>
                Tell Aria about your day, someone you love, or something you want
                to remember. If it is worth keeping, she can save it for you and
                bring it back later.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.messageid} className={`chat-row ${m.role === 'user' ? 'is-user' : 'is-ai'}`}>
              <div className="chat-bubble-wrap">
                <div className="chat-bubble">
                  <div className="chat-sender">{m.role === 'user' ? 'You' : 'Aria'}</div>
                  {m.messagetext}
                </div>
                {m.role === 'assistant' && (
                  <MemorySaveCard
                    memory={m.pending_memory || m.meta?.pending_memory}
                    saved={m.saved_memory || m.meta?.saved_memory}
                    busy={memoryBusy === m.messageid}
                    onConfirm={() => confirmMemory(m.messageid)}
                    onDecline={() => declineMemory(m.messageid)}
                  />
                )}
                {m.role === 'assistant' && <ContextChips meta={m.meta} />}
              </div>
            </div>
          ))}
          {awaitingText && <TypingIndicator />}
          <div ref={threadEnd} />
        </div>

        <form className="chat-input-row" onSubmit={send}>
          <div className="chat-input-field">
            <label htmlFor="chat-input">{voice.supported ? 'Speak or write a message to Aria' : 'Write a message to Aria'}</label>
            <textarea
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={voice.listening ? 'Listening…' : voice.supported ? 'Tap the microphone and speak, or type…' : 'Type your message…'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
            />
            {voice.supported && (
              <p className="chat-voice-hint" aria-live="polite">
                {voice.listening
                  ? 'Listening… speak naturally, then pause.'
                  : voiceHint || voiceIdleHint}
              </p>
            )}
          </div>
          {voice.supported && (
            <button
              type="button"
              className={`btn chat-mic ${voice.listening ? 'is-listening' : 'btn-secondary'}`}
              onClick={toggleVoice}
              disabled={busy}
              aria-pressed={voice.listening}
            >
              <Icon name={voice.listening ? 'mic-off' : 'mic'} size={20} />
              {voice.listening ? 'Stop' : 'Speak'}
            </button>
          )}
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
