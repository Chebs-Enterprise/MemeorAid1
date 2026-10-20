"""
SM-2 spaced repetition algorithm.

Standard SM-2 (Wozniak, 1990) — see implementation plan section 8.1. The
schedule drives which memories become due in the recall session. Unit tests in
tests/test_sm2.py cover the interval progression and ease-factor adjustments.
"""
from datetime import date, timedelta


def calculate_sm2(quality, current_repetition=0, current_ease_factor=2.5, current_interval=0):
    """Calculate the next SM-2 schedule state.

    quality: 0-5 self-assessed recall quality (3 = pass threshold)
    Returns dict with repetition, ease_factor, interval, next_review_date,
    quality and passed.
    """
    q = max(0, min(5, round(float(quality))))
    repetition = int(current_repetition or 0)
    ease_factor = float(current_ease_factor or 2.5)
    interval = int(current_interval or 0)

    if q >= 3:
        if repetition == 0:
            interval = 1
        elif repetition == 1:
            interval = 6
        else:
            interval = round(interval * ease_factor)
        repetition += 1
    else:
        # Recall failed: reset repetition count and review tomorrow.
        repetition = 0
        interval = 1

    # EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), floor 1.3
    ease_factor = ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    if ease_factor < 1.3:
        ease_factor = 1.3
    ease_factor = round(ease_factor, 2)

    next_review_date = date.today() + timedelta(days=interval)

    return {
        "repetition": repetition,
        "ease_factor": ease_factor,
        "interval": interval,
        "next_review_date": next_review_date,
        "quality": q,
        "passed": q >= 3,
    }
