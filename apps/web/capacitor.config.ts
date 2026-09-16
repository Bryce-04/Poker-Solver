import type { CapacitorConfig } from "@capacitor/cli";

// appId is reverse-DNS and, once this ships anywhere real (even internal
// testing), effectively permanent -- changing it later is a new app, not
// an update. "com.pokersolver.app" is a placeholder; swap it before any
// real distribution if the project ends up with a different final name.
const config: CapacitorConfig = {
  appId: "com.pokersolver.app",
  appName: "Poker Solver",
  webDir: "dist",
};

export default config;
