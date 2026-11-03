import "./mobile.css";
import "./ActionBar.css";

export interface ActionBarProps {
  /** The primary action's label while it's enabled ("Next: the board"). */
  primaryLabel: string;
  onPrimary: () => void;
  /**
   * Why the primary action can't run yet ("Finish preflop first"). When set,
   * the button is disabled and says this instead of its label, so a disabled
   * button always explains itself.
   */
  disabledReason?: string | null;
  /** The secondary Back button; left out when absent. */
  onBack?: () => void;
  backDisabled?: boolean;
}

/**
 * The pinned bottom bar of a step screen (docs/mobile-redesign.md §3.5): a
 * 96px secondary Back and a primary button taking the rest. It sits directly
 * above the tab bar, never on it. A spacer of the same height stays in the
 * page flow, so the page's last content can always scroll clear of the bar.
 */
export function ActionBar({ primaryLabel, onPrimary, disabledReason, onBack, backDisabled }: ActionBarProps) {
  const disabled = Boolean(disabledReason);
  return (
    <>
      <div className="action-bar-spacer" aria-hidden="true" />
      <div className="action-bar">
        <div className="action-bar__inner">
          {onBack && (
            <button
              type="button"
              className="m-btn m-btn--secondary action-bar__back"
              onClick={onBack}
              disabled={backDisabled}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="m-btn m-btn--primary action-bar__primary"
            onClick={onPrimary}
            disabled={disabled}
          >
            {disabledReason || primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}
