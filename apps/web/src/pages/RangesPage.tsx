import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "../components/SegmentedControl/SegmentedControl";
import { useIsDesktop } from "../lib/useIsDesktop";
import { BuilderPage } from "./BuilderPage";
import { TypeInPage } from "./TypeInPage";
import { ImportPage } from "./ImportPage";
import { RangesWorkspace } from "./RangesWorkspace";
import "./RangesPage.css";

export type RangesMode = "pick" | "type" | "paste";

const MODES = [
  { value: "pick", label: "Pick" },
  { value: "type", label: "Type it" },
  { value: "paste", label: "Hand history" },
] as const;

function parseMode(raw: string | null): RangesMode {
  return raw === "type" || raw === "paste" ? raw : "pick";
}

/**
 * /ranges: one screen for the three ways of getting a preflop chart
 * (docs/desktop-redesign.md §3 / §6.3), with `?mode=` picking which. No
 * `mode` means "pick". The old /type-in and /import routes redirect here.
 *
 * Desktop (>= 1024px) gets the merged rail-and-chart page (RangesWorkspace).
 * Phones deliberately keep the original Builder / Type in / Import pages,
 * unchanged, under a mode switch: the redesign's rule is that nothing
 * changes visually under 1024px, so those three pages stay as the phone
 * layout rather than being deleted (docs/decisions.md). Their fetch-and-save
 * logic is shared with the desktop page through lib/useReferenceChart.ts.
 *
 * Crossing the breakpoint swaps one layout for the other, so form state
 * resets; the mode survives (it's in the URL).
 */
export function RangesPage() {
  const isDesktop = useIsDesktop();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));
  const setMode = (next: RangesMode) => setSearchParams(next === "pick" ? {} : { mode: next });

  if (isDesktop) return <RangesWorkspace mode={mode} onModeChange={setMode} />;

  return (
    <div className="ranges-page">
      <SegmentedControl label="How to describe the spot" options={MODES} value={mode} onChange={setMode} />
      {mode === "pick" && <BuilderPage />}
      {mode === "type" && <TypeInPage />}
      {mode === "paste" && <ImportPage />}
    </div>
  );
}
