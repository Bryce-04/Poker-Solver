import { useContext, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StepProgress } from "../../../components/mobile/StepProgress";
import { TopBarActions } from "../../../components/mobile/TopBarActions";
import { onSheetEntry, PageActiveContext, SolveBadgeContext } from "../../../lib/mobileShell";
import { useAutoLoadRanges } from "../useAutoLoadRanges";
import type { SolveSetup } from "../useSolveSetup";
import { BoardStep } from "./BoardStep";
import { HandStep } from "./HandStep";
import { RangesStep } from "./RangesStep";
import { ResultStep } from "./ResultStep";
import type { ExploreOption } from "../solveText";
import { ReadyStep } from "./ReadyStep";
import { SETUP_STEPS, firstOpenStep, readStep, type SolveStep } from "./phoneSteps";
import "./phone.css";

type Solved = NonNullable<SolveSetup["lastSolved"]>;

/**
 * Solve on phones and tablets (docs/mobile-redesign.md §4): four step screens
 * and a result screen over the same useSolveSetup state as desktop.
 *
 * The step is in the URL (`/solve?step=hand|board|ranges|ready|result`) and
 * each step change pushes a history entry, so the Android back gesture and
 * the browser's back button go back one step. With no `?step=` (a fresh
 * visit, or a spot arriving from Ranges or the Library) it opens on the first
 * step that still needs something.
 */
export function SolvePhone({ setup: s }: { setup: SolveSetup }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const active = useContext(PageActiveContext);
  const setBadge = useContext(SolveBadgeContext);
  const autoLoad = useAutoLoadRanges(s);

  // Where a visit with no ?step= opens: decided once, when the setup arrives.
  const [landing, setLanding] = useState<SolveStep>(() => firstOpenStep(s));
  // While hidden behind another tab the URL is that tab's, so keep showing
  // the step we were on.
  const wanted = readStep(params.get("step")) ?? landing;
  const [step, setStep] = useState<SolveStep>(wanted);
  if (active && wanted !== step) setStep(wanted);

  // The result last opened. A newer one shows as "Done" on the Ready step,
  // and the Solve tab keeps its dot until it's seen.
  const [seen, setSeen] = useState<Solved | null>(null);
  if (active && step === "result" && s.lastSolved && seen !== s.lastSolved) setSeen(s.lastSolved);

  const badge =
    s.outcome.kind === "loading" ? "solving" : s.lastSolved && s.lastSolved !== seen ? "new result" : null;
  useEffect(() => {
    setBadge?.(badge);
  }, [badge, setBadge]);
  useEffect(() => () => setBadge?.(null), [setBadge]);

  function go(next: SolveStep) {
    navigate({ pathname: "/solve", search: `?step=${next}` }, { replace: onSheetEntry() });
    window.scrollTo(0, 0);
  }

  function startOver() {
    s.resetAll();
    autoLoad.reset();
    setSeen(null);
    setLanding("hand");
    go("hand");
  }

  /** Keep exploring (§4.5): add the action, then solve again (watching it on
   * the Ready step) or, when it closes the street, pick the next card. The
   * same as desktop's. */
  function explore(option: ExploreOption) {
    const street = s.currentStreet;
    const next = { ...s.streets, [street]: [...s.streets[street], option.action] };
    s.setStreetActions(street, next[street]);
    if (option.dealsNext) go("board");
    else {
      void s.solve(next);
      go("ready");
    }
  }

  const setupStep = step === "result" ? "ready" : step;

  return (
    <div className="m-step">
      {step !== "result" && (
        <TopBarActions>
          <button type="button" className="icon-button" aria-label="Start over" onClick={startOver}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
          </svg>
          </button>
        </TopBarActions>
      )}

      {step !== "result" && <StepProgress steps={SETUP_STEPS} current={setupStep} onPick={go} />}

      {step === "hand" && <HandStep s={s} onNext={() => go("board")} onPasted={() => go("ready")} />}
      {step === "board" && (
        <BoardStep s={s} onBack={() => go("hand")} onNext={() => go("ranges")} onEditHand={() => go("hand")} />
      )}
      {step === "ranges" && <RangesStep s={s} onBack={() => go("board")} onNext={() => go("ready")} />}
      {step === "ready" && (
        <ReadyStep s={s} acknowledged={seen} onGo={go} onSeeResult={() => go("result")} />
      )}
      {step === "result" && <ResultStep s={s} onBack={() => go("ready")} onExplore={explore} />}
    </div>
  );
}
