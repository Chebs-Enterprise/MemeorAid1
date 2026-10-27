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
import { mergeTranscript, useVoiceInput } from '../lib/voice.js';

function truncate(text, max = 70) {
  const value = (text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

/** Copy text, falling back to the old selection-based method where needed. */
async function copyMessageText(text) {
  const value = (text || '').trim();
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or an insecure context — try the legacy path below.
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Share one message through the device sheet, or copy it when the browser has
 * no share support. Returns what actually happened so the caller can be honest
 * with the user instead of claiming a share that never took place.
 */
async function shareMessageText(text) {
  const value = (text || '').trim();
  if (!value) return 'empty';

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'A message from my MemorAid companion',
        text: value,
      });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Some browsers expose share but refuse it (permissions, desktop);
      // copying is the useful fallback.
    }
  }

  return (await copyMessageText(value)) ? 'copied' : 'failed';
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
  const [memoryBusy, setMemoryBusy] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sendingIds, setSendingIds] = useState(null);
  const { message, showToast } = useToast();
  const threadEnd = useRef(null);
  const abortRef = useRef(null);
  const skipScrollRef = useRef(false);
  const voiceBaseRef = useRef('');
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
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Abort an in-flight stream if the page is left.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Dictation sits directly in the message box: as the user speaks, the words
  // appear in the textarea. Recording continues until the user presses Stop or
  // sends the message explicitly, so a pause in speech-service results can
  // never end the recording on its own.

  // Accepts either a form submit event (Send button / Enter) or a plain
  // string. Defined with useCallback so the voice hook below can hold a stable
  // reference to the latest `send`.
  const send = useCallback(
    async (eventOrText) => {
      if (eventOrText && typeof eventOrText.preventDefault === 'function') {
        eventOrText.preventDefault();
      }
      const text = (typeof eventOrText === 'string' ? eventOrText : draftRef.current).trim();

      // Sending ends the dictation: whatever was spoken has been handed over,
      // so the microphone stops rather than keep listening in the background.
      stopVoiceRef.current?.();

      if (!text || busyRef.current) return;

      voiceBaseRef.current = '';

      const userId = `user-${Date.now()}`;
      const aiId = `ai-${Date.now()}`;
      setSendingIds({ user: userId, assistant: aiId });
      setMessages((m) => [
        ...m,
        { messageid: userId, clientid: userId, role: 'user', messagetext: text },
        { messageid: aiId, clientid: aiId, role: 'assistant', messagetext: '' },
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
              const ids = data.messageids || {};
              // The server has now stored both turns. Adopt its ids so the
              // actions can copy/share/delete this exchange immediately,
              // without waiting for a reload.
              setMessages((m) =>
                m.map((msg) => {
                  if (msg.messageid === aiId) {
                    return {
                      ...msg,
                      messageid: ids.assistant || msg.messageid,
                      messagetext: reply,
                      meta: finalMeta,
                    };
                  }
                  if (msg.messageid === userId) {
                    return { ...msg, messageid: ids.user || msg.messageid };
                  }
                  return msg;
                }),
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
        setSendingIds(null);
        setBusy(false);
        busyRef.current = false;
      }

      if (failure) {
        showToast(failure);
        setMessages((m) => m.filter((msg) => msg.messageid !== aiId));
      }
    },
    [deepMode, showToast],
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

  const copyMessage = useCallback(
    async (msg) => {
      const copied = await copyMessageText(msg.messagetext);
      showToast(
        copied
          ? 'Message copied.'
          : "I couldn't copy that message. Please try again.",
      );
    },
    [showToast],
  );

  const shareMessage = useCallback(
    async (msg) => {
      const result = await shareMessageText(msg.messagetext);
      if (result === 'shared') showToast('Message shared.');
      else if (result === 'copied') {
        showToast('Sharing is not available here, so the message was copied instead.');
      } else if (result === 'failed') {
        showToast("I couldn't share or copy that message. Please try again.");
      }
      // 'cancelled' means the user closed the share sheet — say nothing.
    },
    [showToast],
  );

  const deleteMessage = useCallback(
    async (msg) => {
      if (deleting) return;
      const id = msg.messageid;
      const persisted = typeof id === 'number' || /^\d+$/.test(String(id));
      setDeleting(id);

      // A message the server never stored (for example an exchange whose save
      // failed) exists only in this tab, so removing it locally is already
      // permanent — there is nothing to call.
      if (!persisted) {
        skipScrollRef.current = true;
        setMessages((m) => m.filter((item) => item.messageid !== id));
        setConfirmingDelete(null);
        setDeleting(null);
        showToast('Message removed.');
        return;
      }

      try {
        await api.deleteChatMessage(id);
        skipScrollRef.current = true;
        setMessages((m) => m.filter((item) => item.messageid !== id));
        setConfirmingDelete(null);
        showToast('Message deleted.');
      } catch (err) {
        if (err.status === 404) {
          // The server no longer has it, so leaving it on screen would be a
          // false claim that it survived. Removing it matches the truth.
          skipScrollRef.current = true;
          setMessages((m) => m.filter((item) => item.messageid !== id));
          setConfirmingDelete(null);
          showToast('That message had already been deleted.');
        } else {
          // Keep the message visible: the delete did not happen, and the UI
          // must not suggest otherwise.
          showToast(err.message || "I couldn't delete that message. Please try again.");
        }
      } finally {
        setDeleting(null);
      }
    },
    [deleting, showToast],
  );

  const voice = useVoiceInput({
    onTranscript: (spoken, isFinal, live) => {
      const base = voiceBaseRef.current;
      const joined = mergeTranscript(base, spoken);

      if (!isFinal) {
        // Provisional words from a session that has already been stopped must
        // not repaint the box or look like a new recording session.
        if (!live) return;
        setDraft(joined);
        return;
      }

      // Final words are real speech and are always kept, even when they arrive
      // after Stop (the browser finalises the last words asynchronously).
      // Recording only ends when the user presses Stop or sends the message.
      voiceBaseRef.current = joined;
      setDraft(joined);
    },
    onError: (message) => {
      showToast(message);
    },
  });

  useEffect(() => {
    stopVoiceRef.current = voice.stop;
  }, [voice.stop]);

  const voiceIdleHint = voice.supported
    ? 'Prefer not to type? Tap “Speak”, say your message, and press “Stop”.'
    : '';

  const toggleVoice = () => {
    if (voice.listening) {
      voice.stop();
    } else {
      voiceBaseRef.current = draft.trim();
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
          {messages.map((m) => {
            const isSending =
              Boolean(sendingIds) &&
              (m.messageid === sendingIds.user || m.messageid === sendingIds.assistant);
            const canAct = Boolean((m.messagetext || '').trim()) && !isSending;
            return (
              <div key={m.clientid || m.messageid} className={`chat-row ${m.role === 'user' ? 'is-user' : 'is-ai'}`}>
                <div className="chat-bubble-wrap">
                  <div className="chat-bubble">
                    <div className="chat-sender">{m.role === 'user' ? 'You' : 'Aria'}</div>
                    {m.messagetext}
                  </div>
                  {canAct && (
                    <div
                      className="chat-message-actions"
                      role="group"
                      aria-label={m.role === 'user' ? 'Actions for your message' : 'Actions for this reply'}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setConfirmingDelete(null);
                      }}
                    >
                      {confirmingDelete === m.messageid ? (
                        <div className="chat-delete-confirm" role="group" aria-label="Delete this message?">
                          <button
                            type="button"
                            className="chat-action is-danger"
                            onClick={() => deleteMessage(m)}
                            disabled={deleting === m.messageid}
                            aria-label="Delete this message"
                          >
                            {deleting === m.messageid ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            className="chat-action is-icon"
                            onClick={() => setConfirmingDelete(null)}
                            disabled={deleting === m.messageid}
                            title="Keep message"
                            aria-label="Keep this message"
                            autoFocus
                          >
                            <Icon name="close" size={15} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="chat-action"
                            onClick={() => copyMessage(m)}
                            title="Copy message"
                            aria-label="Copy message"
                          >
                            <Icon name="copy" size={16} />
                          </button>
                          <button
                            type="button"
                            className="chat-action"
                            onClick={() => shareMessage(m)}
                            title="Share message"
                            aria-label="Share message"
                          >
                            <Icon name="share" size={16} />
                          </button>
                          <button
                            type="button"
                            className="chat-action is-danger"
                            onClick={() => setConfirmingDelete(m.messageid)}
                            title="Delete message"
                            aria-label="Delete message"
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
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
            );
          })}
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
                  ? 'Listening… keep speaking, then press Stop.'
                  : voiceIdleHint}
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
