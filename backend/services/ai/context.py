"""
Context pack — everything the model is told about the user before it replies.

This is where "personalised" is actually won or lost. A frontier model
sounds generic when its prompt is generic. The pack therefore carries four
layers of the user's own material, in this order:

    1. durable facts      what we know about them (family, routine, ...)
    2. relevant memories  retrieved for *this* message, not just the latest
    3. past conversation  things they already told us
    4. performance data   recall accuracy, streaks, weak categories

plus the confirmed/unconfirmed behaviour patterns (section 1.7) which may
only ever be offered as possibilities.

The section headers are stable because the offline mock reply builder
parses them — the mock reads exactly what the real model would read.
"""
from config import Config
from services.ai import memory_store
from services.ai.client import SECTION_CHAT, SECTION_FACTS, SECTION_MEMORIES


def _profile_lines(user):
    full = (user.fullname or "").strip()
    first = full.split()[0] if full else "the person"
    lines = [f"Name: {full}. Call them {first}."]
    lines.append(
        f"Age group: {user.agegroup} — write for someone in this age band "
        "(use an age-appropriate, warm, patient tone)."
    )
    if user.accessibilitypref:
        lines.append(f"Accessibility preference: {user.accessibilitypref}.")
    if user.family_contact_email:
        lines.append("A family member is linked to this account for safety alerts.")
    return lines


def _fact_lines(user, facts):
    lines = []
    for fact in facts:
        confidence = fact.get("confidence", 0.5)
        lines.append(
            f"{fact['facttext']} ({fact.get('facttype', 'general')}, "
            f"confidence {round(float(confidence), 2)})"
        )
    return lines


def _memory_lines(memories):
    lines = []
    for memory in memories:
        date = (memory.get("datecreated") or "")[:10]
        category = memory.get("category") or "Memory"
        content = (memory.get("content") or "").strip()
        note = (memory.get("contextnote") or "").strip()
        text = f"[{category}] {date}: {content}" if date else f"[{category}]: {content}"
        if note:
            text += f" (context: {note})"
        reasons = memory.get("reasons") or []
        if reasons:
            text += f" — selected because it {reasons[0]}"
        lines.append(text)
    return lines


def _chat_lines(rows):
    lines = []
    for row in rows:
        date = (row.get("createdat") or "")[:10]
        speaker = "They said" if row.get("role") == "user" else "I said"
        lines.append(f"{speaker}: {row['messagetext']} ({date})")
    return lines


def build_context_pack(user, query=None, include_patterns=True,
                       memory_limit=None, fact_limit=None, chat_limit=None,
                       memories=None, facts=None, past=None):
    """Structure the user's data into context for a personalised prompt.

    ``query`` is the current message. When it is given, memories/facts/past
    conversation are *retrieved* against it; without it the pack falls back
    to the most recent items (used by the scheduled generators).

    Pre-retrieved results may be passed in (``memories``, ``facts``,
    ``past``) so a caller that has already retrieved them does not pay for
    the search twice.
    """
    from models import BehaviorPattern, ExerciseSession, MemoryEntry, RecallSession

    lines = []
    lines.append("About the user:")
    lines.extend(f"- {line}" for line in _profile_lines(user))

    # ── 1. Durable facts ────────────────────────────────────────────────
    if facts is None:
        facts = memory_store.retrieve_facts(
            user, query, limit=fact_limit or getattr(Config, "RETRIEVAL_FACT_LIMIT", 8)
        ) if query else []
    if not facts and not query:
        from models import UserFact
        facts = [
            {
                "facttext": f.facttext,
                "facttype": f.facttype,
                "confidence": f.confidence,
                "factid": f.factid,
            }
            for f in UserFact.query.filter_by(userid=user.userid, status="active")
            .order_by(UserFact.confidence.desc()).limit(8).all()
        ]
    lines.append("")
    lines.append(f"{SECTION_FACTS} (durable facts learned from past conversations):")
    if facts:
        lines.extend(f"- {line}" for line in _fact_lines(user, facts))
    else:
        lines.append("- (nothing yet — this is a new conversation, so stay warm and open)")

    # ── 2. Retrieved memories ───────────────────────────────────────────
    if memories is None:
        memories = memory_store.retrieve_memories(
            user, query, limit=memory_limit or getattr(Config, "RETRIEVAL_MEMORY_LIMIT", 8)
        ) if query else []
    if not memories and not query:
        recent = (
            MemoryEntry.query.filter_by(userid=user.userid, status="active")
            .order_by(MemoryEntry.datecreated.desc()).limit(6).all()
        )
        memories = [
            {
                "content": m.content,
                "contextnote": m.contextnote,
                "category": m.category.categoryname if m.category else "Memory",
                "datecreated": m.datecreated.isoformat() if m.datecreated else None,
                "reasons": ["one of your most recent memories"],
            }
            for m in recent
        ]
    lines.append("")
    lines.append(f"{SECTION_MEMORIES} (retrieved for this message):")
    if memories:
        lines.extend(f"- {line}" for line in _memory_lines(memories))
    else:
        lines.append("- (no memories yet)")

    # ── 3. Past conversation ────────────────────────────────────────────
    if past is None:
        past = memory_store.retrieve_chat(
            user, query, limit=chat_limit or getattr(Config, "RETRIEVAL_CHAT_LIMIT", 4)
        ) if query else []
    lines.append("")
    lines.append(f"{SECTION_CHAT}:")
    if past:
        lines.extend(f"- {line}" for line in _chat_lines(past))
    else:
        lines.append("- (nothing relevant from earlier conversations)")

    # ── 4. Performance data ─────────────────────────────────────────────
    lines.append("")
    lines.append(
        f"Current streaks — recall: {user.recall_streak or 0} day(s), "
        f"exercise: {user.exercise_streak or 0} day(s)."
    )

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

    # ── 5. Behaviour patterns (possibilities only) ──────────────────────
    if include_patterns:
        from services.pattern_confidence import get_context_patterns

        patterns = get_context_patterns(user)
        if patterns:
            lines.append(
                "Possible behaviour patterns (UNCONFIRMED — refer to these only as "
                "possibilities, never as facts):"
            )
            for p in patterns:
                lines.append(
                    f"- {p['pattern_type']}: {p['pattern_data']} "
                    f"(confidence {p['confidence_score']})"
                )

    return "\n".join(lines)
