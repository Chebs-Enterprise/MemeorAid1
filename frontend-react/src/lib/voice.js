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
 * @param {{ onTranscript?: (text: string, isFinal: boolean, all: string) => void,
 *           onError?: (message: string) => void }} options
 *   `onTranscript` receives the cumulative transcript so the caller can put it
 *   straight into a textarea. `isFinal` is false for interim guesses.
 */
export function useVoiceInput({ onTranscript, onError } = {}) {
  const supported = Boolean(SpeechRecognition);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  const recognitionRef = useRef(null);
  // Keep the latest callbacks without re-creating the recognition instance.
  const handlers = useRef({ onTranscript, onError });

  useEffect(() => {
    handlers.current = { onTranscript, onError };
  }, [onTranscript, onError]);

  useEffect(() => {
    if (!supported) return undefined;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-GB';

    recognition.onstart = () => {
      setError('');
      setListening(true);
    };

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      handlers.current.onTranscript?.(interimText, false, finalText);
      if (finalText) handlers.current.onTranscript?.(finalText, true, finalText);
    };

    recognition.onerror = (event) => {
      const message = friendlyError(event.error);
      if (message) {
        setError(message);
        handlers.current.onError?.(message);
      }
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => {
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
    try {
      recognitionRef.current.start();
    } catch {
      // start() throws if it is already running; ignore that.
    }
  }, [supported]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
