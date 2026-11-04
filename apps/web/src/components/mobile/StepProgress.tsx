import "./StepProgress.css";

export interface StepProgressProps<T extends string> {
  steps: readonly { id: T; label: string }[];
  current: T;
  /** Go back to an earlier step. Later steps can't be tapped. */
  onPick: (id: T) => void;
}

/**
 * Where you are in a multi-step flow (docs/mobile-redesign.md §3.5): one
 * segment per step, violet up to and including the current one, gray after.
 * Earlier steps are buttons that jump back; the current and later ones aren't.
 */
export function StepProgress<T extends string>({ steps, current, onPick }: StepProgressProps<T>) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <nav className="step-progress" aria-label="Steps">
      <ol className="step-progress__list">
        {steps.map((step, i) => {
          const state = i < at ? "done" : i === at ? "current" : "todo";
          const body = (
            <>
              <span className="step-progress__bar" aria-hidden="true" />
              {step.label}
            </>
          );
          return (
            <li key={step.id} className="step-progress__item" data-state={state}>
              {state === "done" ? (
                <button type="button" className="step-progress__link" onClick={() => onPick(step.id)}>
                  {body}
                </button>
              ) : (
                <span className="step-progress__link" aria-current={state === "current" ? "step" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
