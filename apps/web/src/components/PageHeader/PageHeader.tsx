import type { ReactNode } from "react";

/** The desktop bar at the top of a page (docs/desktop-redesign.md §4): title,
 * a one-line description, and the page's own actions on the right. Styles
 * are in App.css, desktop only. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
