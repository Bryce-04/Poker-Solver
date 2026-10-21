# Checking the solver against postflop-solver

`postflop-solver` (b-inary, Rust, https://github.com/b-inary/postflop-solver) is the
best-known open-source postflop solver. This folder is a small harness that gives it the
**same game** our joint turn + river solver solves, and compares the answers and the time.
Results are in `docs/decisions.md` (2026-10-21, "Checked against postflop-solver").

**License.** postflop-solver is AGPL-3.0-or-later. Nothing of theirs is copied or vendored here
(`Cargo.toml` points at a separate clone, `src/main.rs` is our own code that calls their public
API). Do not copy their source into this repo without deciding the licensing question first
(AGPL covers a network service built on it).

## The spot

Q♠ J♥ 7♥ 3♥ turn (flush arrives), 100bb deep (pot 10.5bb, stack 95bb), OOP = BB's flat range
(62 hand types, 364 combos), IP = BTN's open range (82 types), from `apps/api/app/preflop_ranges.py`.
Turn: one 50% bet size plus all-in, no sized re-raise (after a bet: fold / call / all-in). River:
one 75% size plus all-in, same. All 48 river cards. These are exactly our `BetMenu(sizes=(0.5,),
max_aggressive_actions=1)` turn and `BetMenu(sizes=(0.75,), max_aggressive_actions=1)` river, and the
postflop-solver tree is made to match by turning its extras off (no auto-added all-ins, no size
merging, no donk bets). Chips are bb x 100 (their sizes are integers).

## Running it

1. Clone their solver NEXT TO this repo (the `path` in `postflop_solver/Cargo.toml` expects
   `../postflop-solver` beside the repo folder): `git clone https://github.com/b-inary/postflop-solver`
   (measured at commit `9d1509f`).
2. Build the harness, from `postflop_solver/`. Their crate needs two things on a current toolchain:
   its `bincode` dependency has since released a breaking 2.0 (so build without that feature, which
   `Cargo.toml` already does) and two lints that became errors in newer Rust:
   `RUSTFLAGS="-A dangerous_implicit_autorefs -C target-cpu=native" cargo build --release`.
   On Windows without Visual Studio, the GNU target linked with Zig works in user space (no admin):
   `pip install ziglang cargo-zigbuild`, `rustup target add x86_64-pc-windows-gnu`, set
   `CARGO_ZIGBUILD_ZIG_PATH` to the `zig.exe` inside the `ziglang` package, then
   `cargo zigbuild --release --target x86_64-pc-windows-gnu`.
3. Write the two range files (comma-separated hand types, all weight 1) from `flat_range(BTN, BB)` and
   `open_range(BTN)`, then
   `compare oop.txt ip.txt QsJh7h 3h 1050 9500 "50%, a" "75%, a" 10 theirs.csv [target %]`
   (check exploitability every 10 iterations; set `RAYON_NUM_THREADS=1` for a single-thread run).
4. `python compare_with_postflop_solver.py theirs.csv 0.03 2500` solves the same game with our trainer
   and prints both sides.

What to compare: the **game value** (OOP's EV; unique at equilibrium, so two correct solvers must agree
even where their strategies differ at near-tied actions), then iterations and time to the same precision,
then the root frequencies.
