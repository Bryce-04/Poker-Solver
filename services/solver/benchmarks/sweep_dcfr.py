"""Exploitability (% of the pot) at fixed iteration counts under several DCFR
discount settings, on eight realistic spots -- how range_cfr.py's alpha/beta/
gamma were chosen (docs/decisions.md, 2026-10-21). Rerun after changing the
update rule or the iteration policy:

    PYTHONPATH=apps/api python services/solver/benchmarks/sweep_dcfr.py

Lower is better; the slow, wide flops are the rows that matter. Edit
`settings` to try other values.
"""
import sys

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bench_trainer as bench  # noqa: E402
from app.preflop_ranges import call_vs_3bet_range, defend_range, flat_range, open_range, three_bet_range  # noqa: E402
from poker_solver import range_cfr  # noqa: E402
from poker_solver.cards import parse_card  # noqa: E402
from poker_solver_schema import Position  # noqa: E402

BB, BTN, CO = Position.BB, Position.BTN, Position.CO
spots = list(bench.SPOTS) + [
    ("flop A83r, BB defend vs BTN", "As 8h 3d", 6.5, 97.0, defend_range(BTN, BB), open_range(BTN)),
    ("flop 3-bet pot K72r (BB 3bets)", "Ks 7h 2d", 18.5, 91.0, three_bet_range(BTN, BB), call_vs_3bet_range(BTN, BB)),
    ("flop monotone 9h 6h 2h, CO vs BB", "9h 6h 2h", 6.5, 97.0, flat_range(CO, BB), open_range(CO)),
    ("flop T98 connected, BB flat vs BTN", "Ts 9h 8d", 6.5, 97.0, flat_range(BTN, BB), open_range(BTN)),
]
settings = {
    "current a1.5 b0 g2": (1.5, 0.0, 2.0),
    "a1.5 b0.5 g2": (1.5, 0.5, 2.0),
    "a1.5 b0.5 g3": (1.5, 0.5, 3.0),
    "a1.5 b0 g3": (1.5, 0.0, 3.0),
}
CHECKPOINTS = (40, 80, 120)
print(f"{'spot':<36}{'setting':<22}" + "".join(f"{'@'+str(c)+' it':>10}" for c in CHECKPOINTS))
for spot_name, board_text, pot, stack, oop, ip in spots:
    for name, (a, b, g) in settings.items():
        range_cfr._DCFR_ALPHA, range_cfr._DCFR_BETA, range_cfr._DCFR_GAMMA = a, b, g
        cfg = range_cfr.RangeSpotConfig(
            board=tuple(parse_card(c) for c in board_text.split()),
            pot_bb=pot, effective_stack_bb=stack, range0=oop, range1=ip,
        )
        trainer = range_cfr.RangeCfrTrainer(cfg)
        root_pot = trainer.root.pot_bb
        cells = []
        for target in CHECKPOINTS:
            trainer.train(target - trainer.iterations)
            cells.append(100 * trainer.exploitability() / root_pot)
        print(f"{spot_name[:35]:<36}{name:<22}" + "".join(f"{c:>9.2f}%" for c in cells), flush=True)
