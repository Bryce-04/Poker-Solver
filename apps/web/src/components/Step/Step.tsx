import type { ReactNode } from "react";
import "./Step.css";

export interface StepProps {
  number: number;
  title: string;
  /** One plain-language line on what this step is for. */
  subtitle?: string;
  children: ReactNode;
}

/** A numbered section of a multi-step form: badge + title + a hint line
 * saying what the step is for, then its controls. */
export function Step({ number, title, subtitle, children }: StepProps) {
  return (
    <section className="step">
      <header className="step__header">
        <span className="step__badge" aria-hidden="true">
          {number}
        </span>
        <div>
          <h2 className="step__title">{title}</h2>
          {subtitle && <p className="step__subtitle">{subtitle}</p>}
        </div>
      </header>
      <div className="step__body">{children}</div>
    </section>
  );
}
