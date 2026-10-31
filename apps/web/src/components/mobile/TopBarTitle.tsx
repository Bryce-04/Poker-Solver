import { useContext, useEffect, useRef } from "react";
import { PageActiveContext, TopBarTitleContext } from "../../lib/mobileShell";

/**
 * Swaps the phone top bar's title for this page's own, with a back arrow
 * (docs/mobile-redesign.md §3.1: the Solve result's "← BB's flop strategy").
 * Renders nothing itself; the title goes back to the tab's name when this
 * unmounts, or while its page is hidden behind another tab.
 */
export function TopBarTitle({
  title,
  backLabel,
  onBack,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  const set = useContext(TopBarTitleContext);
  const active = useContext(PageActiveContext);
  // The latest onBack, without re-setting the title on every render.
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });
  useEffect(() => {
    if (!set || !active) return;
    set({ title, backLabel, onBack: () => back.current() });
    return () => set(null);
  }, [set, active, title, backLabel]);
  return null;
}
