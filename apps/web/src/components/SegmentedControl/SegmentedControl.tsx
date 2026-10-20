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
 * The `.seg` styling lives in desktop.css and only applies at >= 1024px;
 * a screen that also shows this under that width needs mobile styling for
 * it first.
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
