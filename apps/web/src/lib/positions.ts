import type { Position } from "@poker-solver/schema";

// The generated Position type is a string-literal union with no runtime
// value -- this is the one place that list has to be spelled out again for
// UI purposes (dropdowns, etc).
export const POSITIONS: Position[] = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

// Stage 2 reference charts are 6-max: UTG1 and LJ (full-ring seats) have no
// chart and the builder shouldn't offer them as a hero seat. See
// docs/reference-chart-coverage.md and apps/api/app/reference_charts.py.
export const SIX_MAX_POSITIONS: Position[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

// Seats that can be first to act in an unopened pot (everyone but the big
// blind, who is never "unopened" -- the blind is already in).
export const OPENABLE_POSITIONS: Position[] = SIX_MAX_POSITIONS.filter((p) => p !== "BB");
