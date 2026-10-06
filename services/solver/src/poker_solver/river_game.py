"""The river-only action abstraction: legal actions, state transitions,
terminal detection, and payoff arithmetic for a single street of heads-up
betting on an already-fixed board. Pure game mechanics -- no CFR, no hand
evaluation (callers supply each player's precomputed showdown strength).

Locked scope (docs/plan.md): fixed bet-size menu (check / 33% / 66% / 100%
pot / all-in), heads-up, symmetric effective stacks.
"""

from __future__ import annotations

from dataclasses import dataclass

_EPS = 1e-9

BET_SIZE_MENU: tuple[tuple[float, str], ...] = ((0.33, "b33"), (0.66, "b66"), (1.0, "b100"))
_SIZE_BY_LABEL = {label: frac for frac, label in BET_SIZE_MENU}

# Bet + 2 raises before only fold/call/all_in remain. Tunable -- keeps the
# tree finite; not derived from theory.
MAX_AGGRESSIVE_ACTIONS = 3

AGGRESSIVE_LABELS = frozenset({label for _, label in BET_SIZE_MENU} | {"all_in"})


@dataclass(frozen=True)
class RiverState:
    pot_bb: float  # dead money from earlier streets
    stack_bb: float  # each player's starting stack for this street
    contributed: tuple[float, float]  # each player's money put in *this* street
    to_act: int
    history: tuple[str, ...]
    num_aggressive_actions: int

    @classmethod
    def initial(
        cls,
        pot_bb: float,
        stack_bb: float,
        first_to_act: int = 0,
        prior_history: tuple[str, ...] = (),
    ) -> RiverState:
        """prior_history seeds an already-taken action (e.g. an OOP check
        before the solve's subgame starts) without it counting toward this
        street's raise cap. Assumes prior_history contains no bet/raise --
        this engine only ever seeds a leading check with it."""
        return cls(
            pot_bb=pot_bb,
            stack_bb=stack_bb,
            contributed=(0.0, 0.0),
            to_act=first_to_act,
            history=tuple(prior_history),
            num_aggressive_actions=0,
        )

    def _facing_bet(self) -> bool:
        return bool(self.history) and self.history[-1] in AGGRESSIVE_LABELS

    def legal_actions(self) -> tuple[str, ...]:
        if self.is_terminal():
            return ()

        facing_bet = self._facing_bet()
        remaining = self.stack_bb - self.contributed[self.to_act]
        current_pot = self.pot_bb + self.contributed[0] + self.contributed[1]
        base = ("fold", "call") if facing_bet else ("check",)

        if facing_bet:
            to_call = self.contributed[1 - self.to_act] - self.contributed[self.to_act]
        else:
            to_call = 0.0
        raise_room = remaining - to_call

        if raise_room <= _EPS:
            return base  # no chips left to bet/raise with

        if self.num_aggressive_actions >= MAX_AGGRESSIVE_ACTIONS:
            # Cap reached: no more sized raises, but shoving is always legal.
            return base + ("all_in",)

        sized: list[str] = []
        for frac, label in BET_SIZE_MENU:
            amount = to_call + frac * (current_pot + to_call) if facing_bet else frac * current_pot
            sized.append("all_in" if amount >= remaining - _EPS else label)
        sized.append("all_in")

        # Dedupe while preserving order -- a size that collapsed to "all_in"
        # shouldn't appear twice alongside the explicit "all_in" entry.
        return base + tuple(dict.fromkeys(sized))

    def apply(self, action: str) -> RiverState:
        to_act, other = self.to_act, 1 - self.to_act
        contributed = list(self.contributed)
        num_aggressive = self.num_aggressive_actions

        if action in ("check", "fold"):
            pass
        elif action == "call":
            contributed[to_act] += contributed[other] - contributed[to_act]
        else:
            remaining = self.stack_bb - contributed[to_act]
            if action == "all_in":
                contributed[to_act] += remaining
            else:
                frac = _SIZE_BY_LABEL[action]
                current_pot = self.pot_bb + contributed[0] + contributed[1]
                if self._facing_bet():
                    to_call = contributed[other] - contributed[to_act]
                    amount = to_call + frac * (current_pot + to_call)
                else:
                    amount = frac * current_pot
                contributed[to_act] += min(amount, remaining)
            num_aggressive += 1

        return RiverState(
            pot_bb=self.pot_bb,
            stack_bb=self.stack_bb,
            contributed=(contributed[0], contributed[1]),
            to_act=other,
            history=(*self.history, action),
            num_aggressive_actions=num_aggressive,
        )

    def is_terminal(self) -> bool:
        if not self.history:
            return False
        if self.history[-1] in ("fold", "call"):
            return True
        return len(self.history) >= 2 and self.history[-2:] == ("check", "check")

    def terminal_utility(
        self, strength0: object, strength1: object
    ) -> tuple[float, float]:
        """Only call on a terminal state. strength0/strength1 (each hand's
        evaluator.evaluate_best result) are only read on a showdown, not a
        fold -- pass anything comparable there if the terminal is a fold.

        One general formula for every terminal, fold included: the winner's
        share is the WHOLE pot (total_pot, which already includes pot_bb,
        the dead money from earlier streets) -- not just what the loser put
        in this street. Shortcutting the fold case to "winner gets only the
        folder's street contribution" is a tempting-looking bug: it still
        runs, but makes bluffing strictly dominated (a successful bluff
        would net 0 instead of the dead pot), silently collapsing the
        subgame to degenerate check/fold. See test_river_game.py's fold
        payoff test and river_mccfr.py's closed-form regression test, which
        exist specifically to catch this class of mistake.
        """
        total_pot = self.pot_bb + self.contributed[0] + self.contributed[1]
        if self.history[-1] == "fold":
            # apply() already flipped to_act to the non-folder.
            winner = self.to_act
            share = [0.0, 0.0]
            share[winner] = total_pot
        elif strength0 > strength1:  # type: ignore[operator]
            share = [total_pot, 0.0]
        elif strength1 > strength0:  # type: ignore[operator]
            share = [0.0, total_pot]
        else:
            share = [total_pot / 2, total_pot / 2]
        return (share[0] - self.contributed[0], share[1] - self.contributed[1])
