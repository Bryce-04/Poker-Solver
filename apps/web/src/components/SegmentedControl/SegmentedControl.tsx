import "./SegmentedControl.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** A smaller second line under the label ("39.4% of hands"). */
  detail?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** What the group chooses ("Entry mode", "Brush weight"), for screen readers. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Fill the row, options sharing the width equally (a seat picker). */
  stretch?: boolean;
}

/**
 * One row of mutually exclusive choices -- entry mode, brush weight, seat,
 * stack, Library filter (docs/desktop-redesign.md §5). Buttons with
 * aria-pressed rather than radios, matching the mockup and RangeGrid's
 * brush buttons.
 *
 * Under 1024px it is the mobile mockup's touch-sized pill; at
 * >= 1024px, the mockup's inset pill (SegmentedControl.css).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  stretch = false,
}: SegmentedControlProps<T>) {
  return (
    <div className={stretch ? "seg seg--stretch" : "seg"} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.detail ? "seg-item seg-item--two-line" : "seg-item"}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.detail ? (
            <>
              <span>{option.label}</span> <span className="seg-item__detail">{option.detail}</span>
            </>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
}
