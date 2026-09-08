# services/solver

The actual solving engine (Stage 5): MCCFR over the locked-in scope (single
postflop street, heads-up, fixed bet-size menu — see
[`../../docs/plan.md`](../../docs/plan.md)), plus the equity calculator.

Nothing in Stage 5 lives here yet. What's here now is the **Stage 1 spike**
(`src/poker_solver/kuhn_spike.py`) — a from-scratch CFR implementation on
Kuhn poker, a tiny toy game with a known equilibrium, used to confirm CFR
converges correctly and get a rough sense of runtime before any real
solving code gets written.

```
pip install -e ".[dev]"
python -m poker_solver.kuhn_spike   # prints the converged strategy
pytest                              # checks it matches the known equilibrium
```

Delete `kuhn_spike.py` once Stage 5's real solver has its own tests
covering the same "does CFR actually converge here" question.
