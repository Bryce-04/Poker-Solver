/**
 * The app's four destinations (docs/desktop-redesign.md §3), in nav order.
 * Both the phone header and the desktop sidebar render from this list.
 */
export const NAV_ITEMS = [
  { id: "solve", to: "/solve", label: "Solve", subtitle: "Best play after the flop" },
  { id: "ranges", to: "/ranges", label: "Ranges", subtitle: "Which hands to play preflop" },
  { id: "library", to: "/library", label: "Library", subtitle: "Your saved spots" },
  { id: "drill", to: "/drill", label: "Drill", subtitle: "Practice game · full screen" },
] as const;

export type NavId = (typeof NAV_ITEMS)[number]["id"];

/** The desktop page header's title and one-line description, by route. */
export const PAGE_HEADERS: Record<string, { title: string; description: string }> = {
  "/solve": {
    title: "Solve",
    description: "Set up a hand, then let the solver find the best mix of plays for whoever is to act.",
  },
  "/ranges": {
    title: "Ranges",
    description:
      "Standard preflop charts: which hands to play from each seat. Edit one and save it as your own.",
  },
  "/library": {
    title: "Library",
    description: "Spots you've saved. Only you can see them.",
  },
};
