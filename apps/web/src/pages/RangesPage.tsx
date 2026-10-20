import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "../components/SegmentedControl/SegmentedControl";
import { BuilderPage } from "./BuilderPage";
import { TypeInPage } from "./TypeInPage";
import { ImportPage } from "./ImportPage";
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
 * Interim (Phase 2): each mode still renders the old page as it was --
 * Builder, Type in, Import -- under a switch. Phase 3 replaces this with the
 * merged rail-and-chart page and deletes those three.
 */
export function RangesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));

  return (
    <div className="ranges-page">
      <SegmentedControl
        label="How to describe the spot"
        options={MODES}
        value={mode}
        onChange={(next) => setSearchParams(next === "pick" ? {} : { mode: next })}
      />
      {mode === "pick" && <BuilderPage />}
      {mode === "type" && <TypeInPage />}
      {mode === "paste" && <ImportPage />}
    </div>
  );
}
