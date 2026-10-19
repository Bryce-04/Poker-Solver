// Tiny haptic helper for the Swipe Drill. Uses the Vibration API where it
// exists (Android Chrome and webviews); iOS Safari doesn't implement it, so
// there it silently does nothing. A native build can swap in
// @capacitor/haptics here later without touching any caller.

export type HapticKind = "best" | "good" | "miss";

const PATTERNS: Record<HapticKind, number | number[]> = {
  best: 15,
  good: [20, 40, 20],
  miss: [60, 40, 60],
};

export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    // Haptics are a nicety; never let one break the drill.
  }
}
