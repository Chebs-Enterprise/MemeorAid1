/**
 * MemorAid - Standalone SM-2 Spaced Repetition Algorithm
 * 
 * Standard SM-2 algorithm implementation.
 * Pure deterministic function, zero external dependencies.
 * Matches backend build plan step 6 specification.
 */

function calculateSM2(quality, currentRepetition = 0, currentEaseFactor = 2.5, currentInterval = 0) {
  // Quality must be an integer 0 - 5
  const q = Math.max(0, Math.min(5, Math.round(Number(quality))));
  let repetition = Number(currentRepetition) || 0;
  let easeFactor = Number(currentEaseFactor) || 2.5;
  let interval = Number(currentInterval) || 0;

  if (q >= 3) {
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetition += 1;
  } else {
    // Recall failed: reset repetition count and review tomorrow
    repetition = 0;
    interval = 1;
  }

  // Update ease factor according to SM-2 formula:
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  
  // SM-2 minimum floor for Ease Factor is 1.3
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  // Round easeFactor to 2 decimal places for clean storage
  easeFactor = Math.round(easeFactor * 100) / 100;

  // Calculate next review date based on interval in days
  const now = new Date();
  const nextDate = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
  const nextReviewDate = nextDate.toISOString().split('T')[0];

  return {
    repetition,
    easeFactor,
    interval,
    nextReviewDate,
    quality: q,
    passed: q >= 3
  };
}

// Export for module systems or window global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateSM2 };
} else {
  window.calculateSM2 = calculateSM2;
}
