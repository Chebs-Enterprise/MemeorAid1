/**
 * Interactive tutor scripts for the six exercise techniques (FR-08).
 *
 * The backend still chooses the technique and writes the short "how it works"
 * guidance; this module turns that choice into a guided, one-step-at-a-time
 * conversation. Each technique has its own script because the six methods ask
 * for genuinely different answers:
 *
 *   loci                 choose places -> place items -> walk the route
 *   elaborative          connect a memory to something personal, then repeat
 *   spaced_retrieval     recall the same fact three times with pauses
 *   face_name            name <-> feature, with a mental picture in between
 *   chunking             group six items, then recall the groups
 *   active_observation   study a scene, recall, review, recall again
 *
 * A step is either `read` (an instruction with a Continue button) or `ask`
 * (a question that waits for an answer). `counted` steps contribute to the
 * summary score; open questions still count as completed steps.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it',
  'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'she', 'him', 'his', 'her', 'they', 'them', 'their', 'as',
  'by', 'about', 'into', 'over', 'after', 'before', 'then', 'so', 'if', 'not',
  'no', 'yes', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'just', 'very', 'really', 'like', 'what', 'which',
  'when', 'where', 'who', 'how', 'there', 'here', 'some', 'any', 'all', 'also',
  'again', 'more', 'most', 'than', 'too', 'up', 'down', 'out', 'off', 'one',
  'two', 'three', 'each', 'every', 'once', 'still', 'keep', 'want',
]);

const DEFAULT_PLACES = ['front door', 'kitchen', 'bedroom'];
const CHUNK_ITEMS = ['milk', 'bread', 'apples', 'stamps', 'soap', 'tea'];
const DEFAULT_SCENE = [
  'blue front door',
  'red bicycle',
  'brown dog',
  'yellow flowers',
  'green gate',
  'black cat',
];

const text = (value) => String(value ?? '').trim();

export function normalise(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return normalise(value)
    .split(' ')
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function unique(values) {
  return [...new Set(values)];
}

function sameWord(a, b) {
  return a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
}

/** True when at least half of the target's meaningful words appear. */
function overlaps(answer, target) {
  const targetWords = unique(words(target));
  if (targetWords.length === 0) return normalise(answer).length > 0;
  const answerWords = words(answer);
  const hits = targetWords.filter((word) => answerWords.some((given) => sameWord(given, word)));
  return hits.length / targetWords.length >= 0.5;
}

/** How many of the supplied items the answer mentions. */
function countItems(answer, items) {
  const answerWords = words(answer);
  const answerText = normalise(answer);
  return items.filter((item) => {
    const itemWords = unique(words(item));
    if (itemWords.length === 0) return answerText.includes(normalise(item));
    return itemWords.some((word) => answerWords.some((given) => sameWord(given, word)));
  }).length;
}

function splitList(value) {
  return text(value)
    .split(/[,;/\n]|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean);
}

function targetLabel(target) {
  const value = text(target);
  if (!value) return 'this memory';
  return value.length > 74 ? `“${value.slice(0, 71)}…”` : `“${value}”`;
}

/** A forgiving pass mark: half the details, but always possible to reach. */
function passMark(total) {
  if (total <= 2) return Math.max(1, total);
  return Math.max(2, Math.ceil(total / 2));
}

function read(id, prompt, extra = {}) {
  return { id, kind: 'read', prompt, ...extra };
}

function ask(id, prompt, evaluate, extra = {}) {
  return { id, kind: 'ask', prompt, evaluate, counted: false, ...extra };
}

function thanks(message) {
  return () => ({ tone: 'success', feedback: message });
}

function retrievalFeedback(answer, target, attempt) {
  if (overlaps(answer, target)) {
    return {
      correct: true,
      tone: 'success',
      feedback:
        attempt === 1
          ? 'Yes, that is right.'
          : 'Yes, well done. Keep going.',
    };
  }
  return {
    correct: false,
    tone: 'info',
    feedback: `Not quite. It was ${targetLabel(target)}. That is okay — try again.`,
  };
}

/* ------------------------------------------------------------------ scripts */

function methodOfLoci() {
  const ctx = { places: [], items: [] };

  const itemStep = (index) =>
    ask(
      `loci-item-${index + 1}`,
      () => `What will you put at the ${ctx.places[index]}?`,
      (answer) => {
        ctx.items[index] = text(answer);
        return {
          tone: 'success',
          feedback: `Good. Picture it at the ${ctx.places[index]}.`,
        };
      },
      {
        placeholder: 'A big teacup',
      },
    );

  const recallStep = (index) =>
    ask(
      `loci-recall-${index + 1}`,
      () => `At the ${ctx.places[index]}, what did you put there?`,
      (answer) => {
        const expected = ctx.items[index] || 'something';
        if (overlaps(answer, expected)) {
          return {
            correct: true,
            tone: 'success',
            feedback: `Yes — ${expected} at the ${ctx.places[index]}.`,
          };
        }
        return {
          correct: false,
          tone: 'info',
          feedback: `Not quite. You put ${expected} at the ${ctx.places[index]}. Picture it there again.`,
        };
      },
      {
        counted: true,
        placeholder: 'I put…',
      },
    );

  return {
    steps: [
      read(
        'loci-route',
        'Pick a route you know well, like walking from your front door to your room. We will use three stops.',
        { example: 'Front door, kitchen, bedroom.' },
      ),
      ask(
        'loci-places',
        'What are the three stops on your route, in order? Separate them with commas.',
        (answer) => {
          const parts = splitList(answer);
          ctx.places = [0, 1, 2].map((i) => parts[i] || DEFAULT_PLACES[i]);
          return {
            tone: 'success',
            feedback: `We will use these stops: ${ctx.places.join(', then the ')}.`,
          };
        },
        {
          placeholder: 'Front door, kitchen, bedroom',
        },
      ),
      read(
        'loci-items',
        'Now walk that route in your mind. At each stop, put one thing you want to remember. Make a funny picture in your mind — it helps you remember.',
        { example: 'A big teacup on the front door mat.' },
      ),
      itemStep(0),
      itemStep(1),
      itemStep(2),
      read(
        'loci-walk',
        'Close your eyes and walk the route slowly in your mind. Take your time. When you are ready, we will check what you remember.',
      ),
      recallStep(0),
      recallStep(1),
      recallStep(2),
    ],
  };
}

function elaborativeEncoding(exercise) {
  const sample = text(exercise.sample_content);
  const ctx = { target: sample, link: '' };
  const steps = [];

  if (sample) {
    steps.push(
      read(
        'elaborative-target',
        `We will use one of your saved memories: ${targetLabel(sample)}. Read it and keep it in your mind.`,
      ),
    );
  } else {
    steps.push(
      ask(
        'elaborative-choose',
        'What is one thing you want to remember today? It can be a name, an appointment, or something you often forget.',
        (answer) => {
          ctx.target = text(answer);
          return {
            tone: 'success',
            feedback: `We will work with ${targetLabel(ctx.target)}.`,
          };
        },
        {
          placeholder: 'Water the tomatoes on Friday',
        },
      ),
    );
  }

  steps.push(
    ask(
      'elaborative-link',
      () =>
        `What does ${targetLabel(ctx.target)} remind you of? It can be a person, a place, a story, or a smell.`,
      (answer) => {
        ctx.link = text(answer);
        return {
          tone: 'success',
          feedback: 'Good link. This helps you remember it better.',
        };
      },
      {
        placeholder: 'It reminds me of…',
      },
    ),
    ask(
      'elaborative-sentence',
      'Put them together in one sentence, in your own words.',
      thanks('Good. Saying it in one sentence helps it stick.'),
      {
        placeholder: 'I will remember… because…',
      },
    ),
    ask(
      'elaborative-repeat',
      'Without looking back, say the link again in your own words.',
      (answer) =>
        overlaps(answer, `${ctx.link} ${ctx.target}`)
          ? {
              correct: true,
              tone: 'success',
              feedback: 'You remembered it. That is the idea.',
            }
          : {
              correct: false,
              tone: 'info',
              feedback: `That’s okay. Your link was: “${ctx.link || 'your link'}”. Try saying it again.`,
            },
      {
        counted: false,
        placeholder: 'My link is…',
      },
    ),
  );

  return { steps };
}

function spacedRetrieval(exercise) {
  const sample = text(exercise.sample_content);
  const ctx = { target: sample };
  const steps = [];

  if (sample) {
    steps.push(
      read(
        'spaced-target-read',
        `We will use one of your saved memories: ${targetLabel(sample)}.`,
      ),
    );
  } else {
    steps.push(
      ask(
        'spaced-choose',
        'What is one thing you want to remember today? A name, a date, or an appointment is fine.',
        (answer) => {
          ctx.target = text(answer);
          return {
            tone: 'success',
            feedback: `We will practise ${targetLabel(ctx.target)}.`,
          };
        },
        {
          placeholder: 'Doctor on Tuesday at 10am',
        },
      ),
    );
  }

  steps.push(
    read(
      'spaced-show',
      () => `Here it is: ${targetLabel(ctx.target)}. Read it twice, slowly. When you are ready, continue.`,
    ),
    ask(
      'spaced-recall-1',
      'Look away and say it from memory. What is it?',
      (answer) => retrievalFeedback(answer, ctx.target, 1),
      {
        counted: true,
        placeholder: 'It is…',
      },
    ),
    read(
      'spaced-pause-1',
      'Take a short break. When you are ready, try again.',
    ),
    ask(
      'spaced-recall-2',
      'From memory, what was it?',
      (answer) => retrievalFeedback(answer, ctx.target, 2),
      {
        counted: true,
        placeholder: 'It is…',
      },
    ),
    read(
      'spaced-pause-2',
      'Take another short break. When you are ready, one last try.',
    ),
    ask(
      'spaced-recall-3',
      'Last time. From memory, what was it?',
      (answer) => retrievalFeedback(answer, ctx.target, 3),
      {
        counted: true,
        placeholder: 'It is…',
      },
    ),
  );

  return { steps };
}

function faceNameAssociation() {
  const ctx = { name: '', feature: '' };

  return {
    steps: [
      ask(
        'face-name',
        'Think of someone whose name you want to remember. Type their name.',
        (answer) => {
          ctx.name = text(answer);
          return {
            tone: 'success',
            feedback: `We will work with ${ctx.name}.`,
          };
        },
        {
          placeholder: 'Margaret',
        },
      ),
      ask(
        'face-feature',
        () => `What is one thing you notice about ${ctx.name}’s face? For example, their smile, glasses, or hair.`,
        (answer) => {
          ctx.feature = text(answer);
          return {
            tone: 'success',
            feedback: 'Keep that in mind.',
          };
        },
        {
          placeholder: 'A warm smile',
        },
      ),
      ask(
        'face-picture',
        () => `Make a simple picture linking ${ctx.name} and that feature. Describe it in a few words.`,
        thanks('A clear picture like this helps you remember.'),
        {
          placeholder: 'Margaret with a big smile',
        },
      ),
      ask(
        'face-name-recall',
        () => `When you picture that feature, what is their name?`,
        (answer) =>
          overlaps(answer, ctx.name)
            ? {
                correct: true,
                tone: 'success',
                feedback: `Yes — ${ctx.name}.`,
              }
            : {
                correct: false,
                tone: 'info',
                feedback: `Their name is ${ctx.name}. Picture the feature and say the name again.`,
              },
        {
          counted: true,
          placeholder: 'Their name is…',
        },
      ),
      ask(
        'face-feature-recall',
        () => `When you say ${ctx.name}, what do you picture?`,
        (answer) =>
          overlaps(answer, ctx.feature)
            ? {
                correct: true,
                tone: 'success',
                feedback: 'Yes, that matches.',
              }
            : {
                correct: false,
                tone: 'info',
                feedback: `It was: ${ctx.feature}. Picture ${ctx.name} with it again.`,
              },
        {
          counted: true,
          placeholder: 'I picture…',
        },
      ),
    ],
  };
}

function chunking() {
  const ctx = { groups: '' };

  return {
    steps: [
      read(
        'chunk-list',
        'Here is a shopping list with six things: milk, bread, apples, stamps, soap and tea. It is easier to remember them in groups.',
      ),
      ask(
        'chunk-group',
        'Put these six items into three pairs that go together. Type each pair, with a slash between pairs.',
        (answer) => {
          ctx.groups = text(answer);
          const groups = text(answer)
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean);
          return {
            tone: groups.length >= 3 ? 'success' : 'info',
            feedback:
              groups.length >= 3
                ? 'Good. Now remember the pairs, not all six at once.'
                : 'Put them into three pairs. Use a slash between each pair.',
          };
        },
        {
          placeholder: 'milk and bread / apples and tea / stamps and soap',
        },
      ),
      read(
        'chunk-hide',
        'Look away from the list. Try to remember the three pairs.',
      ),
      ask(
        'chunk-recall-1',
        'From memory, type the three pairs.',
        (answer) => {
          const hits = countItems(answer, CHUNK_ITEMS);
          return {
            correct: hits >= 4,
            tone: hits >= 4 ? 'success' : 'info',
            feedback:
              hits >= 4
                ? `You remembered ${hits} of the six items. Good.`
                : `You remembered ${hits} of the six. The list was: milk, bread, apples, stamps, soap and tea. Try again.`,
          };
        },
        {
          counted: true,
          placeholder: 'milk and bread / …',
        },
      ),
      ask(
        'chunk-recall-2',
        'Now type the same pairs in a different order.',
        (answer) => {
          const hits = countItems(answer, CHUNK_ITEMS);
          return {
            correct: hits >= 4,
            tone: hits >= 4 ? 'success' : 'info',
            feedback:
              hits >= 4
                ? `You remembered ${hits} of the six in a new order. Good.`
                : `You remembered ${hits} of the six. Keep the pairs together and try again.`,
          };
        },
        {
          counted: true,
          placeholder: 'stamps and soap / …',
        },
      ),
    ],
  };
}

function activeObservation(exercise) {
  const sample = text(exercise.sample_content);
  const details = sample
    ? unique(words(sample)).slice(0, 8)
    : DEFAULT_SCENE;
  const scene = sample || DEFAULT_SCENE.join(', ');
  const ctx = { firstHits: 0 };

  return {
    steps: [
      read(
        'observe-study',
        `Look at this for about one minute. Notice colours, shapes, and small details: ${scene}.`,
        {
          example: 'Look at where each thing is, like a photo.',
        },
      ),
      ask(
        'observe-recall-1',
        'Look away and type as many details as you can remember.',
        (answer) => {
          const hits = countItems(answer, details);
          ctx.firstHits = hits;
          return {
            correct: hits >= passMark(details.length),
            tone: hits > 0 ? 'success' : 'info',
            feedback:
              hits > 0
                ? `You remembered ${hits} of the ${details.length} details. Good start.`
                : 'That is okay. We will look again.',
          };
        },
        {
          counted: true,
          placeholder: 'I remember…',
        },
      ),
      read(
        'observe-review',
        () => `Look again: ${scene}. You remembered ${ctx.firstHits} of the ${details.length} details. Notice the ones you missed.`,
      ),
      ask(
        'observe-recall-2',
        'Now look away and type as many details as you can remember this time.',
        (answer) => {
          const hits = countItems(answer, details);
          const target = passMark(details.length);
          return {
            correct: hits >= target,
            tone: hits >= target ? 'success' : 'info',
            feedback:
              hits >= target
                ? `You remembered ${hits} of ${details.length} details. Good.`
                : `You remembered ${hits} of ${details.length} details this time. Try to notice one more thing.`,
          };
        },
        {
          counted: true,
          placeholder: 'This time I remember…',
        },
      ),
    ],
  };
}

const BUILDERS = {
  method_of_loci: methodOfLoci,
  elaborative_encoding: elaborativeEncoding,
  spaced_retrieval: spacedRetrieval,
  face_name_association: faceNameAssociation,
  chunking,
  active_observation: activeObservation,
};

export function buildTutorSession(exercise) {
  const builder = BUILDERS[exercise?.technique] || methodOfLoci;
  const { steps } = builder(exercise || {});
  return {
    steps,
    askTotal: steps.filter((step) => step.kind === 'ask').length,
    recallTotal: steps.filter((step) => step.counted).length,
  };
}
