// Solve one turn spot with postflop-solver and report time, memory, exploitability,
// the game value, and OOP's root strategy -- so it can be compared with the Python solver.
//
//   compare <oop_range_file> <ip_range_file> <flop e.g. QsJh7h> <turn e.g. 3h>
//           <pot_chips> <stack_chips> <turn_bet_sizes> <river_bet_sizes> <check_every> <out_csv>
use postflop_solver::*;
use std::fs;
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let oop_range: Range = fs::read_to_string(&a[1]).unwrap().trim().parse().unwrap();
    let ip_range: Range = fs::read_to_string(&a[2]).unwrap().trim().parse().unwrap();
    let card_config = CardConfig {
        range: [oop_range, ip_range],
        flop: flop_from_str(&a[3]).unwrap(),
        turn: card_from_str(&a[4]).unwrap(),
        river: NOT_DEALT,
    };
    let pot: i32 = a[5].parse().unwrap();
    let stack: i32 = a[6].parse().unwrap();
    let turn_sizes = BetSizeOptions::try_from((a[7].as_str(), "a")).unwrap();
    let river_sizes = BetSizeOptions::try_from((a[8].as_str(), "a")).unwrap();
    let check_every: u32 = a[9].parse().unwrap();

    let tree_config = TreeConfig {
        initial_state: BoardState::Turn,
        starting_pot: pot,
        effective_stack: stack,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [turn_sizes.clone(), turn_sizes.clone()],
        turn_bet_sizes: [turn_sizes.clone(), turn_sizes],
        river_bet_sizes: [river_sizes.clone(), river_sizes],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 0.0,
        force_allin_threshold: 0.0,
        merging_threshold: 0.0,
    };
    let action_tree = ActionTree::new(tree_config).unwrap();
    let mut game = PostFlopGame::with_config(card_config, action_tree).unwrap();
    let (mem, mem_compressed) = game.memory_usage();
    println!("threads: {}", std::env::var("RAYON_NUM_THREADS").unwrap_or("all".into()));
    println!("memory_mb: {:.1} (compressed {:.1})", mem as f64 / 1048576.0, mem_compressed as f64 / 1048576.0);

    game.allocate_memory(false);
    let target_pct: f32 = if a.len() > 11 { a[11].parse().unwrap() } else { 0.5 };
    let target = pot as f32 * target_pct / 100.0;
    let t0 = Instant::now();
    let mut iterations = 0u32;
    let mut expl = f32::MAX;
    let mut checks = 0.0f64;
    for i in 0..2000u32 {
        solve_step(&game, i);
        iterations = i + 1;
        if iterations % check_every == 0 {
            let c0 = Instant::now();
            expl = compute_exploitability(&game);
            checks += c0.elapsed().as_secs_f64();
            if expl <= target {
                break;
            }
        }
    }
    finalize(&mut game);
    let total = t0.elapsed().as_secs_f64();
    println!("solve_seconds: {:.3} (of which exploitability checks {:.3})", total, checks);
    println!("iterations: {}", iterations);
    println!("exploitability_pct_of_pot: {:.4}", 100.0 * expl / pot as f32);

    game.cache_normalized_weights();
    for p in 0..2 {
        let w = game.normalized_weights(p);
        let ev = game.expected_values(p);
        println!("avg_ev_player{}: {:.4}", p, compute_average(&ev, w));
    }

    // OOP root strategy: strategy[a * n + hand]
    let actions = game.available_actions();
    println!("root_actions: {:?}", actions);
    let cards = game.private_cards(0);
    let names = holes_to_strings(cards).unwrap();
    let strat = game.strategy();
    let n = cards.len();
    let w = game.normalized_weights(0);
    let mut out = String::from("hand,weight");
    for k in 0..actions.len() { out.push_str(&format!(",a{}", k)); }
    out.push('\n');
    for h in 0..n {
        out.push_str(&format!("{},{}", names[h], w[h]));
        for k in 0..actions.len() { out.push_str(&format!(",{}", strat[k * n + h])); }
        out.push('\n');
    }
    fs::write(&a[10], out).unwrap();
}
