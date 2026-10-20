import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic } from "./haptics";
import { writeHaptics } from "./drillSettings";

describe("haptic", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does nothing until haptics are turned on", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    haptic("best");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("vibrates in a browser once turned on", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    writeHaptics(true);
    haptic("miss");
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
  });
});
