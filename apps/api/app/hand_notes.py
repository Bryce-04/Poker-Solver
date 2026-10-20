"""Per-hand notes for a live solve's result panel: a category for each hand
type ("Top pair, strong kicker", "Flush draw") and the rule-of-thumb "why"
bullets the Poker Drill shows. One classifier for both -- this reuses
drill_analysis.py rather than keeping a second one in the web app.

Same honesty as the Drill: every number in a bullet is computed from this
solve (equity against the opponent's real range from the trainer's own
equity matrix, where the hand ranks in its range, how often the whole range
takes each action, the price when facing a bet). The sentence tying them to
the action is the standard poker rationale applied by rules, not something
the solver derived; the UI says so.

Flop only: drill_analysis.describe_hand classifies two hole cards against
three board cards. On the turn or river this returns nothing, and the panel
leaves the category and the "why" out.
"""

from __future__ import annotations

from collections import Counter

import numpy as np

from poker_solver.betting_round import BET_SIZE_MENU
from poker_solver.range_cfr import RangeCfrTrainer

from .drill_analysis import AnalysisInput, HandProfile, describe_board, describe_hand, explain

_BET_FRACTION = {label: frac for frac, label in BET_SIZE_MENU}


def category_label(profile: HandProfile) -> str:
    """'top pair' + a strong kicker -> 'Top pair, strong kicker'; a made hand
    with a real draw -> 'Second pair + flush draw'; 'an ace high' -> 'Ace high'."""
    text = profile.label
    for article in ("a ", "an "):
        if text.startswith(article):
            text = text[len(article):]
    if "a strong kicker" in profile.notes:
        text += ", strong kicker"
    if profile.made != "nothing":
        draws = [d for d in profile.draws if "backdoor" not in d]
        if draws:
            text += f" + {draws[0]}"
    return text[0].upper() + text[1:]


def _percentiles(equities: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Per combo: the share of the range (by weight) it beats on equity, ties
    counted half -- the Drill's 'stronger than X% of your range'."""
    eq = np.nan_to_num(equities, nan=0.0)
    total = float(weights.sum())
    order = np.argsort(eq)
    sorted_eq, sorted_w = eq[order], weights[order]
    below = np.concatenate([[0.0], np.cumsum(sorted_w)])
    out = np.empty_like(eq)
    for i in order:
        lo = np.searchsorted(sorted_eq, eq[i] - 1e-9, side="left")
        hi = np.searchsorted(sorted_eq, eq[i] + 1e-9, side="right")
        out[i] = (below[lo] + 0.5 * (below[hi] - below[lo])) / total
    return out


def hand_notes(
    trainer: RangeCfrTrainer,
    board: tuple[int, ...],
    pot_bb: float,
    player: int,
    hero: str,
    villain: str,
    strategy: dict[str, dict[str, float]],
    prior_history: tuple[str, ...],
) -> tuple[dict[str, str], dict[str, list[str]]]:
    """(hand_categories, hand_reasons) for the deciding player's hand types,
    keyed by 169-type label. A label's category is what most of its live
    combos are (suits can differ: one AKs combo may hold a flush draw)."""
    if len(board) != 3:
        return {}, {}

    combos, weights, labels = trainer.combos[player], trainer.weights[player], trainer.labels[player]
    equities, range_equity = trainer.combo_equities(player)
    percentiles = _percentiles(equities, weights)
    texture = describe_board(board)

    actions, combo_strategy = trainer.average_strategy()
    live = weights > 0
    range_mix = {
        a: float(np.average(combo_strategy[live, k], weights=weights[live])) for k, a in enumerate(actions)
    }
    facing_bet = "call" in actions
    last = prior_history[-1] if prior_history else None
    bet_bb = _BET_FRACTION.get(last, 0.0) * pot_bb if facing_bet and last else 0.0
    # Facing a raise or a jam the price isn't known from the menu alone; the
    # price-based bullets would be wrong, so those spots get categories only.
    explain_ok = not facing_bet or bet_bb > 0

    by_label: dict[str, list[int]] = {}
    for i, (label, weight) in enumerate(zip(labels, weights)):
        if weight > 0:
            by_label.setdefault(label, []).append(i)

    categories: dict[str, str] = {}
    reasons: dict[str, list[str]] = {}
    for label, indices in by_label.items():
        profiles = [describe_hand((combos[i][0], combos[i][1]), board) for i in indices]
        common = Counter(category_label(p) for p in profiles).most_common(1)[0][0]
        categories[label] = common
        if not explain_ok or label not in strategy:
            continue
        profile = next(p for p in profiles if category_label(p) == common)
        w = weights[indices]
        reasons[label] = explain(
            AnalysisInput(
                hero=hero,
                villain=villain,
                facing_bet=facing_bet,
                mix=strategy[label],
                profile=profile,
                texture=texture,
                equity=float(np.average(np.nan_to_num(equities[indices]), weights=w)),
                percentile=float(np.average(percentiles[indices], weights=w)),
                hero_range_equity=range_equity,
                range_mix=range_mix,
                pot_bb=pot_bb,
                bet_bb=bet_bb,
            )
        )
    return categories, reasons
