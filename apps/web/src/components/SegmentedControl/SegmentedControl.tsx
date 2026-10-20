import "./SegmentedControl.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** What the group chooses ("Entry mode", "Brush weight"), for screen readers. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * One row of mutually exclusive choices -- entry mode, brush weight, seat,
 * stack, Library filter (docs/desktop-redesign.md §5). Buttons with
 * aria-pressed rather than radios, matching the mockup and RangeGrid's
 * brush buttons.
 *
 * Under 1024px it looks like SolvePage's existing segmented toggle; at
 * >= 1024px, the mockup's inset pill (SegmentedControl.css).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="seg-item"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
