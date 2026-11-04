import type { Spot } from "@poker-solver/schema";
import type { SolvePrefill } from "../lib/solvePrefill";
import { useIsDesktop } from "../lib/useIsDesktop";
import { useSolveSetup } from "./solve/useSolveSetup";
import { SolveWorkspace } from "./solve/SolveWorkspace";
import { SolvePhone } from "./solve/phone/SolvePhone";

/**
 * Stage 5's live-solve screen: a real solve (apps/api's POST /spots/solve)
 * instead of a static reference chart. Needs a board and BOTH players'
 * ranges, not just hero's -- the convention apps/api/app/solve.py defines:
 * index 0 is out-of-position/first-to-act this street, index 1 is in
 * position.
 *
 * Two alternative ways to reach a decision point, picked via setupMode:
 * clicking through the hand street by street (lib/handBuilder.ts derives
 * pot_bb/effective_stack_bb from real actions plus 1/2 blinds, instead of
 * them being typed in), or pasting a hand history
 * (lib/parseHandHistory.ts's parseHandHistoryToPostflopSetup) when one's
 * already in hand. Both converge on the same board/ranges/solve machinery
 * -- see docs/decisions.md's 2026-10-07 entry for why these are kept as two
 * separate modes rather than merged into one state model.
 *
 * All of the state lives in useSolveSetup, called once here, so crossing
 * the 1024px breakpoint keeps a half-built spot. Desktop renders
 * SolveWorkspace; phones and tablets the four-step flow in solve/phone/
 * (docs/mobile-redesign.md §4).
 */
export function SolvePage({ prefill, savedSpot }: { prefill?: SolvePrefill; savedSpot?: Spot } = {}) {
  const setup = useSolveSetup(prefill, savedSpot);
  const isDesktop = useIsDesktop();
  return isDesktop ? <SolveWorkspace setup={setup} /> : <SolvePhone setup={setup} />;
}
