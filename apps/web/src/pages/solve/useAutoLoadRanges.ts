import { useEffect, useEffectEvent, useRef } from "react";
import type { SolveSetup } from "./useSolveSetup";

/**
 * Ranges load themselves once preflop has closed (docs/desktop-redesign.md
 * §6.1; the phone's ranges step, docs/mobile-redesign.md §4.3): both from the
 * preflop line when both are empty, or a typical range for a lone empty one
 * (e.g. arriving from Ranges with one player's chart). Once per setup.
 * Returns `reset`, for Start over: the next setup auto-loads again even if
 * it's the same as the last one.
 */
export function useAutoLoadRanges(s: SolveSetup) {
  const oopEmpty = Object.keys(s.oopRange).length === 0;
  const ipEmpty = Object.keys(s.ipRange).length === 0;
  const autoKey =
    s.preflopClosed && (oopEmpty || ipEmpty)
      ? JSON.stringify([s.oopPosition, s.ipPosition, s.startingStackBb, s.streets.preflop, s.setupMode, oopEmpty, ipEmpty])
      : null;
  const autoTried = useRef<string | null>(null);
  const autoLoad = useEffectEvent(() => {
    if (oopEmpty && ipEmpty) void s.autoLoadRanges();
    else {
      const [seat, other] = oopEmpty ? [s.oopPosition, s.ipPosition] : [s.ipPosition, s.oopPosition];
      void s.loadReferenceRange(seat, other, (r) => s.setRangeFor(seat, r), (st) => s.setChartStateFor(seat, st));
    }
  });
  useEffect(() => {
    if (autoKey === null || autoTried.current === autoKey) return;
    autoTried.current = autoKey;
    autoLoad();
  }, [autoKey]);

  return {
    reset() {
      autoTried.current = null;
    },
  };
}
