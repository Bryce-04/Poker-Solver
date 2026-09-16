import { SpotBuilder } from "../components/SpotBuilder/SpotBuilder";

/**
 * The default route -- today's Stage 2 spot builder, unchanged. Split out
 * of App.tsx so App.tsx can become the router shell (nav + routes) without
 * this component's own logic changing at all.
 */
export function BuilderPage() {
  return <SpotBuilder />;
}
