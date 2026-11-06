/**
 * The app's destinations (docs/desktop-redesign.md §3), in nav order. The
 * desktop sidebar renders all of them; the phone tab bar renders
 * PHONE_NAV_ITEMS, which leaves out the `desktopOnly` ones. The Coach is
 * desktop-only until its phone layout ships (docs/coach.md §9, Phase 5).
 */
export const NAV_ITEMS = [
  { id: "solve", to: "/solve", label: "Solve", subtitle: "Best play after the flop" },
  { id: "ranges", to: "/ranges", label: "Ranges", subtitle: "Which hands to play preflop" },
  { id: "coach", to: "/coach", label: "Coach", subtitle: "Ask about a spot", desktopOnly: true },
  { id: "library", to: "/library", label: "Library", subtitle: "Your saved spots" },
  { id: "train", to: "/train", label: "Train", subtitle: "Lessons and practice" },
] as const;

export type NavId = (typeof NAV_ITEMS)[number]["id"];

/** The phone tab bar's destinations: NAV_ITEMS without the desktop-only ones. */
export const PHONE_NAV_ITEMS = NAV_ITEMS.filter((item) => !("desktopOnly" in item && item.desktopOnly));

/** The page header for a path. A conversation (/coach/:id) shares /coach's. */
export function pageHeaderFor(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return PAGE_HEADERS[path.startsWith("/coach/") ? "/coach" : path];
}

/** The desktop page header's title and one-line description, by route.
 * `workspace` pages lay themselves out edge to edge (rail + canvas); the
 * rest still sit in the padded phone-width column. `ownHeader` pages render
 * the header themselves, to put their own actions in it. */
export const PAGE_HEADERS: Record<
  string,
  { title: string; description: string; workspace?: boolean; ownHeader?: boolean }
> = {
  "/solve": {
    title: "Solve",
    description: "Set up a hand, then let the solver find the best mix of plays for whoever is to act.",
    workspace: true,
    ownHeader: true,
  },
  "/train": {
    title: "Train",
    description: "Short lessons and a practice game that explain how to play, starting from the basics.",
  },
  "/ranges": {
    title: "Ranges",
    description:
      "Standard preflop charts: which hands to play from each seat. Edit one and save it as your own.",
    workspace: true,
  },
  "/coach": {
    title: "Coach",
    description:
      "Describe a spot in your own words. The solver works out the play, and the Coach explains it.",
    workspace: true,
    ownHeader: true,
  },
  "/library": {
    title: "Library",
    description: "Spots you've saved. Only you can see them.",
    workspace: true,
    ownHeader: true,
  },
};
