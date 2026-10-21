"""Range-vs-range Discounted CFR for one postflop street -- the replacement for
postflop_mccfr.py's Monte-Carlo trainer.

Why it exists (docs/decisions.md, 2026-10-07): postflop_mccfr.py samples
one hole-card combo per player per iteration, so with realistic ~500-combo
ranges each combo is only visited on the rare iterations chance picks it.
At the production setting of 4,000 iterations that left strategies mostly
noise -- e.g. K6s jamming 96bb into a 4bb pot 8% of the time when the
converged answer is ~0%, and still visibly drifting after 200,000
iterations. This trainer never samples hole cards: every combo in both
ranges gets a strategy at every node on every iteration, weighted by how
likely it is to have reached that node, with equity against the whole
opposing range taken from an exact precomputed matrix (equity.py). That's
the standard approach every serious open-source solver takes.

Update rule is Discounted CFR (Brown & Sandholm, "Solving Imperfect-
Information Games via Discounted Regret Minimization") and alternating
player updates. CFR+ was implemented first and measured head to head on
the wide-range regression scenario below: DCFR reached 1.1% of the pot in
exploitability at 100 iterations (CFR+: 2.4%) and 0.35% at 200 (CFR+:
1.2%) -- roughly 2-3x fewer iterations for the same precision, for a few
extra lines. The discount parameters are alpha=1.5, beta=0.5, gamma=3
(the paper recommends 1.5 / 0 / 2; postflop-solver uses gamma=3): swept
on eight spots (benchmarks/sweep_dcfr.py), that setting reached the same
precision in up to a third of the iterations on wide flops -- the slow
case -- and was level elsewhere. See docs/decisions.md, 2026-10-21.

Game model is unchanged from postflop_mccfr.py: betting_round.py's state
machine for one street, then -- if nobody folds -- the rest of the board
runs out with no further betting and the hand goes to showdown. The
equity matrix encodes exactly that.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from .betting_round import DEFAULT_BET_MENU, BetMenu, BettingRoundState
from .combos import Combo, combo_key, expand_range, label_to_combos
from .cards import card_str
from .equity import _compute_equity_matrix, collision_mask, compute_equity_matrix

# What the per-river-card showdown matrices are stored as. float32 halves the
# memory traffic of the hot product (and there can be 48 of them); the tests
# switch it to float64 to compare algorithms without rounding in the way.
_RIVER_MATRIX_DTYPE = np.float32

# How the chance probability of a river card is applied. "own": a hand's river
# value is an average over the cards IT can see (self-normalized per hand). "global":
# one constant weight per card, the same for every hand.
_CHANCE_NORMALIZATION = "own"

# DCFR discount parameters (see the module docstring for why these differ from
# Brown & Sandholm's recommended 1.5 / 0 / 2).
_DCFR_ALPHA = 1.5
_DCFR_BETA = 0.5
_DCFR_GAMMA = 3.0

# posterior_ranges collapses a label's combos back into one label weight when
# they all agree to within this FRACTION of the label's heaviest combo. Relative,
# not absolute: a narrowed range isn't normalized (a rarely taken line scales
# every weight down, to ~1e-4), and an absolute tolerance would call every
# combo of such a line "equal" and throw away the suit differences it exists
# to keep.
_COLLAPSE_TOLERANCE = 1e-3


# The river menu a joint turn+river solve uses unless told otherwise: one size, and
# once it is bet only fold / call / all-in remain. The river tree is replicated for
# every river card under every way the turn can close, so its size multiplies the whole
# solve; this keeps the default affordable (a second sized raise roughly doubles it --
# see docs/decisions.md).
DEFAULT_RIVER_MENU = BetMenu(sizes=(0.75,), max_aggressive_actions=1)


@dataclass(frozen=True)
class RiverSpec:
    """Solve the river too, in the same game as the turn (a "joint" solve).

    Without it, a turn solve ends where the turn's betting ends: "the river card
    comes, nobody bets, showdown". With it, a turn line that closes without a
    fold leads to a chance node -- the river card -- and then the river's own
    betting, each river card with its own strategies, so the turn strategy is
    worked out knowing what the river will be played like.

    `bet_menu` is the river's menu (None: no river betting, just the river card
    and a showdown -- the cheapest way to get exact river equity into the turn
    strategy). `cards` is how many river cards to enumerate: None means every card
    that can come (44-48), which is exact; a smaller number is an approximation that
    stands in for the rest (select_river_cards), because the tree grows with it."""

    bet_menu: BetMenu | None = DEFAULT_RIVER_MENU
    cards: int | None = None


def select_river_cards(board: tuple[int, ...], count: int) -> tuple[int, ...]:
    """`count` river cards to enumerate in place of all of them: every live card
    if `count` covers them all, otherwise evenly spaced along the live cards
    ordered by rank, with the suit order rotated from rank to rank so ranks AND
    suits are spread (a river that pairs the board, completes a flush or a
    straight is a different spot, and a sample that skipped a whole suit would
    never see the flush come in). Deterministic: the same spot always uses the
    same cards."""
    live = [c for c in range(52) if c not in set(board)]
    if count >= len(live):
        return tuple(live)
    if count < 1:
        raise ValueError("a joint solve needs at least one river card")
    ordered = sorted(live, key=lambda c: (-(c // 4), (c % 4 + c // 4) % 4))
    picks = np.unique(np.round(np.linspace(0, len(ordered) - 1, count)).astype(int))
    return tuple(sorted(ordered[i] for i in picks))


@dataclass
class RangeSpotConfig:
    """Same shape as postflop_mccfr.PostflopSpotConfig, so apps/api's call
    site barely changes. first_to_act is whoever acts once prior_history
    has played out (see BettingRoundState.initial)."""

    board: tuple[int, ...]  # 3 (flop), 4 (turn), or 5 (river) cards
    pot_bb: float
    effective_stack_bb: float
    range0: dict[str, float]
    range1: dict[str, float]
    first_to_act: int = 0
    prior_history: tuple[str, ...] = ()
    # What a bet or raise can be on this street (betting_round.BetMenu); the
    # default is the fixed 25 / 75 / 125 / all-in menu.
    bet_menu: BetMenu = DEFAULT_BET_MENU
    # Solve the river as well (turn boards only); see RiverSpec.
    river: RiverSpec | None = None

    def __post_init__(self) -> None:
        if len(self.board) not in (3, 4, 5):
            raise ValueError(
                f"board must be 3 (flop), 4 (turn), or 5 (river) cards, got {len(self.board)}"
            )
        if self.river is not None and len(self.board) != 4:
            raise ValueError(
                "a joint solve adds the river to a TURN solve: the board needs 4 cards, "
                f"got {len(self.board)}"
            )


@dataclass(frozen=True)
class JointSize:
    """How big a joint solve's game is, counted without building it."""

    cards: int  # river cards enumerated
    chance_nodes: int  # turn lines that close and deal a river card
    decisions: int  # decision nodes, both streets, every river card
    actions: int  # (node, action) rows -- what regrets and strategies are stored per combo for
    terminals: int
    bytes: int  # a conservative estimate of the memory the solve holds


def _count_betting(state: BettingRoundState) -> tuple[int, int, int]:
    """(decision nodes, actions, terminals) in the betting tree under `state`."""
    if state.is_terminal():
        return 0, 0, 1
    decisions, actions, terminals = 1, 0, 0
    for action in state.legal_actions():
        d, a, t = _count_betting(state.apply(action))
        decisions, actions, terminals = decisions + d, actions + a + 1, terminals + t
    return decisions, actions, terminals


def estimate_joint_size(config: RangeSpotConfig) -> JointSize:
    """Counts a joint solve's tree (exactly: each closing turn line's river
    betting is sized from ITS pot and stacks, since a size that no longer fits
    collapses to all-in) and estimates the memory it needs, so a request that
    would not fit can be refused before anything is allocated."""
    river = config.river
    if river is None:
        raise ValueError("estimate_joint_size needs a config with a river")
    blocked = frozenset(config.board)
    n0 = len(_expand(config.range0, blocked)[0])
    n1 = len(_expand(config.range1, blocked)[0])
    live = 52 - len(config.board)
    cards = live if river.cards is None else min(river.cards, live)

    root = BettingRoundState.initial(
        config.pot_bb, config.effective_stack_bb, config.first_to_act, config.prior_history, config.bet_menu
    )
    decisions = actions = terminals = chances = 0

    def walk(state: BettingRoundState) -> None:
        nonlocal decisions, actions, terminals, chances
        if state.is_terminal():
            if state.history and state.history[-1] == "fold":
                terminals += 1
                return
            chances += 1
            pot = state.pot_bb + state.contributed[0] + state.contributed[1]
            remaining = state.stack_bb - state.contributed[0]
            if river.bet_menu is None or remaining <= 1e-9:
                terminals += cards
                return
            d, a, t = _count_betting(BettingRoundState.initial(pot, remaining, 0, (), river.bet_menu))
            decisions, actions, terminals = decisions + cards * d, actions + cards * a, terminals + cards * t
            return
        decisions += 1
        for action in state.legal_actions():
            actions += 1
            walk(state.apply(action))

    walk(root)
    nodes = decisions + terminals + chances
    mean_combos = (n0 + n1) / 2
    # Regrets, strategy sums, current strategies and the scratch action values
    # (4 per action row); each player's value array and the two reach arrays
    # (about 2 + 2 per node); plus one float32 equity matrix per river card. The
    # 1.8 covers the temporaries a pass makes (measured against tracemalloc).
    modelled = 8 * mean_combos * (4 * actions + 2 * nodes + 2 * decisions) + cards * n0 * n1 * 4
    return JointSize(cards, chances, decisions, actions, terminals, int(1.8 * modelled))


def _expand(range_weights: dict[str, float], blocked: frozenset[int]) -> tuple[list[Combo], np.ndarray, list[str]]:
    """Like combos.expand_range_to_combos, but also keeps each combo's
    169-type label so strategies can be rolled back up per label. Handles
    specific-combo keys ('AhKh') as well as labels (combos.expand_range)."""
    expanded = expand_range(range_weights, blocked)
    if not expanded:
        raise ValueError("range has no combos left after removing blocked cards")
    combos, weights, labels = (list(column) for column in zip(*expanded))
    return combos, np.array(weights, dtype=np.float64), labels


class _PublicNode:
    """One public betting history. Holds a regret and a strategy-sum row
    for EVERY combo of the acting player at once, rather than one
    _InfoSetNode per (combo, history) the way postflop_mccfr.py does.

    `regret`, `strategy_sum` and `current` (the regret-matched strategy the
    node plays this iteration) are not arrays of their own: they are
    (combos x actions) views into the acting player's _PlayerStore, which keeps
    every node's rows together (one row per action, so a node owns a run of
    rows), so the whole tree can be updated with a few array operations
    instead of a few dozen per node."""

    __slots__ = (
        "actions", "actor", "index", "depth", "children", "slot", "col0", "regret", "strategy_sum", "current",
    )

    def __init__(self, actions: tuple[str, ...], actor: int, index: int, depth: int) -> None:
        self.actions = actions
        self.actor = actor
        self.index = index
        self.depth = depth
        # Child references, one per action: >= 0 is another decision node's
        # index, < 0 is the terminal ~ref (so -1 is terminal 0).
        self.children: tuple[int, ...] = ()
        # Set by RangeCfrTrainer._allocate: this node's position among its
        # player's nodes, its first column in that player's arrays, and the views.
        self.slot = self.col0 = -1

    @staticmethod
    def _normalize(weights: np.ndarray) -> np.ndarray:
        totals = weights.sum(axis=1, keepdims=True)
        uniform = 1.0 / weights.shape[1]
        return np.where(totals > 0, weights / np.where(totals > 0, totals, 1.0), uniform)

    def current_strategy(self) -> np.ndarray:
        return self.current

    def average_strategy(self) -> np.ndarray:
        return self._normalize(self.strategy_sum)


class _PlayerStore:
    """One player's decision nodes' training state, together: regrets, strategy
    sums and current strategies as (total actions x combos) arrays -- one row per
    (node, action), a node owning a contiguous run of rows -- plus the index
    arrays that let one expression act on every node at once.

    Action-major (rows are actions), not combo-major, because every operation on
    the tree gathers or sums whole rows: all the actions of a level's nodes, all
    of a node's children. Each is then a contiguous copy, not a strided one."""

    __slots__ = ("nodes", "regret", "strategy_sum", "current", "starts", "column_node", "inv_actions")

    def __init__(self, nodes: list[_PublicNode], combos: int) -> None:
        sizes = np.array([len(n.actions) for n in nodes], dtype=np.intp)
        total = int(sizes.sum())
        self.nodes = nodes
        # Where each node's rows start, and which node each row belongs to.
        self.starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.intp) if nodes else sizes
        self.column_node = np.repeat(np.arange(len(nodes), dtype=np.intp), sizes)
        self.inv_actions = (1.0 / np.repeat(sizes, sizes))[:, None] if nodes else np.zeros((0, 1))
        self.regret = np.zeros((total, combos))
        self.strategy_sum = np.zeros((total, combos))
        self.current = np.tile(self.inv_actions, (1, combos))  # zero regret = uniform
        for slot, (node, start, size) in enumerate(zip(nodes, self.starts, sizes)):
            node.slot, node.col0 = slot, int(start)
            rows = slice(int(start), int(start + size))
            node.regret = self.regret[rows].T
            node.strategy_sum = self.strategy_sum[rows].T
            node.current = self.current[rows].T

    def normalize(self, weights: np.ndarray) -> np.ndarray:
        """Each node's rows normalized to sum to 1 per combo (combos with no
        weight fall back to uniform) -- _PublicNode._normalize, for every node at once."""
        if weights.shape[0] == 0:
            return weights.copy()
        totals = np.add.reduceat(weights, self.starts, axis=0)[self.column_node]
        positive = totals > 0
        return np.where(positive, weights / np.where(positive, totals, 1.0), self.inv_actions)


class _ChanceNode:
    """A river card being dealt: a child per enumerated card, each the root of
    that card's river betting (or, with no river betting, a showdown terminal)."""

    __slots__ = ("index", "depth", "children", "card_indices")

    def __init__(self, index: int, depth: int) -> None:
        self.index = index
        self.depth = depth
        self.children: tuple = ()
        self.card_indices: list[int] = []  # which enumerated river card each child is


class _Schedule:
    """The tree walked for one updating player, planned once. The tree never
    changes, so which row of which array every node's reach vector lives in, and
    which nodes sit at each depth, is decided here, in __init__, rather than
    rediscovered by a Python loop over ~150 nodes on every pass.

    Reach vectors are shared, not copied, wherever the player's own action
    doesn't change them: the opponent's reach is the same for every child of the
    updating player's own decision (only its action differs), and the updating
    player's own reach is the same for every child of an opponent's decision. So
    a row is only created where a strategy is multiplied in -- and the terminals
    under one of the player's own decisions all share its row, one column of the
    matrix product instead of several. A chance node's children each get rows of
    their own: the reach is multiplied by which combos can still hold that river
    card (and, for the opponent's, the chance probability).

    Node ids: decisions are 0..D-1 (preorder), terminal t is D + t, chance node c
    is D + T + c."""

    def __init__(self, trainer: RangeCfrTrainer, player: int) -> None:
        decisions, chances = trainer._decisions, trainer._chances
        D, T, C = len(decisions), len(trainer._terminal_pot), len(chances)
        is_terminal = lambda u: D <= u < D + T  # noqa: E731
        is_chance = lambda u: u >= D + T  # noqa: E731
        opp_row = np.full(D + T + C, -1, dtype=np.intp)
        own_row = np.full(D + T + C, -1, dtype=np.intp)
        self.root_id = root = trainer._root_id
        opp_row[root] = own_row[root] = 0
        opp_rows = own_rows = 1
        # depth -> [(parent row, child row, action row | river card)]
        strategy_opp: dict[int, list] = {}
        strategy_own: dict[int, list] = {}
        chance_opp: dict[int, list] = {}
        chance_own: dict[int, list] = {}

        def link_chance(chance_id: int) -> None:
            nonlocal opp_rows, own_rows
            node = chances[chance_id - D - T]
            for card, child in zip(node.card_indices, node.children):
                chance_opp.setdefault(node.depth, []).append((opp_row[chance_id], opp_rows, card))
                opp_row[child] = opp_rows
                opp_rows += 1
                if not is_terminal(child):
                    chance_own.setdefault(node.depth, []).append((own_row[chance_id], own_rows, card))
                    own_row[child] = own_rows
                    own_rows += 1

        if is_chance(root):
            link_chance(root)
        for node in decisions:  # preorder: a node's own rows are set before its children's
            for k, child in enumerate(node.children):
                action_row = node.col0 + k  # row in the ACTING player's store
                if node.actor == player:
                    opp_row[child] = opp_row[node.index]  # shared
                    if not is_terminal(child):
                        own_row[child] = own_rows
                        strategy_own.setdefault(node.depth, []).append(
                            (own_row[node.index], own_rows, action_row)
                        )
                        own_rows += 1
                else:
                    opp_row[child] = opp_rows
                    strategy_opp.setdefault(node.depth, []).append(
                        (opp_row[node.index], opp_rows, action_row)
                    )
                    opp_rows += 1
                    if not is_terminal(child):
                        own_row[child] = own_row[node.index]  # shared
                if is_chance(child):
                    link_chance(child)

        def program(strategy: dict[int, list], chance: dict[int, list]) -> list:
            """Top-down steps, shallowest first: ("s", parent rows, child rows,
            strategy rows) multiplies in a strategy; ("c", ..., river cards) a
            chance node's mask."""
            steps = []
            for depth in sorted(set(strategy) | set(chance)):
                for kind, table in (("s", strategy), ("c", chance)):
                    if depth in table:
                        columns = (np.array(c, dtype=np.intp) for c in zip(*table[depth]))
                        steps.append((kind, *columns))
            return steps

        self.opp_program = program(strategy_opp, chance_opp)
        self.own_program = program(strategy_own, chance_own)
        self.opp_rows, self.own_rows = opp_rows, own_rows

        # Terminals: each distinct opponent-reach row is one row of a matrix
        # product; every terminal points at its row. A row belongs to one river
        # card (the terminals sharing it sit under one decision of one card's
        # subtree), so the products are grouped by card -- each card has its own
        # equity matrix. (Without a river there is one group, the turn's.)
        unique_rows, self.terminal_to_row = np.unique(opp_row[D : D + T], return_inverse=True)
        self.matrix_rows = unique_rows
        row_card = np.empty(len(unique_rows), dtype=np.intp)
        row_card[self.terminal_to_row] = trainer._terminal_card
        self.matrix_groups = [
            (int(card), np.flatnonzero(row_card == card)) for card in np.unique(row_card)
        ]

        # Bottom-up groups, deepest first: the player's own nodes (their action
        # values feed regret updates), the opponent's (plain sums of children),
        # and chance nodes (children summed over the cards the player can hold).
        self.levels = []
        depths = {n.depth for n in decisions} | {c.depth for c in chances}
        for depth in sorted(depths, reverse=True):
            groups = []
            for mine in (True, False):
                nodes = [n for n in decisions if n.depth == depth and (n.actor == player) == mine]
                if not nodes:
                    groups.append(None)
                    continue
                sizes = [len(n.children) for n in nodes]
                groups.append(
                    (
                        np.array([n.index for n in nodes], dtype=np.intp),
                        np.array([r for n in nodes for r in n.children], dtype=np.intp),
                        np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.intp),
                        np.array([n.col0 + k for n in nodes for k in range(len(n.children))], dtype=np.intp),
                        np.array([n.slot for n in nodes], dtype=np.intp),
                    )
                )
            at_depth = [c for c in chances if c.depth == depth]
            if at_depth:
                sizes = [len(c.children) for c in at_depth]
                groups.append(
                    (
                        np.array([D + T + c.index for c in at_depth], dtype=np.intp),
                        np.array([r for c in at_depth for r in c.children], dtype=np.intp),
                        np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.intp),
                        np.array([k for c in at_depth for k in c.card_indices], dtype=np.intp),
                    )
                )
            else:
                groups.append(None)
            self.levels.append(tuple(groups))

        # For the regret update: each of the player's rows' own-reach row.
        store = trainer._stores[player]
        own_node_rows = np.array([own_row[n.index] for n in store.nodes], dtype=np.intp)
        self.own_row_of_action = own_node_rows[store.column_node] if store.nodes else own_node_rows

        # The river-card tables a chance step multiplies by: the opponent's carry
        # the chance probability too (a counterfactual reach includes it).
        self.chance_scale = None
        if trainer._river_cards:
            self.own_table = trainer._live_masks[player]
            if _CHANCE_NORMALIZATION == "own":
                self.opp_table = trainer._live_masks[1 - player]
                self.chance_scale = trainer._chance_scale[player]
            else:
                self.opp_table = trainer._chance_factor * trainer._live_masks[1 - player]
        else:
            self.opp_table = self.own_table = None

        # Scratch, reused every pass: reach vectors and values, one row each.
        combos, opponent_combos = len(trainer.combos[player]), len(trainer.combos[1 - player])
        self.opp = np.empty((opp_rows, opponent_combos))
        self.own = np.empty((own_rows, combos))
        self.value = np.empty((D + T + C, combos))
        self.action_values = np.empty((len(store.column_node), combos))
        self.node_value = np.empty((len(store.nodes), combos))


class RangeCfrTrainer:
    """Trains (and measures) one street's range-vs-range game -- or, with
    `config.river`, the turn and the river together.

    Speed notes, in the order they were found by profiling (docs/decisions.md,
    2026-10-21; tests/reference_range_cfr.py is the unoptimized original and
    test_range_cfr_matches_reference.py holds this class to its answers):

      * The game tree is built ONCE, in __init__, as plain arrays of node and
        terminal records. The original rebuilt a BettingRoundState (a frozen
        dataclass) for every visit of every node, every iteration.
      * A pass over the tree is three phases, not one recursion: top-down, each
        node's reach vectors; then ALL of the pass's terminals evaluated in one
        matrix multiply (the equity matrix against every terminal's opponent-
        reach vector at once -- one pass over the matrix instead of ~150); then
        bottom-up, values and regret updates.
      * "How much opponent weight can I be facing" (the matrix's second half
        in the original) is counted with per-card sums and inclusion-exclusion,
        O(combos) instead of a second matrix product -- the same blocker trick
        postflop-solver (b-inary) uses for its fold and showdown evaluation.
      * Regret-matched strategies are cached and refreshed only when regrets
        change, and every node's regrets, strategy sums and strategies live in
        contiguous per-player arrays (a node owns a run of rows), so the DCFR
        update and the regret matching for the WHOLE tree are a handful of array
        operations rather than ~25 numpy calls per node.
      * Terminals that share an opponent-reach vector (the fold and the call under
        one decision) share one row of the matrix multiply.

    A joint (turn + river) solve is the same machinery with chance nodes in the
    tree: where a turn line closes without a fold, the river card is dealt, and
    each card has its own river subtree, strategies and equity matrix. Money is
    counted across both streets (a river terminal's contribution is the turn's plus
    the river's), so payoffs are measured from the start of the turn throughout."""

    def __init__(self, config: RangeSpotConfig) -> None:
        self._config = config
        blocked = frozenset(config.board)
        combos0, weights0, labels0 = _expand(config.range0, blocked)
        combos1, weights1, labels1 = _expand(config.range1, blocked)
        self.combos = (combos0, combos1)
        self.weights = (weights0, weights1)
        self.labels = (labels0, labels1)

        self._river = config.river
        self._river_cards: tuple[int, ...] = ()
        self._sampled = False
        if config.river is None:
            equity = compute_equity_matrix(combos0, combos1, config.board)
            # NaN marks pairs that share a card -- they can never be dealt
            # together, so they carry no weight at all (never "hero loses").
            possible = (~np.isnan(equity)).astype(np.float64)
            win0 = np.where(np.isnan(equity), 0.0, equity)
            # Per player p, a stacked matrix taking the opponent's reach vector to
            # [equity-weighted share p wins at showdown; total opponent weight p
            # could be facing] for each of p's combos. Training uses only the top
            # half (`_win`, a view; the bottom half is computed by card counting,
            # `_mass_vs`); combo_equities uses both. float32 halves memory traffic
            # (the product is the hot loop); regrets and strategy sums stay float64.
            self._payoff = (
                np.vstack([win0, possible]).astype(np.float32),
                np.vstack([(possible - win0).T, possible.T]).astype(np.float32),
            )
            self._win = (
                self._payoff[0][: len(combos0)],
                self._payoff[1][: len(combos1)],
            )
        else:
            possible = (~collision_mask(combos0, combos1)).astype(np.float64)
            self._payoff = self._win = None
            self._setup_river(config, combos0, combos1)
        self._chance_mass = float(weights0 @ possible @ weights1)
        if self._chance_mass <= 0:
            raise ValueError("no possible deal: every combo pair shares a card")
        self._blockers = tuple(self._build_blockers(p) for p in (0, 1))

        self._root = BettingRoundState.initial(
            config.pot_bb,
            config.effective_stack_bb,
            config.first_to_act,
            config.prior_history,
            config.bet_menu,
        )
        self._nodes: dict[tuple[str, ...], _PublicNode] = {}
        self._decisions: list[_PublicNode] = []  # preorder: a parent precedes its children
        self._chances: list[_ChanceNode] = []
        self._terminal_pot: list[float] = []
        self._terminal_contrib: list[tuple[float, float]] = []
        self._terminal_fold_winner: list[int] = []  # the non-folder's seat, or -1 for a showdown
        self._terminal_card: list[int] = []  # the river card a terminal is under, or -1
        root_ref = self._build_tree(self._root)
        self._finalize_refs(root_ref)
        self._terminal_arrays = self._terminal_tables()
        self._stores = tuple(
            _PlayerStore([n for n in self._decisions if n.actor == player], len(self.combos[player]))
            for player in (0, 1)
        )
        self._schedules = tuple(_Schedule(self, player) for player in (0, 1))
        self.iterations = 0

    # --- setup ----------------------------------------------------------

    def _setup_river(self, config: RangeSpotConfig, combos0: list[Combo], combos1: list[Combo]) -> None:
        """What a joint solve needs per river card: the cards to enumerate, each
        card's showdown equity matrix, and which combos can still hold it."""
        live = [c for c in range(52) if c not in set(config.board)]
        count = len(live) if config.river.cards is None else min(config.river.cards, len(live))
        self._river_cards = select_river_cards(config.board, count)
        # One matrix per card, player 0 vs player 1 (player 1's is the complement,
        # taken on the fly). Combos holding the river card get meaningless rows and
        # columns; their reach is zero at that card, so nothing reads them.
        self._river_win = []
        for card in self._river_cards:
            equity = _compute_equity_matrix(combos0, combos1, config.board + (card,))
            self._river_win.append(np.where(np.isnan(equity), 0.0, equity).astype(_RIVER_MATRIX_DTYPE))
        self._live_masks = tuple(
            np.array([[0.0 if card in combo else 1.0 for combo in combos] for card in self._river_cards])
            for combos in (combos0, combos1)
        )
        # Chance probability per enumerated card. Exactly 1 / 44 (cards left once
        # both hands are out) when every card is enumerated; scaled up by
        # (cards that can come) / (cards enumerated) when a subset stands in.
        can_come = 52 - len(config.board)
        k = len(self._river_cards)
        # A sample of the river cards standing in for all of them makes the game
        # only approximately constant-sum: a turn fold ends before any card is dealt,
        # while a hand that holds sampled cards is dealt fewer of them down the river
        # lines. "Best responses minus the pot" then has a floor it can't get below
        # (it even goes negative), so exploitability() measures the Nash gap instead.
        self._sampled = k < can_come
        self._chance_factor = can_come / ((can_come - 4) * k)
        # Per-hand normalization (see _CHANCE_NORMALIZATION): how many enumerated
        # cards each combo holds, and so how many it can be dealt. With every card
        # enumerated a hand holds 2 and the opponent averages 2, so this is exactly
        # 1 / 44 for every hand -- the same as the constant weight. With a sample it
        # corrects for hands that hold sampled cards seeing fewer of them.
        held = [np.array([len(set(self._river_cards) & set(c)) for c in combos], dtype=np.float64) for combos in (combos0, combos1)]
        mean_held = [float(self.weights[p] @ held[p] / self.weights[p].sum()) for p in (0, 1)]
        self._held_cards = held
        self._chance_scale = tuple(
            1.0 / np.maximum(k - held[p] - mean_held[1 - p], 1.0) for p in (0, 1)
        )

    def _add_terminal(
        self, pot: float, contributed: tuple[float, float], fold_winner: int, card: int
    ) -> tuple[int, int]:
        self._terminal_pot.append(pot)
        self._terminal_contrib.append(contributed)
        self._terminal_fold_winner.append(fold_winner)
        self._terminal_card.append(card)
        return (1, len(self._terminal_pot) - 1)

    def _build_tree(
        self,
        state: BettingRoundState,
        depth: int = 0,
        carried: tuple[float, float] = (0.0, 0.0),
        prefix: tuple[str, ...] = (),
        card: int = -1,
    ) -> tuple[int, int]:
        """Builds the node and terminal records under `state`; returns a
        reference to its root as (kind, index): kind 0 a decision, 1 a terminal,
        2 a chance node (turned into plain ids by _finalize_refs). `carried` is
        what each player put in on earlier streets; `card` the river card (an
        index into the enumerated cards) this subtree is under, or -1."""
        if state.is_terminal():
            pot = state.pot_bb + state.contributed[0] + state.contributed[1]
            contributed = (carried[0] + state.contributed[0], carried[1] + state.contributed[1])
            # apply() has already flipped to_act to the non-folder on a fold.
            if state.history[-1] == "fold":
                return self._add_terminal(pot, contributed, state.to_act, card)
            if self._river_cards and card < 0:
                return self._build_chance(state, depth, prefix)
            return self._add_terminal(pot, contributed, -1, card)
        node = _PublicNode(state.legal_actions(), state.to_act, len(self._decisions), depth)
        self._decisions.append(node)
        self._nodes[prefix + state.history] = node
        node.children = tuple(  # references until _finalize_refs
            self._build_tree(state.apply(action), depth + 1, carried, prefix, card)
            for action in node.actions
        )
        return (0, node.index)

    def _build_chance(self, state: BettingRoundState, depth: int, prefix: tuple[str, ...]) -> tuple[int, int]:
        """The turn has closed without a fold: deal the river card. Each card's
        child is that card's river betting (starting with the out-of-position
        player, on the pot the turn built and the stacks it left), or, with no
        river betting or no chips left, a showdown."""
        node = _ChanceNode(len(self._chances), depth)
        self._chances.append(node)
        pot = state.pot_bb + state.contributed[0] + state.contributed[1]
        remaining = state.stack_bb - state.contributed[0]
        menu = self._river.bet_menu
        children = []
        for index, card in enumerate(self._river_cards):
            if menu is None or remaining <= 1e-9:
                children.append(self._add_terminal(pot, state.contributed, -1, index))
            else:
                river = BettingRoundState.initial(pot, remaining, 0, (), menu)
                children.append(
                    self._build_tree(
                        river, depth + 1, state.contributed,
                        prefix + state.history + (f"river:{card_str(card)}",), index,
                    )
                )
            node.card_indices.append(index)
        node.children = tuple(children)
        return (2, node.index)

    def _finalize_refs(self, root_ref: tuple[int, int]) -> None:
        """Replace (kind, index) references with plain node ids: decisions
        0..D-1, terminal t as D + t, chance node c as D + T + c."""
        D, T = len(self._decisions), len(self._terminal_pot)

        def unify(ref: tuple[int, int]) -> int:
            kind, index = ref
            return index if kind == 0 else D + index if kind == 1 else D + T + index

        for node in self._decisions:
            node.children = tuple(unify(r) for r in node.children)
        for chance in self._chances:
            chance.children = tuple(unify(r) for r in chance.children)
        self._root_id = unify(root_ref)

    def _terminal_tables(self) -> tuple:
        """Per player and terminal, the two coefficients that turn the opponent
        masses into a value: value = alpha * (equity-weighted mass won) + beta *
        (mass faced). A showdown is pot * win - own * facing; a fold is
        (share - own) * facing, where the share is the WHOLE pot for the
        non-folder (dead money from earlier streets included -- see
        betting_round.terminal_utility) and nothing for the folder. `own` is
        everything the player has put in since the start of the solve, across
        streets. Shapes (T,)."""
        pot = np.array(self._terminal_pot)
        winner = np.array(self._terminal_fold_winner)
        contrib = np.array(self._terminal_contrib)  # (T, 2)
        is_fold = winner >= 0
        per_player = []
        for player in (0, 1):
            own = contrib[:, player]
            fold_share = np.where(winner == player, pot, 0.0)
            alpha = np.where(is_fold, 0.0, pot)
            beta = np.where(is_fold, fold_share - own, -own)
            per_player.append((alpha[:, None], beta[:, None]))
        self._terminal_card = np.array(self._terminal_card, dtype=np.intp)
        return tuple(per_player)

    def _build_blockers(self, player: int) -> tuple:
        """What `_mass_vs` needs to count, for each of `player`'s combos, the
        opponent weight it is NOT blocked from: its two cards, an opponent-
        combo-by-card incidence matrix, and each combo's identical twin in
        the opponent range (if there is one)."""
        mine, theirs = self.combos[player], self.combos[1 - player]
        own_cards = np.array(mine, dtype=np.intp)  # (n, 2)
        incidence = np.zeros((len(theirs), 52))
        for j, (a, b) in enumerate(theirs):
            incidence[j, a] = incidence[j, b] = 1.0
        # Keyed by the sorted pair: the same two cards can be listed in either
        # order (a pair built from a label vs. from a specific-combo key).
        index_of = {tuple(sorted(combo)): j for j, combo in enumerate(theirs)}
        same = np.array(
            [index_of.get(tuple(sorted(combo)), len(theirs)) for combo in mine], dtype=np.intp
        )
        return own_cards[:, 0], own_cards[:, 1], incidence, same

    @property
    def root(self) -> BettingRoundState:
        return self._root

    @property
    def river_cards(self) -> tuple[int, ...]:
        """The river cards a joint solve enumerates (empty for a one-street solve)."""
        return self._river_cards

    # --- evaluating terminals -------------------------------------------

    def _mass_rows(
        self, player: int, rows: np.ndarray, card: int = -1
    ) -> tuple[np.ndarray, np.ndarray]:
        """For each of `player`'s combos and each ROW of `rows` (a (T, opponent
        combos) array of reach weights): the equity-weighted opponent mass it wins
        at showdown, and the total opponent mass it could be facing (combos
        sharing a card excluded). Shapes (T, own combos). `card` is the river
        card (an index into the enumerated ones) whose showdown this is, or -1
        for the turn street's own equity matrix (every runout averaged).

        The win mass is one matrix multiply. The facing mass needs no matrix:
        total reach, minus the reach of opponent combos holding either of my
        two cards, plus back the combo identical to mine (it was subtracted
        for both cards). Inclusion-exclusion over a 52-card table. One row per
        terminal (rather than one column) keeps each terminal's values
        contiguous, which is what the gathers and the bottom-up pass want."""
        first, second, incidence, same = self._blockers[player]
        per_card = rows @ incidence  # (T, 52): reach of opponent combos holding each card
        padded = np.concatenate([rows, np.zeros((rows.shape[0], 1))], axis=1)  # column m = "no identical twin"
        facing = rows.sum(axis=1)[:, None] - per_card[:, first] - per_card[:, second] + padded[:, same]
        if card < 0 and self._win is None:
            # A joint solve's turn-street terminals are all folds (a closing line
            # goes to a river card instead), and a fold never reads the win mass.
            win = np.zeros_like(facing)
        elif card < 0:
            matrix = self._win[player]
            win = (rows.astype(matrix.dtype, copy=False) @ matrix.T).astype(np.float64)
        else:
            # One matrix per river card, player 0's. Player 1's win mass is what
            # it faces minus what player 0 wins from the same reach.
            matrix = self._river_win[card]
            product = (rows.astype(matrix.dtype, copy=False) @ (matrix.T if player == 0 else matrix)).astype(np.float64)
            win = product if player == 0 else facing - product
        return win, facing

    def _mass_vs(self, player: int, vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """_mass_rows for callers holding the vectors as columns: `vectors` is
        (opponent combos, T) and the masses come back (own combos, T)."""
        win, facing = self._mass_rows(player, np.ascontiguousarray(vectors.T))
        return win.T, facing.T

    # --- one pass over the tree ------------------------------------------

    def _pass(self, player: int, *, mode: str) -> np.ndarray:
        """One traversal for `player`, returning its per-combo value at the root.
        mode "train": both players play their current strategies, `player`'s regrets
        and strategy sums are updated (DCFR), and its strategies refreshed. mode
        "best_response": the opponent plays its AVERAGE strategy and `player`
        best-responds. mode "evaluate": both play their average strategies --
        what the player actually gets (the exploitability measure needs it when the
        game isn't constant-sum).

        Three phases, each a handful of array operations per tree level (the
        plan is in _Schedule) rather than a Python loop over every node."""
        train = mode == "train"
        plan = self._schedules[player]
        mine, theirs = self._stores[player], self._stores[1 - player]
        terminals_from = len(self._decisions)
        opp, own, value = plan.opp, plan.own, plan.value
        opp[0] = self.weights[1 - player]
        own[0] = self.weights[player]
        opponent_strategy = theirs.current if train else theirs.normalize(theirs.strategy_sum)
        own_average = mine.normalize(mine.strategy_sum) if mode == "evaluate" else None

        # Top-down: reach vectors. Both players' reach is multiplied by a strategy
        # only where that player acts (or by a card mask where one is dealt);
        # everything else is a shared row.
        for kind, parent, child, third in plan.opp_program:
            opp[child] = opp[parent] * (opponent_strategy[third] if kind == "s" else plan.opp_table[third])
        if train:
            for kind, parent, child, third in plan.own_program:
                own[child] = own[parent] * (mine.current[third] if kind == "s" else plan.own_table[third])

        # Every terminal at once (one product per river card). Row t of
        # `value[terminals_from:...]` is terminal t's value for each of the
        # player's combos.
        alpha, beta = self._terminal_arrays[player]
        rows = opp[plan.matrix_rows]
        if len(plan.matrix_groups) == 1:
            win, facing = self._mass_rows(player, rows, plan.matrix_groups[0][0])
        else:
            win = np.empty((len(rows), len(self.combos[player])))
            facing = np.empty_like(win)
            for card, index in plan.matrix_groups:
                win[index], facing[index] = self._mass_rows(player, rows[index], card)
        terminals = len(alpha)
        value[terminals_from : terminals_from + terminals] = (
            alpha * win[plan.terminal_to_row] + beta * facing[plan.terminal_to_row]
        )

        # Bottom-up, deepest level first.
        for own_group, opp_group, chance_group in plan.levels:
            if chance_group is not None:
                nodes, children, starts, cards = chance_group
                # A combo holding the river card can't be dealt it: its value
                # under that card is meaningless and left out of the sum.
                dealt = np.add.reduceat(value[children] * plan.own_table[cards], starts, axis=0)
                value[nodes] = dealt if plan.chance_scale is None else dealt * plan.chance_scale
            if opp_group is not None:
                nodes, children, starts, _, _ = opp_group
                value[nodes] = np.add.reduceat(value[children], starts, axis=0)
            if own_group is not None:
                nodes, children, starts, action_rows, slots = own_group
                action_values = value[children]
                if train:
                    plan.action_values[action_rows] = action_values
                    node_value = np.add.reduceat(action_values * mine.current[action_rows], starts, axis=0)
                    plan.node_value[slots] = node_value
                elif mode == "evaluate":
                    node_value = np.add.reduceat(action_values * own_average[action_rows], starts, axis=0)
                else:
                    node_value = np.maximum.reduceat(action_values, starts, axis=0)
                value[nodes] = node_value

        if train and mine.nodes:
            # DCFR, for every one of the player's nodes at once: discount what's
            # accumulated so far before adding this iteration -- positive regrets
            # by t^a/(t^a+1), negative by t^b/(t^b+1), the average strategy by
            # (t/(t+1))^g -- so early, badly-informed iterations fade instead of
            # anchoring the result. Then regret-match the new current strategies.
            t = self.iterations - 1
            positive = t**_DCFR_ALPHA / (t**_DCFR_ALPHA + 1)
            negative = t**_DCFR_BETA / (t**_DCFR_BETA + 1)
            gamma = (t / (t + 1)) ** _DCFR_GAMMA
            regret, strategy_sum, current = mine.regret, mine.strategy_sum, mine.current
            np.multiply(regret, np.where(regret > 0, positive, negative), out=regret)
            regret += plan.action_values
            regret -= plan.node_value[mine.column_node]
            strategy_sum *= gamma
            strategy_sum += own[plan.own_row_of_action] * current  # the strategy played THIS iteration
            # DCFR keeps (discounted) negative regrets, so take the positive part.
            current[...] = mine.normalize(np.maximum(regret, 0.0))
        return value[plan.root_id].copy()

    def train(self, iterations: int) -> None:
        for _ in range(iterations):
            self.iterations += 1
            # Alternating updates: player 1's pass already sees player 0's
            # freshly updated strategy.
            for player in (0, 1):
                self._pass(player, mode="train")

    def train_until(
        self,
        target_pct_of_pot: float,
        max_iterations: int,
        check_every: int = 25,
        deadline: float | None = None,
    ) -> float:
        """Train until exploitability falls below `target_pct_of_pot` (% of
        the pot at the start of this street, seeded bets included), checking
        every `check_every` iterations, or until `max_iterations`. Returns
        the exploitability actually reached, as % of that pot.

        Iteration-based by default, so the same request stops at the same
        iteration on any machine. `deadline` (a time.perf_counter() value)
        is the escape hatch for a host too slow to finish in time: training
        stops after the first iteration past it, and the exploitability
        returned says honestly how converged the result got. A check costs
        about one extra iteration (two best-response passes)."""
        pot = self._root.pot_bb + self._root.contributed[0] + self._root.contributed[1]
        while self.iterations < max_iterations:
            batch = min(check_every, max_iterations - self.iterations)
            for _ in range(batch):
                self.train(1)
                if deadline is not None and time.perf_counter() >= deadline:
                    return 100 * self.exploitability() / pot
            pct = 100 * self.exploitability() / pot
            if pct < target_pct_of_pot or self.iterations >= max_iterations:
                return pct
        # Only reached if already at max_iterations before starting.
        return 100 * self.exploitability() / pot if self.iterations else float("inf")

    # --- reading results -----------------------------------------------

    def average_strategy(self, history: tuple[str, ...] | None = None) -> tuple[tuple[str, ...], np.ndarray]:
        """(actions, (combo_count, action_count) average strategy) for the
        acting player at `history` -- the root decision by default."""
        if history is None:
            history = self._root.history
        node = self._nodes.get(history)
        if node is None:
            raise KeyError(f"no node trained at history {history!r} -- train() first, or unreachable")
        return node.actions, node.average_strategy()

    def river_strategy(
        self, card: int, turn_history: tuple[str, ...], river_history: tuple[str, ...] = ()
    ) -> tuple[tuple[str, ...], np.ndarray]:
        """(actions, average strategy) at a river decision of a joint solve: the
        player to act's combos on river card `card` (a card int, one of
        river_cards), reached by `turn_history` (the turn line that closed) and
        then `river_history` (the river's own betting so far)."""
        key = turn_history + (f"river:{card_str(card)}",) + river_history
        node = self._nodes.get(key)
        if node is None:
            raise KeyError(f"no river node at {key!r}")
        return node.actions, node.average_strategy()

    def combo_equities(self, player: int) -> tuple[np.ndarray, float]:
        """Each of `player`'s combos' showdown equity against the opponent's
        whole weighted range (every runout counted, card-sharing pairs
        excluded), plus the range's overall equity -- read off the same
        matrix training uses, so nothing is recomputed. NaN for a combo that
        can't be dealt against any of the opponent's range. Not available for a
        joint solve (it has no single turn-street equity matrix)."""
        if self._payoff is None:
            raise NotImplementedError("combo_equities isn't available for a joint turn+river solve")
        n = len(self.combos[player])
        shares = self._payoff[player].astype(np.float64) @ self.weights[1 - player]
        wins, totals = shares[:n], shares[n:]
        equities = np.divide(wins, totals, out=np.full(n, np.nan), where=totals > 0)
        mine = self.weights[player]
        overall = float(mine @ wins) / float(mine @ totals)
        return equities, overall

    def label_strategies(self, history: tuple[str, ...] | None = None) -> dict[str, dict[str, float]]:
        """Combo-level average strategies rolled up to 169-type labels,
        averaged uniformly over each label's unblocked combos -- same
        semantics as postflop_mccfr.aggregate_label_strategies, but every
        combo is genuinely trained here, so no label is ever silently
        missing for lack of samples."""
        if history is None:
            history = self._root.history
        node = self._nodes[history]
        actions, strategy = node.actions, node.average_strategy()
        sums: dict[str, np.ndarray] = {}
        counts: dict[str, int] = {}
        for label, row in zip(self.labels[node.actor], strategy):
            sums[label] = sums.get(label, 0) + row
            counts[label] = counts.get(label, 0) + 1
        return {
            label: {a: float(p) for a, p in zip(actions, sums[label] / counts[label])}
            for label in sums
        }

    def _reach_along(self, line: tuple[str, ...]) -> list[np.ndarray]:
        """Each player's per-combo weight after `line` has been played from
        the root: prior weight times the average-strategy probability of
        each of that player's actions along it."""
        state = self._root
        reach = [self.weights[0].copy(), self.weights[1].copy()]
        for action in line:
            if state.is_terminal():
                raise ValueError(f"line continues past a terminal state at {state.history!r}")
            if action not in state.legal_actions():
                raise ValueError(f"{action!r} isn't legal after {state.history!r}")
            node = self._nodes[state.history]
            reach[node.actor] = reach[node.actor] * node.average_strategy()[:, node.actions.index(action)]
            state = state.apply(action)

        return reach

    def line_probability(self, line: tuple[str, ...]) -> tuple[float, float]:
        """How likely each player was to take their side of `line` at all:
        posterior mass over prior mass, per player. Near 0 means the
        equilibrium (almost) never plays that line, so the posterior
        ranges are numerical noise -- worth warning about before chaining
        them into another solve."""
        reach = self._reach_along(line)
        return tuple(float(r.sum() / w.sum()) for r, w in zip(reach, self.weights))  # type: ignore[return-value]

    def posterior_ranges(self, line: tuple[str, ...]) -> tuple[dict[str, float], dict[str, float]]:
        """Both players' ranges conditional on `line` -- action labels
        played from this trainer's root (i.e. after any prior_history,
        which is seeded, never trained, so it contributes no update; to
        narrow on a whole street's play, solve it with no prior_history)
        -- having happened: a Bayesian update of each
        combo's prior weight by the average-strategy probability of
        every action that player took along it. This is what makes a
        later street's range a consequence of this street's equilibrium
        instead of something the user has to guess (docs/plan.md,
        "where does a later street's range come from?").

        Weights are NOT renormalized, so they stay in [0, 1] like a
        painted range and a combo that took the line with certainty
        keeps its prior weight.

        Keys are combo-aware: a 169-type label ('AKs') where every one of
        its live combos ended up within _COLLAPSE_TOLERANCE (relative) of
        the same weight, otherwise one specific-combo key ('AhKh') per combo --
        because the suits are the point (the nut flush draw is the hand
        that bluffed, its blocker-free sibling isn't), and averaging them
        back into a label would throw that away. A label whose every
        combo is blocked by this street's board is absent; combos the line
        ruled out (weight ~0) are kept as 0.0 -- callers drop them.

        Not exact joint-equilibrium reasoning: nothing here accounts for
        how this street's strategy sets up the next one (no backward
        induction), only for what actually got played."""
        reach = self._reach_along(line)
        board = frozenset(self._config.board)
        result: list[dict[str, float]] = []
        for player in (0, 1):
            by_label: dict[str, list[tuple[Combo, float]]] = {}
            for label, combo, weight in zip(self.labels[player], self.combos[player], reach[player]):
                by_label.setdefault(label, []).append((combo, float(weight)))
            weights: dict[str, float] = {}
            for label, members in by_label.items():
                values = [w for _, w in members]
                # Only collapse when the label has every combo this board
                # leaves: a prior that excluded one (AKs minus AhKh) must
                # not get it back by a label key standing for all four.
                whole_label = len(members) == sum(
                    1 for c in label_to_combos(label) if c[0] not in board and c[1] not in board
                )
                if whole_label and max(values) - min(values) <= _COLLAPSE_TOLERANCE * max(values):
                    weights[label] = sum(values) / len(values)
                else:
                    for combo, weight in members:
                        weights[combo_key(combo)] = weight
            result.append(weights)
        return result[0], result[1]

    def combo_strategies(
        self, history: tuple[str, ...] | None = None, min_spread: float = 0.01
    ) -> dict[str, dict[str, float]]:
        """Per-combo average strategies ('AhKh' -> {action: probability}),
        but only for hand types whose suit combos actually play differently
        (some action's probability differs by more than `min_spread`
        between two of its combos -- flush draws, blockers). Hand types
        whose combos all play alike are left out: label_strategies already
        says it all, and sending 1326 near-identical rows would just bloat
        the response."""
        if history is None:
            history = self._root.history
        node = self._nodes[history]
        strategy = node.average_strategy()
        by_label: dict[str, list[int]] = {}
        for i, label in enumerate(self.labels[node.actor]):
            by_label.setdefault(label, []).append(i)
        out: dict[str, dict[str, float]] = {}
        for rows in by_label.values():
            block = strategy[rows]
            if len(rows) < 2 or float((block.max(axis=0) - block.min(axis=0)).max()) <= min_spread:
                continue
            for i in rows:
                out[combo_key(self.combos[node.actor][i])] = {
                    a: float(p) for a, p in zip(node.actions, strategy[i])
                }
        return out

    # --- convergence measurement ---------------------------------------

    def best_response_value(self, player: int) -> float:
        """Expected payoff (bb per deal) of `player`'s best response against
        the opponent's current average strategy."""
        per_combo = self._pass(player, mode="best_response")
        return float(self.weights[player] @ per_combo) / self._chance_mass

    def value_under_average(self, player: int) -> float:
        """Expected payoff (bb per deal) of `player` when BOTH play their average
        strategies -- what it actually gets, as opposed to what a best response
        would get (best_response_value)."""
        per_combo = self._pass(player, mode="evaluate")
        return float(self.weights[player] @ per_combo) / self._chance_mass

    def exploitability(self) -> float:
        """How much (bb per deal, averaged over the two players) a perfect
        opponent could gain against the current average strategies -- 0 at
        an exact equilibrium. Payoffs always sum to the dead pot (pot_bb),
        so that's subtracted out. The principled convergence measure for
        choosing an iteration count, rather than eyeballing frequencies."""
        if self._sampled:
            # Not a constant-sum game any more (see _sampled): each player's gap
            # between its best response and what it actually gets.
            return sum(
                self.best_response_value(p) - self.value_under_average(p) for p in (0, 1)
            ) / 2
        return (self.best_response_value(0) + self.best_response_value(1) - self._config.pot_bb) / 2
