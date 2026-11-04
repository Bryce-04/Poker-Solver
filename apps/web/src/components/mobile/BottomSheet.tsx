import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { SHEET_ENTRY } from "../../lib/mobileShell";
import "./BottomSheet.css";

/** The Back a just-closed sheet has queued to remove its history entry, if
 * any (see the history effect below). One at a time: only one sheet is open. */
let pendingBack: number | null = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's heading, also its accessible name. */
  title: ReactNode;
  children: ReactNode;
}

/**
 * A phone bottom sheet (docs/mobile-redesign.md §3.5): a scrim that closes it
 * on tap, the sheet with a handle, its title and a close button.
 * `role="dialog"`, focus kept inside while open and handed back on close, and
 * Esc closes it.
 *
 * **Back closes the sheet first.** Opening pushes a history entry, so the
 * Android back gesture (Capacitor walks the WebView history) and the browser's
 * back button pop that entry and close the sheet, instead of leaving the page.
 * Closing any other way goes back over the entry, so it never lingers. The
 * entry keeps the router's own history state, so React Router sees the same
 * location throughout.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Back closes the sheet.
  useEffect(() => {
    if (!open) return;
    // A sheet that closed a moment ago left its entry and a Back queued to
    // remove it. Opening again now (StrictMode's mount-unmount-mount in
    // development, or the card picker moving on to the next card) reuses that
    // entry and cancels the Back. Otherwise Chrome runs the Back after this
    // sheet's push and lands *before both* entries, which reads as the user
    // pressing Back, and the sheet closes as soon as it opens.
    if (pendingBack !== null && window.history.state?.[SHEET_ENTRY]) {
      clearTimeout(pendingBack);
      pendingBack = null;
    } else {
      window.history.pushState({ ...window.history.state, [SHEET_ENTRY]: true }, "");
    }
    let closedByBack = false;
    function onPopState() {
      if (window.history.state?.[SHEET_ENTRY]) return;
      closedByBack = true;
      onCloseRef.current();
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (closedByBack || !window.history.state?.[SHEET_ENTRY]) return;
      // Closed some other way: go back over the entry, a moment later, so a
      // sheet opening right now can take it over instead.
      if (pendingBack !== null) clearTimeout(pendingBack);
      pendingBack = window.setTimeout(() => {
        pendingBack = null;
        if (window.history.state?.[SHEET_ENTRY]) window.history.back();
      }, 0);
    };
  }, [open]);

  // Focus moves to the sheet itself on open (so a screen reader announces the
  // dialog, and no input pops the keyboard up uninvited), and back to
  // whatever had it on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="bottom-sheet" onKeyDown={onKeyDown}>
      <div className="bottom-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className="bottom-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <span className="bottom-sheet__handle" aria-hidden="true" />
        <div className="bottom-sheet__header">
          <h2 id={titleId} className="bottom-sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
