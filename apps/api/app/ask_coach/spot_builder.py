"""Turns `describe_spot`'s arguments into a schema Spot, computing the pot and
stacks itself rather than trusting the model's arithmetic (docs/coach.md §4.1).

The first half is a port of apps/web/src/lib/handBuilder.ts (computeStreetState,
summarizeHand): the same blinds, dead money and "raise to" semantics, so a spot
the Coach describes has the pot Solve would show for the same hand. They're
held together by shared fixtures, apps/web/src/lib/handBuilder.fixtures.json,
which tests/test_ask_coach_spot_builder.py and handBuilder.fixtures.test.ts
both check. Change one implementation, change the other and the fixtures.

The Spot is encoded the way Solve's click-through setup saves one
(useSolveSetup's setupAsSpot): positions [OOP, IP], effective_stack_bb the
starting stack, pot_bb the pot entering the current street, and every street's
actions with a bet or raise's size_bb the street total it raises to. So
"Open in Solve" (lib/solvePrefill.ts's seedFromSpot) replays the same hand.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from poker_solver_schema import BettingAction, Spot

SMALL_BLIND_BB = 0.5
BIG_BLIND_BB = 1.0
PREFLOP_ORDER = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]
POSTFLOP_ORDER = ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"]
STREET_ORDER = ["preflop", "flop", "turn", "river"]
SIX_MAX = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]


# --- the port of handBuilder.ts -------------------------------------------------------------


@dataclass
class Act:
    position: str
    action: str  # fold | check | call | bet | raise | all_in
    to_bb: float | None = None  # bet/raise: this player's street total once it lands


@dataclass
class StreetContext:
    oop: str
    ip: str
    pot_before_bb: float
    stack_before_bb: float
    first_to_act: str
    initial_contributed: dict[str, float] | None = None
    is_preflop: bool = False
    min_call_bb: float | None = None


@dataclass
class StreetState:
    to_act: str
    facing_bet: bool
    to_call_bb: float
    pot_now_bb: float
    remaining_bb: dict[str, float]
    is_terminal: bool
    folded: str | None
    pot_after_bb: float
    stack_after_bb: float
    highest_bb: float


@dataclass
class HandSummary:
    target_street: str
    pot_bb: float
    effective_stack_bb: float
    target_state: StreetState
    blocked_reason: str | None


def blind_for(position: str) -> float:
    return BIG_BLIND_BB if position == "BB" else SMALL_BLIND_BB if position == "SB" else 0.0


def assign_postflop_seats(a: str, b: str) -> tuple[str, str]:
    """(OOP, IP): who acts first after the flop."""
    return (a, b) if POSTFLOP_ORDER.index(a) <= POSTFLOP_ORDER.index(b) else (b, a)


def preflop_context(oop: str, ip: str, starting_stack_bb: float) -> StreetContext:
    dead = sum(blind_for(p) for p in ("SB", "BB") if p not in (oop, ip))
    first = oop if PREFLOP_ORDER.index(oop) <= PREFLOP_ORDER.index(ip) else ip
    return StreetContext(
        oop=oop,
        ip=ip,
        pot_before_bb=dead,
        stack_before_bb=starting_stack_bb,
        first_to_act=first,
        initial_contributed={oop: blind_for(oop), ip: blind_for(ip)},
        is_preflop=True,
        min_call_bb=BIG_BLIND_BB,
    )


def _other(ctx: StreetContext, p: str) -> str:
    return ctx.ip if p == ctx.oop else ctx.oop


def compute_street_state(ctx: StreetContext, actions: list[Act]) -> StreetState:
    init = ctx.initial_contributed or {}
    contributed = {ctx.oop: init.get(ctx.oop, 0.0), ctx.ip: init.get(ctx.ip, 0.0)}
    to_act = ctx.first_to_act
    folded: str | None = None
    last: str | None = None
    for entry in actions:
        if entry.action == "fold":
            folded = entry.position
        elif entry.action == "call":
            contributed[entry.position] = max(contributed[_other(ctx, entry.position)], ctx.min_call_bb or 0.0)
        elif entry.action == "all_in":
            contributed[entry.position] = ctx.stack_before_bb
        elif entry.action in ("bet", "raise"):
            contributed[entry.position] = entry.to_bb if entry.to_bb is not None else contributed[entry.position]
        last = entry.action
        to_act = _other(ctx, entry.position)

    completing_blind_call = (
        ctx.is_preflop
        and len(actions) == 1
        and actions[0].action == "call"
        and _other(ctx, actions[0].position) == "BB"
    )
    is_terminal = (
        folded is not None
        or (last == "call" and not completing_blind_call)
        or (last == "check" and len(actions) > 1)
    )
    highest = max(contributed[ctx.oop], contributed[ctx.ip], ctx.min_call_bb or 0.0)
    facing = contributed[to_act] < highest
    pot_now = ctx.pot_before_bb + contributed[ctx.oop] + contributed[ctx.ip]
    return StreetState(
        to_act=to_act,
        facing_bet=facing,
        to_call_bb=highest - contributed[to_act] if facing else 0.0,
        pot_now_bb=pot_now,
        remaining_bb={p: ctx.stack_before_bb - contributed[p] for p in (ctx.oop, ctx.ip)},
        is_terminal=is_terminal,
        folded=folded,
        pot_after_bb=pot_now,
        stack_after_bb=ctx.stack_before_bb - max(contributed[ctx.oop], contributed[ctx.ip]),
        highest_bb=highest,
    )


def street_context(street: str, oop: str, ip: str, pot_bb: float, stack_bb: float, starting_stack_bb: float):
    if street == "preflop":
        return preflop_context(oop, ip, starting_stack_bb)
    return StreetContext(oop=oop, ip=ip, pot_before_bb=pot_bb, stack_before_bb=stack_bb, first_to_act=oop)


def summarize_hand(
    oop: str, ip: str, starting_stack_bb: float, streets: dict[str, list[Act]], board_length: int
) -> HandSummary:
    requested = (
        "river" if board_length >= 5 else "turn" if board_length >= 4 else "flop" if board_length >= 3 else "preflop"
    )
    pot, stack = 0.0, starting_stack_bb
    blocked: str | None = None
    target, state = "preflop", None
    for street in STREET_ORDER:
        ctx = street_context(street, oop, ip, pot, stack, starting_stack_bb)
        state = compute_street_state(ctx, streets.get(street, []))
        target = street
        if street == requested:
            break
        if state.folded:
            blocked = f"The hand already ended: {state.folded} folded on the {street}."
            break
        if not state.is_terminal:
            blocked = f"Finish the {street}'s action before moving on."
            break
        pot, stack = state.pot_after_bb, state.stack_after_bb
    return HandSummary(target, pot, stack, state, blocked)


# --- describe_spot ---------------------------------------------------------------------------

CLOSED_LINES = ("open_call", "three_bet_call", "four_bet_call")
DECISION_LINES = ("unopened", "facing_open", "facing_three_bet")
DEFAULT_STACK_BB = 100.0
DEFAULT_OPEN_BB = 2.5
THREE_BET_MULTIPLE = 3.0
FOUR_BET_MULTIPLE = 2.2

_RANKS = "23456789TJQKA"
_CARD = re.compile(r"^(10|[2-9TJQKA])([shdc])$", re.IGNORECASE)
_LABEL = re.compile(r"^([2-9TJQKA])([2-9TJQKA])([so]?)$", re.IGNORECASE)

POSITION_WORDS = {
    "UTG": "UTG",
    "UTG1": "UTG+1",
    "LJ": "the lojack",
    "HJ": "the hijack",
    "CO": "the cutoff",
    "BTN": "the button",
    "SB": "the small blind",
    "BB": "the big blind",
}


@dataclass
class Described:
    """The result of describe_spot: a spot, or the problems to ask the user about."""

    problems: list[str] = field(default_factory=list)
    spot: Spot | None = None
    hero_position: str | None = None
    hero_hand: str | None = None
    to_act: str | None = None  # "hero" | "villain"
    facts: list[dict] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    summary: str = ""

    @property
    def ok(self) -> bool:
        return not self.problems and self.spot is not None


def normalize_card(raw: str) -> str | None:
    """"Qs", "qS", "10h" or "Q♠" -> "Qs"; None if it isn't a card."""
    text = str(raw).strip().replace(" ", "")
    for symbol, letter in _SUIT_SYMBOLS.items():
        text = text.replace(symbol, letter)
    m = _CARD.match(text)
    if not m:
        return None
    rank = "T" if m.group(1) == "10" else m.group(1).upper()
    return rank + m.group(2).lower()


def normalize_hand(raw: str) -> tuple[str | None, str | None]:
    """(hand, problem). A hand is two exact cards ("AhQd") or a 169-type label ("AQo", "AKs", "TT")."""
    text = re.sub(r"[\s,]+", "", str(raw)).replace("10", "T")
    if len(text) == 4:
        a, b = normalize_card(text[:2]), normalize_card(text[2:])
        if a and b:
            if a == b:
                return None, f"Your hand lists {a} twice."
            return a + b, None
    m = _LABEL.match(text)
    if m:
        hi, lo, kind = m.group(1).upper(), m.group(2).upper(), m.group(3).lower()
        if _RANKS.index(lo) > _RANKS.index(hi):
            hi, lo = lo, hi
        if hi == lo:
            return hi + lo, None
        if not kind:
            return None, f"Is your {hi}{lo} suited or offsuit?"
        return hi + lo + kind, None
    return None, f"I couldn't read your hand ({raw!r}). Which two cards?"


_SUIT_SYMBOLS = {"♠": "s", "♤": "s", "♥": "h", "♡": "h", "♦": "d", "♢": "d", "♣": "c", "♧": "c"}
_RANK_WORDS = {
    "ace": "A", "king": "K", "queen": "Q", "jack": "J", "ten": "T", "nine": "9", "eight": "8",
    "seven": "7", "six": "6", "five": "5", "four": "4", "three": "3", "two": "2", "deuce": "2",
}
_SUIT_WORDS = {"spade": "s", "spades": "s", "heart": "h", "hearts": "h", "diamond": "d", "diamonds": "d", "club": "c", "clubs": "c"}
# "Ah", "10s", "Q♦". A lowercase "a" isn't a rank ("as", "ah" are words), and a suit
# letter mustn't run on into a word ("Thanks" isn't Th).
_WRITTEN_CARD = re.compile(
    r"(?<![A-Za-z0-9])(10|[2-9TJQKAtjqk])(?:([shdcSHDC])(?![a-z])|\s?([♠♤♥♡♦♢♣♧]))"
)
# Cards written together ("AsAd", "Qs5c2c") are split apart first.
_RUN_TOGETHER = re.compile(r"(?<=[02-9TJQKA][shdc])(?=(?:10|[2-9TJQKA])[shdc])")
_WORD_CARD = re.compile(
    r"\b(" + "|".join(_RANK_WORDS) + r")s? of (" + "|".join(_SUIT_WORDS) + r")\b", re.IGNORECASE
)


def written_cards(texts: list[str]) -> set[str]:
    """Every exact card the user wrote, in any form: "Ah", "A♥", "ace of hearts"."""
    found: set[str] = set()
    for raw in texts:
        text = _RUN_TOGETHER.sub(" ", raw)
        for rank, letter, symbol in _WRITTEN_CARD.findall(text):
            card = normalize_card(rank + (letter or _SUIT_SYMBOLS.get(symbol, "")))
            if card:
                found.add(card)
        for rank_word, suit_word in _WORD_CARD.findall(text):
            found.add(_RANK_WORDS[rank_word.lower()] + _SUIT_WORDS[suit_word.lower()])
    return found


def keep_only_written_suits(hand: str | None, texts: list[str]) -> tuple[str | None, bool]:
    """The model may not invent suits for the user's hand: suits change the
    solver's answer (flush draws, blockers). Two exact cards are kept only if the
    user wrote both; otherwise the hand becomes its type ("As2s" -> "A2s",
    "AsAd" -> "AA"). Returns (hand, whether it was changed)."""
    if not hand or len(hand) != 4:
        return hand, False
    written = written_cards(texts)
    if hand[:2] in written and hand[2:] in written:
        return hand, False
    return hand_type(hand), True


def hand_type(combo: str) -> str:
    """"AhQd" -> "AQo", "As2s" -> "A2s", "AsAd" -> "AA"."""
    a, b = combo[:2], combo[2:]
    if _RANKS.index(b[0]) > _RANKS.index(a[0]):
        a, b = b, a
    if a[0] == b[0]:
        return a[0] + b[0]
    return a[0] + b[0] + ("s" if a[1] == b[1] else "o")


def hand_ranks(hand: str) -> str:
    """"AhQd" -> "AQ", "AQo" -> "AQ", "TT" -> "TT"."""
    return hand[0] + hand[2] if len(hand) == 4 else hand[:2]


def fmt_bb(x: float) -> str:
    return f"{round(x, 2):g}bb"


def _preflop_actions(line: str, hero: str, villain: str, sizes: dict) -> tuple[list[Act], list[str]]:
    """The preflop actions for a line, and any problems.

    In a finished heads-up line the opener is always the seat that acts first
    preflop: the other seat acts after it, so it can only call or re-raise. So
    who raised is worked out from the seats, never asked of the model (the
    eval showed it often left it out)."""
    first = hero if PREFLOP_ORDER.index(hero) < PREFLOP_ORDER.index(villain) else villain
    if line == "open_call":
        opener, acts = first, lambda o, d: [Act(o, "raise", sizes["open"]), Act(d, "call")]
    elif line == "three_bet_call":
        opener = first
        acts = lambda o, d: [Act(o, "raise", sizes["open"]), Act(d, "raise", sizes["three"]), Act(o, "call")]
    elif line == "four_bet_call":
        opener = first
        acts = lambda o, d: [
            Act(o, "raise", sizes["open"]),
            Act(d, "raise", sizes["three"]),
            Act(o, "raise", sizes["four"]),
            Act(d, "call"),
        ]
    elif line == "facing_open":
        opener, acts = villain, lambda o, d: [Act(o, "raise", sizes["open"])]
    elif line == "facing_three_bet":
        opener, acts = hero, lambda o, d: [Act(o, "raise", sizes["open"]), Act(d, "raise", sizes["three"])]
    else:  # unopened
        return [], []
    defender = villain if opener == hero else hero
    if PREFLOP_ORDER.index(opener) > PREFLOP_ORDER.index(defender):
        return [], [f"{defender} acts before {opener} preflop, so {opener} can't have opened against {defender}."]
    return acts(opener, defender), []


def _order_checked_through_streets(actions: list, hero: str, oop: str) -> list:
    """A street that is exactly two checks, listed in-position player first,
    is put in the right order: check-check is the same either way, and the
    model often lists the user's check first. Any other order mistake is left
    for the legality check to ask about."""
    oop_actor = "hero" if hero == oop else "villain"
    out = list(actions)
    for street in ("flop", "turn", "river"):
        idx = [i for i, a in enumerate(out) if isinstance(a, dict) and a.get("street") == street]
        if len(idx) == 2 and all(out[i].get("action") == "check" for i in idx) and out[idx[0]].get("actor") != oop_actor:
            out[idx[0]], out[idx[1]] = out[idx[1]], out[idx[0]]
    return out


def _verb(a: Act) -> str:
    return {
        "check": "checked",
        "call": "called",
        "fold": "folded",
        "all_in": "went all-in",
        "bet": f"bet {fmt_bb(a.to_bb or 0)}",
        "raise": f"raised to {fmt_bb(a.to_bb or 0)}",
    }[a.action]


def describe(args: dict) -> Described:
    """Validates describe_spot's arguments and builds the Spot. Never raises on bad
    input; everything wrong comes back as problems for the model to ask about."""
    out = Described()
    problems = out.problems
    assumptions = [str(a).strip() for a in (args.get("assumptions") or []) if str(a).strip()]

    hero = str(args.get("hero_position") or "").upper()
    villain = str(args.get("villain_position") or "").upper()
    # The model sometimes sends a string where an object belongs; that's a
    # question for the user, never a crash.
    preflop = args.get("preflop") if isinstance(args.get("preflop"), dict) else {}
    line = str(preflop.get("line") or "")
    if line not in CLOSED_LINES + DECISION_LINES:
        problems.append("How did the preflop action go (who raised, who called)?")
    if hero not in SIX_MAX:
        problems.append("Which position are you in?")
    if line == "unopened" and not villain:
        villain = "BB" if hero != "BB" else ""
        if villain:
            assumptions.append("the big blind is the player left to act")
    if villain not in SIX_MAX:
        problems.append("Which position is your opponent in?")
    elif hero == villain:
        problems.append("You and your opponent can't be in the same position. Which seat is each of you in?")
    if line == "unopened" and hero == "BB":
        problems.append("The big blind is never first in. Which position are you in?")

    stack = args.get("effective_stack_bb")
    if stack is None:
        stack = DEFAULT_STACK_BB
        assumptions.append("100bb stacks")
    try:
        stack = float(stack)
    except (TypeError, ValueError):
        problems.append("How deep are the stacks, in big blinds?")
        stack = DEFAULT_STACK_BB
    if not (2 <= stack <= 1000):
        problems.append("Stacks need to be between 2bb and 1000bb. How deep are they?")

    hero_hand = None
    if args.get("hero_hand"):
        hero_hand, problem = normalize_hand(args["hero_hand"])
        if problem:
            problems.append(problem)

    board: list[str] = []
    for raw in args.get("board") or []:
        card = normalize_card(raw)
        if card is None:
            problems.append(f"I couldn't read the board card {raw!r}.")
        else:
            board.append(card)
    if len(board) not in (0, 3, 4, 5):
        problems.append("The board should have 3 cards (flop), 4 (turn) or 5 (river).")
    seen = list(board) + ([hero_hand[:2], hero_hand[2:]] if hero_hand and len(hero_hand) == 4 else [])
    dupes = sorted({c for c in seen if seen.count(c) > 1})
    if dupes:
        problems.append(f"{', '.join(dupes)} appears twice between your hand and the board.")

    sizes: dict[str, float] = {}
    try:
        if line != "unopened":
            sizes["open"] = float(preflop.get("open_size_bb") or 0) or DEFAULT_OPEN_BB
            if not preflop.get("open_size_bb"):
                assumptions.append(f"a {fmt_bb(sizes['open'])} open")
        if line in ("three_bet_call", "four_bet_call", "facing_three_bet"):
            sizes["three"] = float(preflop.get("three_bet_size_bb") or 0) or round(sizes["open"] * THREE_BET_MULTIPLE * 2) / 2
            if not preflop.get("three_bet_size_bb"):
                assumptions.append(f"a {fmt_bb(sizes['three'])} 3-bet")
        if line == "four_bet_call":
            sizes["four"] = float(preflop.get("four_bet_size_bb") or 0) or round(sizes["three"] * FOUR_BET_MULTIPLE * 2) / 2
            if not preflop.get("four_bet_size_bb"):
                assumptions.append(f"a {fmt_bb(sizes['four'])} 4-bet")
    except (TypeError, ValueError):
        problems.append("I couldn't read the preflop raise sizes. What did each raise go to, in big blinds?")
        sizes = {}
    ladder = [sizes[k] for k in ("open", "three", "four") if k in sizes]
    if ladder and (ladder[0] <= BIG_BLIND_BB or any(b <= a for a, b in zip(ladder, ladder[1:])) or ladder[-1] >= stack):
        problems.append("Those preflop raise sizes don't add up. What did each raise go to, in big blinds?")

    if problems:
        out.assumptions = _unique(assumptions)
        return out

    oop, ip = assign_postflop_seats(hero, villain)
    preflop_acts, line_problems = _preflop_actions(line, hero, villain, sizes)
    problems += line_problems
    if line == "unopened" and PREFLOP_ORDER.index(villain) < PREFLOP_ORDER.index(hero):
        problems.append(f"{villain} acts before you preflop, so the pot isn't unopened when it's your turn. Did {villain} fold or raise?")

    streets: dict[str, list[Act]] = {"preflop": preflop_acts, "flop": [], "turn": [], "river": []}
    postflop = _order_checked_through_streets(list(args.get("postflop_actions") or []), hero, oop)
    if postflop and line in DECISION_LINES:
        problems.append("The preflop action wasn't finished, so there can't be action after the flop. What happened preflop?")
    last_street_index = 0
    for raw in postflop:
        if not isinstance(raw, dict):
            problems.append("I couldn't read the action after the flop. What happened, in order?")
            break
        street = str(raw.get("street") or "")
        if street not in STREET_ORDER[1:]:
            problems.append(f"I couldn't tell which street an action was on ({street!r}).")
            break
        index = STREET_ORDER.index(street)
        if index < last_street_index:
            problems.append("The actions are out of order (a later street came before an earlier one).")
            break
        last_street_index = index
        needed = {"flop": 3, "turn": 4, "river": 5}[street]
        if len(board) < needed:
            problems.append(f"There's action on the {street}, but I don't have the {street} card yet. What was it?")
            break
        position = hero if raw.get("actor") == "hero" else villain if raw.get("actor") == "villain" else None
        action = str(raw.get("action") or "")
        if position is None or action not in ("check", "bet", "call", "raise", "fold", "all_in"):
            problems.append(f"I couldn't read one of the {street} actions.")
            break
        amount = raw.get("amount_bb")
        problem = _check_action(streets, street, oop, ip, stack, Act(position, action), amount)
        if problem:
            problems.append(problem)
            break
        streets[street].append(Act(position, action, float(amount) if action in ("bet", "raise") else None))

    if problems:
        out.assumptions = _unique(assumptions)
        return out

    summary = summarize_hand(oop, ip, stack, streets, len(board))
    state = summary.target_state
    street = summary.target_street
    if summary.blocked_reason:
        problems.append(summary.blocked_reason)
    elif state.folded:
        problems.append(f"{state.folded} folded, so the hand is over. Which decision do you want to look at?")
    elif state.is_terminal:
        if street == "river":
            problems.append("The river action is finished, so there's no decision left. Which decision do you want to look at?")
        elif street == "preflop" and not board:
            problems.append("What was the flop?")
        else:
            nxt = STREET_ORDER[STREET_ORDER.index(street) + 1]
            problems.append(f"The {street} action is finished. What was the {nxt} card?")
    if problems:
        out.assumptions = _unique(assumptions)
        return out

    actions = [
        BettingAction(position=a.position, street=st, action=a.action, size_bb=a.to_bb)
        for st in STREET_ORDER
        for a in streets[st]
    ]
    out.spot = Spot(
        positions_in_hand=[oop, ip],
        effective_stack_bb=stack,
        pot_bb=summary.pot_bb,
        board=board,
        current_street=street,
        actions=actions,
    )
    out.hero_position = hero
    out.hero_hand = hero_hand
    out.to_act = "hero" if state.to_act == hero else "villain"
    out.assumptions = _unique(assumptions)
    out.facts = _facts(hero, villain, oop, street, streets[street], state)
    out.summary = _summary(out, villain, line, state)
    return out


def from_attached(spot: Spot, args: dict) -> Described:
    """A spot the frontend parsed from a pasted hand history (parseHandHistory.ts's
    parseHandHistoryToPostflopSetup), used as it is instead of the model's reading
    of the text (§4.1). Its pot and stack are the ones entering the current street
    and its actions are that street's, so only the user's seat and cards come from
    the model."""
    out = Described()
    seats = [p.value for p in spot.positions_in_hand]
    hero = str(args.get("hero_position") or "").upper()
    if len(seats) != 2 or seats[0] == seats[1]:
        out.problems.append("The hand history needs exactly two players left in the hand.")
        return out
    if hero not in seats:
        out.problems.append(f"Which player were you in that hand, {seats[0]} or {seats[1]}?")
        return out
    if len(spot.board) < 3:
        out.problems.append("The hand history stops before the flop. Which decision do you want to look at?")
        return out
    if args.get("hero_hand"):
        out.hero_hand, problem = normalize_hand(args["hero_hand"])
        if problem:
            out.problems.append(problem)
            return out
        if out.hero_hand and len(out.hero_hand) == 4 and {out.hero_hand[:2], out.hero_hand[2:]} & set(spot.board):
            out.problems.append("One of your cards is also on the board. Which two cards did you have?")
            return out
    oop, ip = seats
    street = spot.current_street.value
    acts = [
        Act(a.position.value, a.action.value, a.size_bb)
        for a in spot.actions
        if a.street.value == street
    ]
    ctx = StreetContext(
        oop=oop, ip=ip, pot_before_bb=spot.pot_bb or 0.0, stack_before_bb=spot.effective_stack_bb, first_to_act=oop
    )
    state = compute_street_state(ctx, acts)
    if state.is_terminal:
        out.problems.append(f"The {street} action in that hand is already over. Which decision do you want to look at?")
        return out
    villain = ip if hero == oop else oop
    out.spot = spot
    out.hero_position = hero
    out.to_act = "hero" if state.to_act == hero else "villain"
    out.assumptions = _unique([str(a) for a in args.get("assumptions") or []] + ["read from your hand history"])
    out.facts = _facts(hero, villain, oop, street, acts, state)
    out.summary = _summary(out, villain, "hand_history", state)
    return out


def _check_action(streets, street, oop, ip, starting_stack, act: Act, amount) -> str | None:
    """Whether `act` can come next on `street`, in plain words if not."""
    pot, stack = 0.0, starting_stack
    for st in STREET_ORDER:
        state = compute_street_state(street_context(st, oop, ip, pot, stack, starting_stack), streets[st])
        if st == street:
            break
        if not state.is_terminal or state.folded:
            return f"The {st}'s action has to finish before there's action on the {street}."
        pot, stack = state.pot_after_bb, state.stack_after_bb
    who = act.position
    if state.is_terminal:
        return f"The {street}'s action was already over before {who} {act.action}."
    if state.to_act != who:
        return f"On the {street}, it was {state.to_act}'s turn to act, not {who}'s. What happened, in order?"
    if act.action == "check" and state.facing_bet:
        return f"{who} can't check facing a bet on the {street}. Did they call, raise or fold?"
    if act.action in ("call", "fold") and not state.facing_bet:
        return f"{who} wasn't facing a bet on the {street}, so they couldn't {act.action}. Did they check?"
    if act.action == "bet" and state.highest_bb > 0:
        return f"There was already a bet on the {street}, so {who} raised rather than bet. To how much?"
    if act.action == "raise" and not state.facing_bet:
        return f"Nobody had bet on the {street} yet, so {who} bet rather than raised. How much?"
    if act.action in ("bet", "raise"):
        try:
            to = float(amount)
        except (TypeError, ValueError):
            return f"How much did {who} {act.action} on the {street}, in big blinds?"
        if to <= state.highest_bb:
            return f"A raise has to go to more than {fmt_bb(state.highest_bb)} on the {street}. What did {who} raise to?"
        if to >= stack:  # the stack this street started with
            return f"{who} doesn't have {fmt_bb(to)} left on the {street}. Was it all-in?"
    return None


def _facts(hero, villain, oop, street, acts: list[Act], state: StreetState) -> list[dict]:
    if street == "preflop":
        you = hero
    else:
        you = f"{hero} ({'acts first' if hero == oop else 'acts last'})"
    villain_acts = [a for a in acts if a.position == villain]
    opponent = f"{villain} ({_verb(villain_acts[-1])})" if villain_acts else villain
    facts = [
        {"k": "You", "v": you},
        {"k": "Opponent", "v": opponent},
        {"k": "Pot", "v": fmt_bb(state.pot_now_bb)},
        {"k": "Stacks", "v": fmt_bb(min(state.remaining_bb.values()))},
    ]
    if state.facing_bet:
        facts.append({"k": "To call", "v": fmt_bb(state.to_call_bb)})
    return facts


_LINE_WORDS = {
    "open_call": "single-raised pot",
    "three_bet_call": "3-bet pot",
    "four_bet_call": "4-bet pot",
    "unopened": "folded to you preflop",
    "facing_open": "facing an open preflop",
    "facing_three_bet": "facing a 3-bet preflop",
    "hand_history": "from your hand history",
}


def _summary(d: Described, villain: str, line: str, state: StreetState) -> str:
    spot = d.spot
    hand = f", {d.hero_hand}" if d.hero_hand else ""
    board = f", {spot.current_street.value} {' '.join(spot.board)}" if spot.board else ""
    acts = [a for a in spot.actions if a.street == spot.current_street]
    action = "; " + ", ".join(f"{a.position} {_verb(Act(a.position, a.action.value, a.size_bb))}" for a in acts) if acts and spot.board else ""
    to_act = "you" if d.to_act == "hero" else villain
    return (
        f"You ({d.hero_position}{hand}) vs {villain}, {_LINE_WORDS[line]}{board}, "
        f"pot {fmt_bb(state.pot_now_bb)}, {fmt_bb(min(state.remaining_bb.values()))} behind{action}; {to_act} to act."
    )


def _unique(items: list[str]) -> list[str]:
    """Drops repeats, including ones worded slightly differently: the model's
    "2.5bb open" and the backend's "a 2.5bb open" are the same assumption."""
    seen, out = set(), []
    for item in items:
        key = _assumption_key(item)
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _assumption_key(text: str) -> str:
    words = re.sub(r"[^a-z0-9.+ ]", " ", text.lower()).split()
    while words and words[0] in ("a", "an", "the", "standard"):
        words = words[1:]
    return " ".join(w.rstrip(".") for w in words)


def title_for(hero_position: str | None, hero_hand: str | None, villain: str | None, board: list[str]) -> str:
    """A conversation's title from its first spot: "AQ on the button, Q-5-2 flop"."""
    who = POSITION_WORDS.get(hero_position or "", hero_position or "")
    head = f"{hand_ranks(hero_hand)} on {who}" if hero_hand else f"{hero_position} vs {villain}"
    if not board:
        return f"{head}, preflop"
    street = {3: "flop", 4: "turn", 5: "river"}.get(len(board), "board")
    return f"{head}, {'-'.join(c[0] for c in board)} {street}"
