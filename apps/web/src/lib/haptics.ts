// Haptic feedback for the drill's verdicts, off by default and switched on in
// the drill's settings (lib/drillSettings.ts). In the native app it uses the
// phone's real haptic engine (@capacitor/haptics: success / warning / error
// taps). Elsewhere it falls back to the Vibration API where that exists
// (Android Chrome); iOS Safari doesn't implement it, so there it does nothing.

import { Capacitor } from "@capacitor/core";
import { Haptics, NotificationType } from "@capacitor/haptics";
import { readHaptics } from "./drillSettings";

export type HapticKind = "best" | "good" | "miss";

const PATTERNS: Record<HapticKind, number | number[]> = {
  best: 15,
  good: [20, 40, 20],
  miss: [60, 40, 60],
};

const NATIVE: Record<HapticKind, NotificationType> = {
  best: NotificationType.Success,
  good: NotificationType.Warning,
  miss: NotificationType.Error,
};

/** Plays the verdict's haptic if the player has turned haptics on. */
export function haptic(kind: HapticKind): void {
  try {
    if (!readHaptics()) return;
    if (Capacitor.isNativePlatform()) {
      void Haptics.notification({ type: NATIVE[kind] }).catch(() => {});
    } else if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    // Haptics are a nicety; never let one break the drill.
  }
}
