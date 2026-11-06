import { useParams } from "react-router-dom";
import { useIsDesktop } from "../../lib/useIsDesktop";
import { CoachPhone, SAVED } from "./CoachPhone";
import { CoachWorkspace } from "./CoachWorkspace";
import { useCoach } from "./useCoach";

/**
 * The Coach (docs/coach.md §7-9): the layout switch. One useCoach for both
 * layouts, so crossing the breakpoint keeps the conversation and polling.
 *
 * `conversationId` comes from App's CoachKeepAlive (which keeps the Coach
 * mounted on phones while another tab is showing), or from the route.
 * Desktop's `/coach` opens the most recent conversation; a phone's is the
 * empty state, and `/coach/saved` is its list of saved conversations.
 */
export function CoachPage({ conversationId: given }: { conversationId?: string }) {
  const params = useParams();
  const isDesktop = useIsDesktop();
  const id = given ?? params.conversationId;
  const view = !isDesktop && id === SAVED ? "saved" : "chat";
  const routeId = view === "saved" ? undefined : id;
  const coach = useCoach(routeId, { openRecent: isDesktop });
  return isDesktop ? (
    <CoachWorkspace coach={coach} conversationId={routeId} />
  ) : (
    <CoachPhone coach={coach} conversationId={routeId} view={view} />
  );
}
