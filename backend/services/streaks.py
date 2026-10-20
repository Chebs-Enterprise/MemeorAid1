"""Dual streak management (implementation plan section 8.3, FR-12).

The document tracks exercise_streak and recall_streak separately on the
users table. Each streak increments on the first qualifying session of a
calendar day and resets to 0 when a full day is missed.
"""
from datetime import date, timedelta

from models import db


def _bump_streak(user, current_value, last_date_attr, today=None):
    today = today or date.today()
    last = getattr(user, last_date_attr)
    if last == today:
        return current_value  # already counted today
    if last == today - timedelta(days=1):
        current_value = (current_value or 0) + 1
    else:
        current_value = 1
    setattr(user, last_date_attr, today)
    return current_value


def update_recall_streak(user, today=None):
    user.recall_streak = _bump_streak(user, user.recall_streak, "last_recall_date", today)
    user.last_activity_date = today or date.today()
    return user.recall_streak


def update_exercise_streak(user, today=None):
    user.exercise_streak = _bump_streak(user, user.exercise_streak, "last_exercise_date", today)
    user.last_activity_date = today or date.today()
    return user.exercise_streak


def record_activity(user, today=None):
    user.last_activity_date = today or date.today()
    db.session.commit()
