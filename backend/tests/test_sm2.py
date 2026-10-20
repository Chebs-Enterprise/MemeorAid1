"""SM-2 parity tests against the JavaScript reference (assets/js/sm2.js)."""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.sm2 import calculate_sm2  # noqa: E402


def test_first_pass_gives_one_day():
    r = calculate_sm2(4, 0, 2.5, 0)
    assert r["interval"] == 1
    assert r["repetition"] == 1
    assert r["passed"] is True


def test_second_pass_gives_six_days():
    r = calculate_sm2(4, 1, 2.5, 1)
    assert r["interval"] == 6
    assert r["repetition"] == 2


def test_third_pass_multiplies_by_ease_factor():
    r = calculate_sm2(5, 2, 2.5, 6)
    assert r["interval"] == round(6 * 2.5)  # 15
    assert r["repetition"] == 3


def test_failure_resets_and_reviews_tomorrow():
    r = calculate_sm2(1, 3, 2.5, 15)
    assert r["repetition"] == 0
    assert r["interval"] == 1
    assert r["passed"] is False
    assert r["next_review_date"] == date.today() + timedelta(days=1)


def test_ease_factor_floor_is_1_3():
    r = calculate_sm2(0, 0, 1.3, 0)
    assert r["ease_factor"] == 1.3


def test_ease_factor_decreases_on_poor_quality():
    r = calculate_sm2(3, 1, 2.5, 1)
    assert r["ease_factor"] < 2.5


def test_quality_is_clamped_to_0_5():
    assert calculate_sm2(99)["quality"] == 5
    assert calculate_sm2(-3)["quality"] == 0
    assert calculate_sm2(5)["passed"] is True


def test_next_review_date_matches_interval():
    r = calculate_sm2(4, 1, 2.5, 1)
    assert r["next_review_date"] == date.today() + timedelta(days=r["interval"])
