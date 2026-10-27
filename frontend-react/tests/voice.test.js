import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeTranscript, takeNewResults } from '../src/lib/voice.js';

/** A minimal stand-in for one SpeechRecognitionResult. */
function result(transcript, isFinal) {
  const item = [{ transcript }];
  item.isFinal = isFinal;
  return item;
}

/**
 * Replays a stream of SpeechRecognitionEvent results the way the browser
 * reports them: the whole session so far, every event.
 */
function replay(events) {
  let finalizedCount = 0;
  let base = '';
  let draft = '';
  const finals = [];

  for (const results of events) {
    const update = takeNewResults(results, finalizedCount);
    finalizedCount = update.finalizedCount;

    if (update.interimText) draft = base ? `${base} ${update.interimText}` : update.interimText;
    if (update.finalText) {
      finals.push(update.finalText);
      base = base ? `${base} ${update.finalText}` : update.finalText;
      draft = base;
    }
  }

  return { draft, finals, finalizedCount };
}

test('cumulative results are emitted once, not replayed on every event', () => {
  const pills = result('I took my pills', false);
  const pillsFinal = result('I took my pills', true);
  const at = result('at', false);
  const atFinal = result('at eight', true);
  const o = result('o', false);
  const clock = result("o'clock", true);
  const clockFinal = result("o'clock", true);

  const { draft, finals } = replay([
    [pills],
    [pillsFinal],
    [pillsFinal, at],
    [pillsFinal, at],
    [pillsFinal, atFinal],
    [pillsFinal, atFinal, o],
    [pillsFinal, atFinal, clock],
    [pillsFinal, atFinal, clockFinal],
    [pillsFinal, atFinal, clockFinal],
  ]);

  assert.deepEqual(finals, ['I took my pills', 'at eight', "o'clock"]);
  assert.equal(draft, "I took my pills at eight o'clock");
});

test('re-delivering the same result list emits nothing new', () => {
  const results = [result('hello', true), result('there', true)];

  const first = takeNewResults(results, 0);
  assert.equal(first.finalText, 'hellothere');
  assert.equal(first.finalizedCount, 2);

  const again = takeNewResults(results, first.finalizedCount);
  assert.equal(again.finalText, '');
  assert.equal(again.interimText, '');
  assert.equal(again.finalizedCount, 2);
});

test('legitimately repeated words are preserved', () => {
  const first = takeNewResults([result('very good', true)], 0);
  const second = takeNewResults([result('very good', true), result('very good', true)], first.finalizedCount);

  assert.equal(first.finalText, 'very good');
  assert.equal(second.finalText, 'very good');
  assert.equal(second.finalizedCount, 2);
});

test('interim text after a final result is reported as interim only', () => {
  const update = takeNewResults([result('done', true), result('next', false)], 0);

  assert.equal(update.finalText, 'done');
  assert.equal(update.interimText, 'next');
  assert.equal(update.finalizedCount, 1);
});

test('an empty session is harmless', () => {
  assert.deepEqual(takeNewResults([], 0), {
    finalText: '',
    interimText: '',
    finalizedCount: 0,
  });
});

test('an overlapping finalized phrase is not repeated in the chat draft', () => {
  const first = mergeTranscript('', "I'm going to school");
  const repeatedByRecognizer = mergeTranscript(first, "I'm going to school");

  assert.equal(repeatedByRecognizer, "I'm going to school");
});

test('a replayed single word is kept once', () => {
  assert.equal(mergeTranscript('school', 'school'), 'school');
});

test('a partially overlapping speech chunk appends only its new words', () => {
  const first = mergeTranscript('', 'I am going to school');
  const continued = mergeTranscript(first, 'going to school today');

  assert.equal(continued, 'I am going to school today');
});

test('overlap matching ignores capitalization and trailing punctuation', () => {
  const continued = mergeTranscript('I am going to school.', 'School tomorrow');

  assert.equal(continued, 'I am going to school. tomorrow');
});

test('intentional repetition within one speech chunk is preserved', () => {
  assert.equal(mergeTranscript('', 'very very good'), 'very very good');
});
