"""
Analytics engine — FR-13, document of proof section 3.5.3 output design:

    "The Analytics Dashboard displays: overall recall accuracy as a
     percentage, a bar chart showing forgetting frequency by category, a
     line chart showing accuracy improvement over time, current streak
     counters, and a motivational message from the AI."

All numbers are computed from real recallsessions/analyticsrecords data.
"""
from datetime import date, timedelta

from models import MemoryCategory, RecallSession
from services.ai.client import call_llm

MOTIVATIONAL_SYSTEM = (
    "You are Aria from MemorAid. Write ONE short, warm motivational sentence "
    "(max 20 words) for an elderly user based on their recall statistics. "
    "Never exaggerate; be genuine and kind."
)

FALLBACK_MESSAGES = [
    "Every session you complete is your memory getting a little stronger — well done.",
    "You are building a wonderful habit. Keep going, one question at a time.",
    "Your memory is like a muscle — and you are exercising it beautifully today.",
]


def compute_analytics(user):
    sessions = RecallSession.query.filter_by(userid=user.userid).all()
    total = len(sessions)
    passed = sum(1 for s in sessions if s.passed)
    overall_accuracy = round(100 * passed / total, 1) if total else 0.0

    # Forgetting frequency by category (bar chart data)
    cat_stats = {}
    for s in sessions:
        from models import MemoryEntry
        entry = MemoryEntry.query.get(s.memoryid) if s.memoryid else None
        name = entry.category.categoryname if entry and entry.category else "General"
        agg = cat_stats.setdefault(name, {"total": 0, "passed": 0})
        agg["total"] += 1
        if s.passed:
            agg["passed"] += 1

    categories = []
    weakest, weakest_ratio = None, 1.1
    for name in sorted(set([c.categoryname for c in MemoryCategory.query.all()] + list(cat_stats.keys()))):
        stats = cat_stats.get(name, {"total": 0, "passed": 0})
        acc = round(100 * stats["passed"] / stats["total"], 1) if stats["total"] else None
        categories.append({
            "category": name,
            "total": stats["total"],
            "passed": stats["passed"],
            "forgotten": stats["total"] - stats["passed"],   # bar chart series
            "accuracy": acc,
        })
        if stats["total"] >= 3:
            ratio = stats["passed"] / stats["total"]
            if ratio < weakest_ratio:
                weakest, weakest_ratio = name, ratio

    # Accuracy over time (line chart): weekly buckets, last 8 weeks
    trend = []
    today = date.today()
    for weeks_ago in range(7, -1, -1):
        start = today - timedelta(days=7 * weeks_ago + 6)
        end = today - timedelta(days=7 * weeks_ago)
        in_bucket = [
            s for s in sessions
            if s.sessiondate and start <= s.sessiondate.date() <= end
        ]
        if in_bucket:
            acc = round(100 * sum(1 for s in in_bucket if s.passed) / len(in_bucket), 1)
        else:
            acc = None
        trend.append({
            "week_ending": end.isoformat(),
            "accuracy": acc,
            "attempts": len(in_bucket),
        })

    message = call_llm(
        MOTIVATIONAL_SYSTEM,
        f"Recall accuracy: {overall_accuracy}% over {total} attempts. "
        f"Recall streak: {user.recall_streak or 0} day(s). "
        f"Weakest area: {weakest or 'none yet'}.",
        max_tokens=60,
        tier="fast",
    )
    if not message:
        message = FALLBACK_MESSAGES[(total or 0) % len(FALLBACK_MESSAGES)]

    return {
        "overall_accuracy": overall_accuracy,
        "total_attempts": total,
        "total_passed": passed,
        "recall_streak": user.recall_streak or 0,
        "exercise_streak": user.exercise_streak or 0,
        "categories": categories,
        "trend": trend,
        "weakest_category": weakest,
        "motivational_message": message,
    }


def weakest_category_for_user(user):
    """Name of the category with the lowest accuracy (>=3 attempts)."""
    return compute_analytics(user)["weakest_category"]
