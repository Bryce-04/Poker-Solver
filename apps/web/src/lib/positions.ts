import type { Position } from "@poker-solver/schema";

// The generated Position type is a string-literal union with no runtime
// value -- this is the one place that list has to be spelled out again for
// UI purposes (dropdowns, etc).
export const POSITIONS: Position[] = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
