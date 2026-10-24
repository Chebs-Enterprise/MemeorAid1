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
          ? 'Yes — that is right. Well done.'
          : 'Yes, again. Each time you bring it back, it gets a little stronger.',
    };
  }
  return {
    correct: false,
    tone: 'info',
    feedback: `Not quite this time. It was ${targetLabel(target)}. That is all right — seeing it again is part of how the practice works.`,
  };
}

/* ------------------------------------------------------------------ scripts */

function methodOfLoci() {
  const ctx = { places: [], items: [] };

  const itemStep = (index) =>
    ask(
      `loci-item-${index + 1}`,
      () => `What will you leave at the ${ctx.places[index]}?`,
      (answer) => {
        ctx.items[index] = text(answer);
        return {
          tone: 'success',
          feedback: `Good. Picture it clearly at the ${ctx.places[index]}.`,
        };
      },
      {
        placeholder: 'A giant teacup',
        hint: 'Anything works — keys, a cup of tea, or a favourite flower.',
      },
    );

  const recallStep = (index) =>
    ask(
      `loci-recall-${index + 1}`,
      () => `At the ${ctx.places[index]}, what did you leave?`,
      (answer) => {
        const expected = ctx.items[index] || 'something';
        if (overlaps(answer, expected)) {
          return {
            correct: true,
            tone: 'success',
            feedback: `That's it — ${expected} at the ${ctx.places[index]}. Well done.`,
          };
        }
        return {
          correct: false,
          tone: 'info',
          feedback: `Not quite. You left ${expected} at the ${ctx.places[index]}. Picture it there once more — every pass makes it stronger.`,
        };
      },
      {
        counted: true,
        placeholder: 'I pictured…',
        hint: 'Picture the place first. The thing you left there will come back.',
      },
    );

  return {
    steps: [
      read(
        'loci-route',
        'Let’s begin with a route you know very well — the walk through your home, or the short walk to your front gate. We will use three stops along that route.',
        { example: 'The front door, then the kitchen, then the bedroom.' },
      ),
      ask(
        'loci-places',
        'What are the three stops on your route, in order? Separate them with commas.',
        (answer) => {
          const parts = splitList(answer);
          ctx.places = [0, 1, 2].map((i) => parts[i] || DEFAULT_PLACES[i]);
          return {
            tone: 'success',
            feedback: `Lovely. We will use the ${ctx.places.join(', then the ')}.`,
          };
        },
        {
          placeholder: 'Front door, kitchen, bedroom',
          hint: 'Any three places you can picture clearly will work.',
        },
      ),
      read(
        'loci-items',
        'Now picture yourself walking that route. At each stop, leave one thing you want to remember. Make the picture funny, colourful or a little unusual — that is what helps it stick.',
        { example: 'A giant teacup balanced on the front doormat.' },
      ),
      itemStep(0),
      itemStep(1),
      itemStep(2),
      read(
        'loci-walk',
        'Now close your eyes for a moment and walk your route slowly in your mind. Take your time. When you are ready, we will check what you found.',
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
        `Let’s use one of your saved memories: ${targetLabel(sample)}. Read it once and hold it in your mind.`,
      ),
    );
  } else {
    steps.push(
      ask(
        'elaborative-choose',
        'What is one thing you would like to remember today? It can be a name, an appointment, or something you keep forgetting.',
        (answer) => {
          ctx.target = text(answer);
          return {
            tone: 'success',
            feedback: `Good — we will work with ${targetLabel(ctx.target)}.`,
          };
        },
        {
          placeholder: 'Water the tomatoes on Friday',
          hint: 'A short phrase is plenty.',
        },
      ),
    );
  }

  steps.push(
    ask(
      'elaborative-link',
      () =>
        `What does ${targetLabel(ctx.target)} remind you of? It can be a person, a place, a story, a smell — anything at all.`,
      (answer) => {
        ctx.link = text(answer);
        return {
          tone: 'success',
          feedback:
            'That is a real connection. Connections like that give your memory a hook to hang on.',
        };
      },
      {
        placeholder: 'It reminds me of…',
        hint: 'There is no right answer. The more personal, the stronger the link.',
      },
    ),
    ask(
      'elaborative-sentence',
      'Now join the two together in one full sentence, in your own words.',
      thanks('Beautifully put. Saying it in a full sentence makes the link stronger.'),
      {
        placeholder: 'I will remember… because…',
        hint: 'Try starting with: “I will remember … because …”.',
      },
    ),
    ask(
      'elaborative-repeat',
      'Without looking back, tell me the connection once more, in a different way.',
      (answer) =>
        overlaps(answer, `${ctx.link} ${ctx.target}`)
          ? {
              correct: true,
              tone: 'success',
              feedback: 'You remembered your own link. That is the whole idea.',
            }
          : {
              correct: false,
              tone: 'info',
              feedback: `That is all right. Your link was: “${ctx.link || 'your own connection'}”. Say it once more to yourself before we finish.`,
            },
      {
        counted: false,
        placeholder: 'My connection was…',
        hint: 'Think of the person, place or feeling you chose.',
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
        'What is one thing you want to remember today? A name, a date, or an appointment are all good choices.',
        (answer) => {
          ctx.target = text(answer);
          return {
            tone: 'success',
            feedback: `Good. We will practise ${targetLabel(ctx.target)}.`,
          };
        },
        {
          placeholder: 'Doctor on Tuesday at 10am',
          hint: 'Choose something short and useful.',
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
      'Look away and say it from memory. What was it?',
      (answer) => retrievalFeedback(answer, ctx.target, 1),
      {
        counted: true,
        placeholder: 'I was remembering…',
        hint: 'Have a go — even part of it is useful.',
      },
    ),
    read(
      'spaced-pause-1',
      'Take a slow breath in through your nose… and out. When you are ready, we will try again.',
    ),
    ask(
      'spaced-recall-2',
      'Once more, from memory: what were you remembering?',
      (answer) => retrievalFeedback(answer, ctx.target, 2),
      {
        counted: true,
        placeholder: 'It was…',
        hint: 'The first letter or the shape of the words can help.',
      },
    ),
    read(
      'spaced-pause-2',
      'One last time. Take a moment, then continue when you feel ready.',
    ),
    ask(
      'spaced-recall-3',
      'Last try. From memory, what was it?',
      (answer) => retrievalFeedback(answer, ctx.target, 3),
      {
        counted: true,
        placeholder: 'I remember…',
        hint: 'You have done this twice already — trust yourself.',
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
        'Think of someone whose name you would like to remember. Type their name.',
        (answer) => {
          ctx.name = text(answer);
          return {
            tone: 'success',
            feedback: `Good — we will work with ${ctx.name}.`,
          };
        },
        {
          placeholder: 'Margaret',
          hint: 'A family member, a neighbour, or someone you see often.',
        },
      ),
      ask(
        'face-feature',
        () => `What is one feature you notice about ${ctx.name}’s face? A smile, glasses, or their hair, for example.`,
        (answer) => {
          ctx.feature = text(answer);
          return {
            tone: 'success',
            feedback: `That is a good hook. Keep that picture in mind.`,
          };
        },
        {
          placeholder: 'A warm, wide smile',
          hint: 'Pick something easy to picture.',
        },
      ),
      ask(
        'face-picture',
        () => `Now make a silly picture or a short rhyme joining ${ctx.name} and that feature. Describe it in a few words.`,
        thanks('That is exactly the kind of picture that sticks.'),
        {
          placeholder: 'Margaret’s smile is as wide as a watermelon.',
          hint: 'The sillier it is, the easier it is to remember.',
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
                feedback: `That’s it — ${ctx.name}.`,
              }
            : {
                correct: false,
                tone: 'info',
                feedback: `Their name is ${ctx.name}. Picture the feature again and say the name with it.`,
              },
        {
          counted: true,
          placeholder: 'Their name is…',
          hint: 'Picture the feature first, then the name follows.',
        },
      ),
      ask(
        'face-feature-recall',
        () => `And when you say ${ctx.name}, which feature do you see?`,
        (answer) =>
          overlaps(answer, ctx.feature)
            ? {
                correct: true,
                tone: 'success',
                feedback: 'Yes — that is the pair working both ways.',
              }
            : {
                correct: false,
                tone: 'info',
                feedback: `The feature was: ${ctx.feature}. Picture ${ctx.name} with it once more.`,
              },
        {
          counted: true,
          placeholder: 'I picture…',
          hint: 'Think of the silly picture you made.',
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
        'Here is a shopping list with six things: milk, bread, apples, stamps, soap and tea. Six separate things can feel like a lot to hold.',
      ),
      ask(
        'chunk-group',
        'Group the six items into three pairs that make sense to you. Type each pair, with a slash between the pairs.',
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
                ? 'Three groups — just right. Give each pair a little picture in your mind.'
                : 'That is a start. Three short pairs will be easier to hold — you can use one slash between each pair.',
          };
        },
        {
          placeholder: 'milk and bread / apples and tea / stamps and soap',
          hint: 'A pair can be two things you would buy together, or two things you use together.',
        },
      ),
      read(
        'chunk-hide',
        'Now look away from the list. Remember your three groups, not the six separate things.',
      ),
      ask(
        'chunk-recall-1',
        'From memory, type your three pairs.',
        (answer) => {
          const hits = countItems(answer, CHUNK_ITEMS);
          return {
            correct: hits >= 4,
            tone: hits >= 4 ? 'success' : 'info',
            feedback:
              hits >= 4
                ? `You recalled ${hits} of the six items by grouping them. Well done.`
                : `You remembered ${hits} of the six. The list was: milk, bread, apples, stamps, soap and tea. Look at the pairs once more.`,
          };
        },
        {
          counted: true,
          placeholder: 'milk and bread / …',
          hint: 'Start with the first pair you made, then the next.',
        },
      ),
      ask(
        'chunk-recall-2',
        'Now say the same three groups in a different order. Type them again.',
        (answer) => {
          const hits = countItems(answer, CHUNK_ITEMS);
          return {
            correct: hits >= 4,
            tone: hits >= 4 ? 'success' : 'info',
            feedback:
              hits >= 4
                ? `That is ${hits} of the six, in a new order. Your memory is using the groups.`
                : `You remembered ${hits} of the six this time. The pairs are still there — say them once more to yourself.`,
          };
        },
        {
          counted: true,
          placeholder: 'stamps and soap / …',
          hint: 'Change the order but keep each pair together.',
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
        `Study this carefully for a moment. Notice colours, shapes and small details: ${scene}.`,
        {
          example: 'Picture where each thing sits, as if you were looking at a photograph.',
        },
      ),
      ask(
        'observe-recall-1',
        'Without looking back, type as many details as you can remember.',
        (answer) => {
          const hits = countItems(answer, details);
          ctx.firstHits = hits;
          return {
            correct: hits >= passMark(details.length),
            tone: hits > 0 ? 'success' : 'info',
            feedback:
              hits > 0
                ? `You remembered ${hits} of the ${details.length} details. That is a good first pass.`
                : 'That is all right — this is a warm-up. We will look at the details again.',
          };
        },
        {
          counted: true,
          placeholder: 'I remember…',
          hint: 'Start with colours or the biggest shapes.',
        },
      ),
      read(
        'observe-review',
        () => `Here it is again: ${scene}. You found ${ctx.firstHits} of the ${details.length} details. Notice the ones you missed — colours and positions help.`,
      ),
      ask(
        'observe-recall-2',
        'Now try once more. Type every detail you can remember.',
        (answer) => {
          const hits = countItems(answer, details);
          const target = passMark(details.length);
          return {
            correct: hits >= target,
            tone: hits >= target ? 'success' : 'info',
            feedback:
              hits >= target
                ? `That is ${hits} of ${details.length}. Your second look made a difference.`
                : `You remembered ${hits} of ${details.length} this time. Keep the scene in your mind and notice one more detail before you finish.`,
          };
        },
        {
          counted: true,
          placeholder: 'This time I remember…',
          hint: 'Go slowly around the scene, one colour at a time.',
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
