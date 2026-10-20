import { useIsDesktop } from "../lib/useIsDesktop";
import { SavedSpotsPage } from "./SavedSpotsPage";
import { LibraryWorkspace } from "./library/LibraryWorkspace";

/**
 * /library: the desktop Library (table, preview, open / rename / duplicate /
 * delete) at >= 1024px. Phones keep the original Saved list, unchanged --
 * the redesign changes nothing visually under 1024px.
 */
export function LibraryPage() {
  return useIsDesktop() ? <LibraryWorkspace /> : <SavedSpotsPage />;
}
