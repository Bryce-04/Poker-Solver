// The 169 canonical starting-hand labels, laid out in standard 13x13 range
// grid order: pairs on the diagonal, suited combos above it, offsuit below.
// Labels match the HandRange key convention used across the schema (see
// packages/schema/src/poker_solver_schema/models.py) — e.g. "AKs", "72o", "TT".

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export function handLabel(rowIndex: number, colIndex: number): string {
  const row = RANKS[rowIndex];
  const col = RANKS[colIndex];
  if (rowIndex === colIndex) return `${row}${row}`;
  if (rowIndex < colIndex) return `${row}${col}s`;
  return `${col}${row}o`;
}

/** 13x13 grid of hand labels, grid[row][col], in standard chart order. */
export const HAND_GRID: string[][] = RANKS.map((_, rowIndex) =>
  RANKS.map((_, colIndex) => handLabel(rowIndex, colIndex))
);
