import { useIsDesktop } from "../lib/useIsDesktop";
import { LibraryPhone } from "./library/LibraryPhone";
import { LibraryWorkspace } from "./library/LibraryWorkspace";

/**
 * /library: the desktop Library (table, preview) at >= 1024px, and the phone
 * Library (cards and a detail sheet, docs/mobile-redesign.md §6) below. Both
 * run on library/useLibrary: the saved spots and open / rename / duplicate /
 * delete.
 */
export function LibraryPage() {
  return useIsDesktop() ? <LibraryWorkspace /> : <LibraryPhone />;
}
