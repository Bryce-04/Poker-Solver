import { useLocation, useSearchParams } from "react-router-dom";
import { useIsDesktop } from "../lib/useIsDesktop";
import { readSavedSpot } from "../lib/solvePrefill";
import { RangesWorkspace } from "./RangesWorkspace";
import { RangesPhone } from "./ranges/RangesPhone";

export type RangesMode = "pick" | "type" | "paste";

function parseMode(raw: string | null): RangesMode {
  return raw === "type" || raw === "paste" ? raw : "pick";
}

/**
 * /ranges: one screen for the three ways of getting a preflop chart
 * (docs/desktop-redesign.md §3 / §6.3), with `?mode=` picking which. No
 * `mode` means "pick". The old /type-in and /import routes redirect here.
 *
 * Desktop (>= 1024px) gets the rail-and-chart page (RangesWorkspace); phones
 * and tablets the stacked page (ranges/RangesPhone, docs/mobile-redesign.md
 * §5). Both share the spot logic in lib/rangesSpot.ts and the fetch-and-save
 * logic in lib/useReferenceChart.ts.
 *
 * Crossing the breakpoint swaps one layout for the other, so what's only in
 * component state resets; the mode survives (it's in the URL), and so do the
 * phone's Pick choices and typed phrase.
 */
export function RangesPage() {
  const isDesktop = useIsDesktop();
  // A saved chart opened from the Library.
  const savedSpot = readSavedSpot(useLocation().state);
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));
  // Only the mode changes; anything else in the URL (the phone's Pick
  // choices) stays.
  const setMode = (next: RangesMode) =>
    setSearchParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next === "pick") out.delete("mode");
      else out.set("mode", next);
      return out;
    });

  return isDesktop ? (
    <RangesWorkspace mode={mode} onModeChange={setMode} initialSpot={savedSpot} />
  ) : (
    <RangesPhone mode={mode} onModeChange={setMode} initialSpot={savedSpot} />
  );
}
