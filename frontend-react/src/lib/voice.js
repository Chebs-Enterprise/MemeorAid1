/**
 * Voice input (speech-to-text) for older users who cannot type.
 *
 * Wraps the browser's Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`) in one small hook so any page can offer a
 * microphone button instead of re-implementing the same event wiring — the
 * vanilla build did exactly that, twice, slightly differently each time.
 *
 * The hook reports everything the UI needs: whether dictation is available
 * at all, whether it is currently listening, the live transcript and a
 * friendly error message. Dictation stays in the browser: no audio leaves the
 * device and the text is inserted into the field the user was already using,
 * so the existing form and API are untouched.
 *
 * Note: in most browsers this works in Chrome and Edge. Safari and Firefox do
 * not expose it, so `supported` is false there and the caller hides the
 * button rather than showing something that would fail.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

/** Human-readable explanation for the Web Speech API's error codes. */
function friendlyError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'MemorAid needs permission to use your microphone. Please allow it in your browser, then try again.';
    case 'no-speech':
      return 'I did not hear anything. Please tap the microphone and speak again.';
    case 'audio-capture':
      return 'No microphone was found. Please check that one is connected.';
    case 'network':
      return 'Voice could not reach the speech service. Please check your connection.';
    case 'aborted':
      return '';
    default:
      return 'Voice typing stopped unexpectedly. Please try again.';
  }
}

/**
 * Split the newly available results out of a `SpeechRecognitionEvent`.
 *
 * The Web Speech API reports `event.results` cumulatively for the whole
 * recognition session: an already-final result stays in the list and is
 * reported again on every later event. Reading the whole list each time
 * replays old sentences. `finalizedCount` records how many leading results
 * have already been handed to the caller; this function skips them, returns
 * only new final text and the current interim text, and reports the new count.
 *
 * Nothing is de-duplicated by content, so a word the user genuinely repeats is
 * a separate result and is still reported.
 *
 * @param {SpeechRecognitionResultList|Array} results
 * @param {number} finalizedCount
 * @returns {{ finalText: string, interimText: string, finalizedCount: number }}
 */
export function takeNewResults(results, finalizedCount) {
  let count = finalizedCount;
  let finalText = '';
  let interimText = '';

  // Finalized results sit at the front of the list, in order.
  while (count < results.length && results[count].isFinal) {
    finalText += results[count][0]?.transcript || '';
    count += 1;
  }
  for (let i = count; i < results.length; i += 1) {
    if (!results[i].isFinal) interimText += results[i][0]?.transcript || '';
  }

  return { finalText, interimText, finalizedCount: count };
}

/**
 * @param {{ onTranscript?: (text: string, isFinal: boolean, live: boolean) => void,
 *           onError?: (message: string) => void }} options
 *   `onTranscript` receives only the new part of the transcript (never the
 *   whole session again), so the caller can append it to the field. `isFinal`
 *   is false for interim guesses. A final result is reported exactly once.
 *   `live` is true only while the recognition session is actually listening;
 *   a late final result delivered during shutdown is still real speech, but
 *   `live` is false so the caller will not start another action from it.
 */
export function useVoiceInput({ onTranscript, onError } = {}) {
  const supported = Boolean(SpeechRecognition);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  const recognitionRef = useRef(null);
  // Keep the latest callbacks without re-creating the recognition instance.
  const handlers = useRef({ onTranscript, onError });
  // One active session at a time: 'idle' | 'starting' | 'listening' | 'stopping'.
  const statusRef = useRef('idle');
  // A start requested while the previous session is still winding down.
  const restartRef = useRef(false);
  // A stop requested between start() and the browser's 'start' event.
  const stopRequestedRef = useRef(false);
  // True from an explicit start() until an explicit stop(), unmount, or an
  // unrecoverable error: the user still wants this recording to be running.
  const intentRef = useRef(false);
  // Pending timer that re-opens the session after a clean browser-side 'end'.
  const continueTimerRef = useRef(null);
  // Rapid no-result sessions in a row, used to stop a restart loop.
  const rapidEndsRef = useRef(0);
  // When the current recognition session started (for rapid-end detection).
  const sessionStartRef = useRef(0);
  // Whether the current recognition session delivered any result.
  const sessionHadResultRef = useRef(false);
  // Whether the current recognition session reported an error.
  const sessionErroredRef = useRef(false);

  useEffect(() => {
    handlers.current = { onTranscript, onError };
  }, [onTranscript, onError]);

  useEffect(() => {
    if (!supported) return undefined;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-GB';

    // Results already handed over in the current session (see takeNewResults).
    let finalizedCount = 0;

    const clearContinueTimer = () => {
      if (continueTimerRef.current) {
        clearTimeout(continueTimerRef.current);
        continueTimerRef.current = null;
      }
    };

    const giveUp = () => {
      intentRef.current = false;
      clearContinueTimer();
      setListening(false);
      const message = 'Voice typing kept stopping. Please tap the microphone and speak again.';
      setError(message);
      handlers.current.onError?.(message);
    };

    // A browser-side 'end' during an intended recording is not the user
    // pressing Stop. Re-open the session once, from a single guarded timer, so
    // the recording continues without piling up recognition instances.
    const scheduleContinue = () => {
      if (!intentRef.current) return;
      if (continueTimerRef.current) return;
      if (statusRef.current !== 'idle') return;

      // An ending that happens immediately and produced no speech means the
      // service could not start; three of those in a row is a restart loop.
      const lasted = Date.now() - sessionStartRef.current;
      if (lasted < 1500 && !sessionHadResultRef.current) {
        rapidEndsRef.current += 1;
      } else {
        rapidEndsRef.current = 0;
      }
      if (rapidEndsRef.current >= 3) {
        giveUp();
        return;
      }

      continueTimerRef.current = setTimeout(() => {
        continueTimerRef.current = null;
        if (!intentRef.current || statusRef.current !== 'idle') return;
        statusRef.current = 'starting';
        try {
          recognition.start();
        } catch {
          statusRef.current = 'idle';
          giveUp();
        }
      }, 200);
    };

    recognition.onstart = () => {
      finalizedCount = 0;
      sessionStartRef.current = Date.now();
      sessionHadResultRef.current = false;
      sessionErroredRef.current = false;
      setError('');

      if (stopRequestedRef.current) {
        // Stop was pressed before the browser confirmed the start.
        stopRequestedRef.current = false;
        statusRef.current = 'stopping';
        try {
          recognition.stop();
        } catch {
          statusRef.current = 'idle';
        }
        return;
      }

      statusRef.current = 'listening';
      setListening(true);
    };

    recognition.onresult = (event) => {
      const update = takeNewResults(event.results, finalizedCount);
      finalizedCount = update.finalizedCount;
      sessionHadResultRef.current = true;
      rapidEndsRef.current = 0;

      // Only a session that is actually listening can start new UI activity.
      // Interim results are live guesses and are meaningless once Stop has been
      // pressed: showing them made a stopped session look as if it had started
      // listening again. Final results are always delivered because they
      // contain speech already spoken, but they carry `live` so the caller can
      // keep the words without treating them as a fresh live session.
      const live = statusRef.current === 'listening';
      if (update.interimText && live) {
        handlers.current.onTranscript?.(update.interimText, false, live);
      }
      if (update.finalText) handlers.current.onTranscript?.(update.finalText, true, live);
    };

    recognition.onerror = (event) => {
      sessionErroredRef.current = true;
      // An error means the session could not run reliably. Never continue it
      // automatically; text already delivered stays in the message box.
      intentRef.current = false;
      clearContinueTimer();

      const message = friendlyError(event.error);
      if (message) {
        setError(message);
        handlers.current.onError?.(message);
      }
    };

    recognition.onend = () => {
      statusRef.current = 'idle';
      stopRequestedRef.current = false;

      if (restartRef.current) {
        // A new session was requested while this one was stopping.
        restartRef.current = false;
        statusRef.current = 'starting';
        try {
          recognition.start();
        } catch {
          statusRef.current = 'idle';
          setListening(false);
        }
        return;
      }

      // The browser can end a continuous session on its own without an error
      // (for example its own idle timeout). If the user has not pressed Stop,
      // continue the same recording; the next session appends to the text that
      // was already captured instead of replacing it. Keep the mic showing
      // "Stop" across the short gap so the interruption is not visible.
      if (intentRef.current && !sessionErroredRef.current) {
        scheduleContinue();
        return;
      }

      setListening(false);
    };

    recognitionRef.current = recognition;
    return () => {
      intentRef.current = false;
      clearContinueTimer();
      restartRef.current = false;
      stopRequestedRef.current = false;
      statusRef.current = 'idle';
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    };
  }, [supported]);

  const start = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    // Never open a second session on top of one that is starting/listening.
    if (statusRef.current === 'starting' || statusRef.current === 'listening') return;

    // The user explicitly wants to record until they press Stop.
    intentRef.current = true;
    rapidEndsRef.current = 0;
    if (continueTimerRef.current) {
      clearTimeout(continueTimerRef.current);
      continueTimerRef.current = null;
    }
    stopRequestedRef.current = false;

    if (statusRef.current === 'stopping') {
      // The old session is still delivering final results. Queue the new one
      // so pressing "Speak" is never silently ignored.
      restartRef.current = true;
      return;
    }

    restartRef.current = false;
    setError('');
    statusRef.current = 'starting';
    try {
      recognitionRef.current.start();
    } catch {
      // start() throws if a session is somehow already active; stay recoverable.
      statusRef.current = 'idle';
    }
  }, [supported]);

  const stop = useCallback(() => {
    // The user has ended the recording: never continue it automatically.
    intentRef.current = false;
    rapidEndsRef.current = 0;
    if (continueTimerRef.current) {
      clearTimeout(continueTimerRef.current);
      continueTimerRef.current = null;
    }
    restartRef.current = false;
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (statusRef.current === 'idle') {
      // Nothing is running: stop() would throw InvalidStateError. Just make
      // sure the UI is not stuck showing "Stop".
      setListening(false);
      return;
    }
    if (statusRef.current === 'stopping') return;

    // Respond immediately. The browser still delivers any final results before
    // it fires 'end', so speech already captured is not discarded.
    setListening(false);

    if (statusRef.current === 'starting') {
      // 'start' has not fired yet, so stop() would throw. Ask onstart to stop.
      stopRequestedRef.current = true;
      return;
    }

    statusRef.current = 'stopping';
    try {
      recognition.stop();
    } catch {
      statusRef.current = 'idle';
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
