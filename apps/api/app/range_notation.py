"""Expands standard poker range shorthand ("77+", "A2s+", "KQo") into the
169-hand-type notation used by HandRange (see packages/schema). Exists so
the actual ranges in reference_charts.py read like range notation a poker
player would recognize, instead of 50-80 individual hand strings typed out
by hand (error-prone, and unreviewable at a glance).
"""

RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]
_RANK_INDEX = {rank: i for i, rank in enumerate(RANKS)}  # 0 = A (highest)


def _expand_token(token: str) -> list[str]:
    token = token.strip()
    plus = token.endswith("+")
    body = token[:-1] if plus else token

    if len(body) == 2 and body[0] == body[1]:
        # Pair, e.g. "77" or "77+" -> 77 up through AA.
        if not plus:
            return [body]
        low_idx = _RANK_INDEX[body[0]]
        return [f"{RANKS[i]}{RANKS[i]}" for i in range(0, low_idx + 1)]

    # Suited/offsuit, e.g. "A2s" or "K7o+".
    high, low, suffix = body[0], body[1], body[2]
    if not plus:
        return [f"{high}{low}{suffix}"]
    high_idx, low_idx = _RANK_INDEX[high], _RANK_INDEX[low]
    # "+" widens the kicker from `low` up toward (but not including) `high`.
    return [f"{high}{RANKS[k]}{suffix}" for k in range(high_idx + 1, low_idx + 1)]


def expand_range(tokens: list[str]) -> dict[str, float]:
    """Expands a list of range-notation tokens into a HandRange-shaped dict,
    each hand weighted 1.0 (full frequency -- these charts don't represent
    mixed strategies yet, see reference_charts.py's module docstring)."""
    hands: dict[str, float] = {}
    for token in tokens:
        for hand in _expand_token(token):
            hands[hand] = 1.0
    return hands
