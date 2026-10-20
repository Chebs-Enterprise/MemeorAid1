"""
Shared Claude API client (document of proof section 2.2.2).

MemorAid does not train a custom model — it uses Claude with backend logic
that collects and structures user data into a rich context before each
call. Every generator has a deterministic fallback so the system stays
functional when the API is unavailable (section 1.6 acknowledges the
dependency on a third-party API).
"""
from config import Config


def call_claude(system_prompt, user_prompt, max_tokens=500):
    """Return Claude's text response, or None on any failure/missing key."""
    if not Config.ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=Config.CLAUDE_MODEL,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        parts = [block.text for block in message.content if getattr(block, "type", None) == "text"]
        text = "\n".join(parts).strip()
        return text or None
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] Claude API call failed, using fallback: {exc}")
        return None


def build_context_pack(user, include_patterns=True):
    """Structure the user's data into context for a personalised prompt.

    Returns a plain-text context block (memory history, recall performance,
    streaks, confirmed behaviour patterns, age group).
    """
    from models import BehaviorPattern, ExerciseSession, MemoryEntry, RecallSession

    lines = [f"User age group: {user.agegroup} (use an age-appropriate, warm, patient tone)."]
    lines.append(
        f"Current streaks — recall: {user.recall_streak or 0} day(s), "
        f"exercise: {user.exercise_streak or 0} day(s)."
    )

    memories = (
        MemoryEntry.query.filter_by(userid=user.userid, status="active")
        .order_by(MemoryEntry.datecreated.desc()).limit(10).all()
    )
    if memories:
        lines.append("Recent memories the user has logged:")
        for m in memories[-6:]:
            cat = m.category.categoryname if m.category else "Memory"
            snippet = (m.content or "")[:140]
            lines.append(f"- [{cat}] {snippet}")

    sessions = (
        RecallSession.query.filter_by(userid=user.userid)
        .order_by(RecallSession.sessiondate.desc()).limit(30).all()
    )
    if sessions:
        total = len(sessions)
        passed = sum(1 for s in sessions if s.passed)
        lines.append(
            f"Recent recall performance: {passed}/{total} successful "
            f"({round(100 * passed / total)}% accuracy)."
        )
        cat_counts = {}
        for s in sessions:
            entry = MemoryEntry.query.get(s.memoryid) if s.memoryid else None
            name = entry.category.categoryname if entry and entry.category else "General"
            agg = cat_counts.setdefault(name, [0, 0])
            agg[0] += 1
            if s.passed:
                agg[1] += 1
        weak = [(c, a) for c, a in cat_counts.items() if a[0] >= 3 and a[1] / a[0] < 0.7]
        if weak:
            lines.append(
                "Areas the user finds difficult: "
                + ", ".join(f"{c} ({round(100 * p / t)}% recall)" for c, (t, p) in weak)
                + "."
            )

    exercises = (
        ExerciseSession.query.filter_by(userid=user.userid, completed=True)
        .order_by(ExerciseSession.sessiondate.desc()).limit(5).all()
    )
    if exercises:
        lines.append(
            "Recent memory exercises completed: "
            + ", ".join(sorted({e.technique.replace("_", " ") for e in exercises}))
            + "."
        )

    if include_patterns:
        from services.pattern_confidence import get_context_patterns

        patterns = get_context_patterns(user)
        if patterns:
            lines.append(
                "Possible behaviour patterns (UNCONFIRMED — refer to these only as "
                "possibilities, never as facts):"
            )
            for p in patterns:
                lines.append(f"- {p['pattern_type']}: {p['pattern_data']} (confidence {p['confidence_score']})")

    return "\n".join(lines)
