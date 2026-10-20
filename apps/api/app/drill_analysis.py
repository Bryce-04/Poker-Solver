"""The "why" behind a Poker Drill answer: facts about the dealt hand and the
board, and a short rule-of-thumb explanation built from them.

Offline only: scripts/make_drill_deck.py calls this while building the deck and
ships the result as data (apps/web/src/data/drill-deck.json). Nothing here runs
in a request.

What this is, honestly. The solver outputs a mix of actions per hand, never a
reason. Every number in an explanation here is *computed* (equity against the
opponent's actual range, where the hand ranks within the player's range, how
often the whole range takes each action on this board, the pot-odds price when
facing a bet). The sentence tying those numbers to the action is the standard
poker rationale for that kind of hand (value bet, semi-bluff, pot control, ...),
applied by rules -- it describes the mix, it is not derived from it. Where the
solver is near-indifferent the text says so instead of inventing a reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from poker_solver.cards import card_rank, card_suit

_RANK_NAME = {
    14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten", 9: "nine",
    8: "eight", 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two",
}


def art(noun: str) -> str:
    """'flush draw' -> 'a flush draw', 'open-ended ...' -> 'an open-ended ...'."""
    return ("an " if noun[0] in "aeiou" else "a ") + noun


# --- the dealt hand ------------------------------------------------------


@dataclass(frozen=True)
class HandProfile:
    # A short noun phrase: "top pair", "overpair", "flush draw", "ace high".
    label: str
    # Coarse bucket the explanation rules key on:
    #   monster (two pair or better), pair_top (overpair / top pair),
    #   pair_mid (second pair / a pair under the board), pair_weak (bottom pair /
    #   board pair only), nothing.
    made: str
    draws: tuple[str, ...] = ()
    # Distinct card ranks that complete a straight, and cards to a flush, used to
    # say how many outs a draw has.
    draw_outs: int = 0
    overcards: int = 0
    notes: tuple[str, ...] = field(default_factory=tuple)


def _ranks(cards: tuple[int, ...]) -> list[int]:
    return [card_rank(c) for c in cards]


def _straight_outs(hole: tuple[int, int], board: tuple[int, ...]) -> tuple[bool, int]:
    """(already_has_straight, number of distinct out ranks) where the hole cards
    must take part in the straight."""
    have = set(_ranks(board)) | set(_ranks(hole))
    if 14 in have:
        have.add(1)
    hole_ranks = set(_ranks(hole)) | ({1} if 14 in _ranks(hole) else set())
    made = False
    outs: set[int] = set()
    for high in range(5, 15):
        window = set(range(high - 4, high + 1))
        missing = window - have
        uses_hole = bool(window & hole_ranks)
        if not uses_hole:
            continue
        if not missing:
            made = True
        elif len(missing) == 1:
            out = next(iter(missing))
            outs.add(14 if out == 1 else out)
    return made, len(outs)


def describe_hand(hole: tuple[int, int], board: tuple[int, ...]) -> HandProfile:
    """Classifies two hole cards against a three-card flop."""
    if len(board) != 3:
        raise ValueError("describe_hand classifies flop hands (3 board cards)")
    board_ranks = sorted(_ranks(board), reverse=True)
    hole_ranks = sorted(_ranks(hole), reverse=True)
    h1, h2 = hole_ranks
    top = board_ranks[0]
    all_ranks = board_ranks + hole_ranks
    counts = {r: all_ranks.count(r) for r in set(all_ranks)}
    board_paired = len(set(board_ranks)) < 3

    suits = [card_suit(c) for c in board + hole]
    flush_made = len(set(suits)) == 1
    hole_suits = [card_suit(c) for c in hole]
    made_straight, straight_outs = _straight_outs(hole, board)

    draws: list[str] = []
    outs = 0
    notes: list[str] = []

    # --- made hands ------------------------------------------------------
    if flush_made:
        return HandProfile("a flush", "monster")
    if made_straight:
        return HandProfile("a straight", "monster")
    quads_or_boat = sorted(counts.values(), reverse=True)
    if quads_or_boat[0] == 4:
        return HandProfile("four of a kind", "monster")
    if quads_or_boat[0] == 3 and quads_or_boat[1] >= 2:
        return HandProfile("a full house", "monster")
    if quads_or_boat[0] == 3:
        # Pocket pair hitting the board is a set; one hole card plus a paired
        # board is trips.
        label = "a set" if h1 == h2 else "trips"
        return HandProfile(label, "monster")

    pairs_with_board = [r for r in set(hole_ranks) if r in board_ranks]
    pocket_pair = h1 == h2
    if len(pairs_with_board) == 2 or (board_paired and (pairs_with_board or pocket_pair)):
        return HandProfile("two pair", "monster")

    # --- draws (for hands that are not already strong) -------------------
    for suit in set(hole_suits):
        total = suits.count(suit)
        in_hole = hole_suits.count(suit)
        if total == 4 and in_hole >= 1:
            nut = any(card_rank(c) == 14 and card_suit(c) == suit for c in hole)
            draws.append("nut flush draw" if nut else "flush draw")
            outs += 9
        elif total == 3 and in_hole == 2:
            draws.append("backdoor flush draw")
    if straight_outs >= 2:
        draws.append("open-ended straight draw")
        outs += 4 * straight_outs  # each out rank has 4 cards (minus any in hand/board; close enough)
    elif straight_outs == 1:
        draws.append("gutshot")
        outs += 4

    overcards = sum(1 for r in hole_ranks if r > top)

    # --- one pair --------------------------------------------------------
    if pocket_pair:
        if h1 > top:
            return HandProfile("an overpair", "pair_top", tuple(draws), outs, 0)
        below = sum(1 for r in board_ranks if r > h1)
        return HandProfile(
            "a pocket pair under the board" if below >= 2 else "a pocket pair just under the top card",
            "pair_mid",
            tuple(draws),
            outs,
            0,
        )
    if pairs_with_board:
        r = pairs_with_board[0]
        kicker = h2 if r == h1 else h1
        position = board_ranks.index(r)
        label = ("top pair", "second pair", "bottom pair")[position]
        if position == 0 and kicker >= 12:
            notes.append("a strong kicker")
        made = "pair_top" if position == 0 else "pair_mid" if position == 1 else "pair_weak"
        return HandProfile(label, made, tuple(draws), outs, 0, tuple(notes))

    # --- nothing made ----------------------------------------------------
    if board_paired:
        notes.append("the only pair is on the board")
    real_draws = [d for d in draws if "backdoor" not in d]
    label = art(real_draws[0]) if real_draws else f"{_RANK_NAME[h1]} high"
    return HandProfile(label, "nothing", tuple(draws), outs, overcards, tuple(notes))


# --- the board -----------------------------------------------------------


@dataclass(frozen=True)
class BoardTexture:
    label: str  # "dry king-high", "wet two-tone", "paired", "monotone"
    paired: bool
    suitedness: str  # "rainbow" | "two-tone" | "monotone"
    connected: bool
    high: int


def describe_board(board: tuple[int, ...]) -> BoardTexture:
    ranks = sorted(_ranks(board), reverse=True)
    paired = len(set(ranks)) < 3
    suit_counts = sorted((card_suit(c) for c in board))
    distinct_suits = len(set(suit_counts))
    suitedness = {1: "monotone", 2: "two-tone", 3: "rainbow"}[distinct_suits]
    distinct = sorted(set(ranks), reverse=True)
    connected = (distinct[0] - distinct[-1]) <= 4 and len(distinct) >= 3
    # A 3-gap board like Q-J-4 isn't connected, but Q-J-T / 9-8-7 are.
    wet = suitedness != "rainbow" or connected
    high = ranks[0]
    high_name = f"{_RANK_NAME[high]}-high"
    if suitedness == "monotone":
        label = f"monotone {high_name}"
    elif paired:
        label = f"paired {high_name}"
    elif wet:
        parts = []
        if connected:
            parts.append("connected")
        if suitedness == "two-tone":
            parts.append("two-tone")
        label = f"wet {high_name} ({', '.join(parts)})"
    else:
        label = f"dry {high_name}"
    return BoardTexture(label, paired, suitedness, connected, high)


# --- explanation -----------------------------------------------------------

BET_ACTIONS = ("bet_small", "bet_medium", "bet_large", "all_in")


def _classes(mix: dict[str, float], facing_bet: bool) -> dict[str, float]:
    aggressive = sum(mix.get(a, 0.0) for a in BET_ACTIONS)
    if facing_bet:
        return {"fold": mix.get("fold", 0.0), "call": mix.get("call", 0.0), "raise": aggressive}
    return {"check": mix.get("check", 0.0), "bet": aggressive}


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def _tier(equity: float) -> str:
    if equity >= 0.65:
        return "strong"
    if equity >= 0.52:
        return "good"
    if equity >= 0.42:
        return "medium"
    if equity >= 0.30:
        return "weak"
    return "air"


@dataclass(frozen=True)
class AnalysisInput:
    hero: str  # "BB" / "BTN"
    villain: str
    facing_bet: bool
    mix: dict[str, float]  # this hand's mix, by solver action label
    profile: HandProfile
    texture: BoardTexture
    equity: float  # this hand's equity vs the opponent's range, 0..1
    percentile: float  # share of hero's range this hand beats on equity, 0..1
    hero_range_equity: float
    range_mix: dict[str, float]  # the hero's whole range, by solver action label
    pot_bb: float
    bet_bb: float = 0.0


def explain(info: AnalysisInput) -> list[str]:
    """A few short bullets: the hand, the board/range, the reason, a caveat
    where the solver is close to indifferent. Plain text, no action sizes (the
    UI shows those in the player's chosen bb/% format)."""
    p = info.profile
    classes = _classes(info.mix, info.facing_bet)
    ranked = sorted(classes.items(), key=lambda kv: kv[1], reverse=True)
    top, top_p = ranked[0]
    second, second_p = ranked[1]
    range_classes = _classes(info.range_mix, info.facing_bet)
    tier = _tier(info.equity)
    has_draw = bool(p.draws) and any("backdoor" not in d for d in p.draws)

    bullets: list[str] = []

    # 1. The hand.
    extras = [d for d in p.draws if art(d) != p.label and "backdoor" not in d]
    backdoors = [d for d in p.draws if "backdoor" in d]
    hand_text = f"You have {p.label}"
    if extras:
        hand_text += f" with {art(extras[0])}"
    if backdoors:
        hand_text += f" and {art(backdoors[0])}"
    if p.notes and p.made != "nothing":
        hand_text += f" ({p.notes[0]})"
    if p.made == "nothing" and p.overcards == 2:
        hand_text += " (plus two overcards to the board)" if p.draws else " (two overcards to the board)"
    hand_text += (
        f" on a {info.texture.label} board: about {_pct(info.equity)} equity against "
        f"{info.villain}'s range, stronger than {_pct(info.percentile)} of the hands "
        f"{info.hero} can have here."
    )
    bullets.append(hand_text)

    # 2. The board and the whole range.
    if info.facing_bet:
        need = info.bet_bb / (info.pot_bb + 2 * info.bet_bb) if info.bet_bb else 0.0
        bullets.append(
            f"{info.villain} bet {_pct(info.bet_bb / info.pot_bb)} of the pot, so calling needs "
            f"about {_pct(need)} equity to break even. Across its whole range {info.hero} folds "
            f"{_pct(range_classes['fold'])}, calls {_pct(range_classes['call'])} and raises "
            f"{_pct(range_classes['raise'])}."
        )
    else:
        edge = info.hero_range_equity - (1 - info.hero_range_equity)
        stronger = (
            f"{info.hero}'s range is stronger here ({_pct(info.hero_range_equity)} equity)"
            if edge >= 0.03
            else f"{info.villain}'s range is stronger here ({_pct(1 - info.hero_range_equity)} equity)"
            if edge <= -0.03
            else "The two ranges are about even on this board"
        )
        bullets.append(
            f"{stronger}, and {info.hero} bets {_pct(range_classes['bet'])} of its range "
            f"and checks {_pct(range_classes['check'])}."
        )

    # 3. The reason, keyed on what the solver mostly does with this hand.
    close = top_p < 0.6 or top_p - second_p < 0.2
    bullets.append(_reason(info, top, tier, has_draw, close))

    # 4. A caveat when it's close.
    if close:
        names = {"check": "checking", "bet": "betting", "fold": "folding", "call": "calling", "raise": "raising"}
        lead = (
            "This is essentially a coin flip"
            if top_p - second_p < 0.05
            else "This one is close"
        )
        bullets.append(
            f"{lead}: the solver splits {names[top]} {_pct(top_p)} and "
            f"{names[second]} {_pct(second_p)} with this exact hand, so either is reasonable "
            f"and how often you do each matters more than any single choice."
        )
    return bullets


def _reason(info: AnalysisInput, top: str, tier: str, has_draw: bool, close: bool = False) -> str:
    text = _reason_text(info, top, tier, has_draw)
    if close:
        text = text.replace("is the main play", "is the slight favorite", 1)
    return text


def _reason_text(info: AnalysisInput, top: str, tier: str, has_draw: bool) -> str:
    p = info.profile
    outs = f" (about {p.draw_outs} outs)" if p.draw_outs else ""
    if info.facing_bet:
        need = info.bet_bb / (info.pot_bb + 2 * info.bet_bb) if info.bet_bb else 0.0
        if top == "call":
            if info.equity >= need:
                cheap = " The bet is small, which gives a good price, so even weak hands continue." if need <= 0.2 else ""
                return (
                    f"Calling is the main play because your {_pct(info.equity)} equity is above the "
                    f"{_pct(need)} the price demands.{cheap}"
                )
            return (
                f"Calling is the main play even though raw equity ({_pct(info.equity)}) is a bit "
                f"under the {_pct(need)} needed: hands like this keep enough equity and improve "
                f"often enough to continue."
            )
        if top == "fold":
            if info.equity < need:
                return (
                    f"Folding is the main play: {_pct(info.equity)} equity is below the {_pct(need)} "
                    f"needed to call, and this hand has little to gain from raising."
                )
            return (
                f"Folding is the main play even though raw equity ({_pct(info.equity)}) is just above the "
                f"{_pct(need)} needed: a hand like this rarely realizes all of that equity, and it has "
                f"little to gain from raising."
            )
        # raise
        if tier in ("strong", "good") and p.made in ("monster", "pair_top"):
            return "Raising is the main play: this is a value hand, and worse hands can still call."
        if has_draw:
            return f"Raising is the main play as a semi-bluff: if called it can still improve{outs}, and the raise can fold out better hands."
        return "Raising is the main play as a bluff: the hand can't win at showdown often, but it makes better hands fold."
    if top == "bet":
        if tier == "strong" or p.made == "monster":
            return "Betting is the main play for value: worse hands can still call, so a bet gets paid."
        if has_draw:
            return f"Betting is the main play as a semi-bluff: a bet can fold out better hands, and if called the draw can still improve{outs}."
        if p.made in ("pair_top", "pair_mid") and tier in ("good", "medium"):
            return "Betting is the main play for thin value and protection: worse pairs and draws can call, and a bet makes them pay to see a card."
        if p.made == "nothing":
            extra = ", and two overcards give it extra ways to win" if p.overcards == 2 else ""
            return f"Betting is the main play as a bluff: there is little showdown value, so the bet wins by folding out better hands{extra}."
        return "Betting is the main play: it applies pressure with a hand that is not strong enough to want to play a big pot but is better than much of what can call."
    # check
    if tier == "strong" or p.made == "monster":
        return "Checking is the main play even with a strong hand: this board is one where checking is common, and checking some strong hands keeps the check range protected and lets weaker hands keep calling or bluffing."
    if has_draw:
        return f"Checking is the main play: it takes a free card to improve{outs} without putting more money in against a range that has the stronger hands."
    if p.made in ("pair_top", "pair_mid", "pair_weak"):
        return "Checking is the main play for pot control: there is some showdown value to protect, but not enough to build the pot against better hands."
    return "Checking is the main play: there is not enough equity to bet for value, and the hand does not make a strong bluff, so it gives up cheaply."
