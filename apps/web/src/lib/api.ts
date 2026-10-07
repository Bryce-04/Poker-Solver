import { CapacitorHttp } from "@capacitor/core";
import type { Position, Spot } from "@poker-solver/schema";
import { getAccessToken } from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Sent ahead of apps/api actually verifying it -- see docs/decisions.md's
// 2026-09-30 entry. Omitted (not blocked client-side) when there's no
// session, since today's backend doesn't enforce auth either way.
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Shaped to match apps/api/app/routes/spots.py's response dict -- not a
// generated type, because it's an API response shape, not part of the
// Spot schema itself.
export interface ReferenceStrategyResponse {
  source: "reference_chart";
  chart_key: string;
  chart_description: string;
  chart_source: string;
  ranges: Partial<Record<Position, Record<string, number>>>;
}

// One entry from FastAPI's 422 body: { detail: SpotValidationIssue[] }.
export interface SpotValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}

// Every reachable outcome of POST /spots/reference-strategy, as data -- this
// function never throws, so callers switch on `kind` instead of try/catch:
//   match         -> 2xx, body is a ReferenceStrategyResponse
//   no-match      -> 404, no reference chart covers this spot yet
//   invalid       -> 422, the posted Spot failed schema validation
//   network-error -> the request itself failed (API down / DNS / offline)
//   error         -> some other non-2xx with no specific handling
export type ReferenceStrategyResult =
  | { kind: "match"; data: ReferenceStrategyResponse }
  | { kind: "no-match" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * POSTs a Spot to /spots/reference-strategy and classifies the response.
 * Never throws: transport failures come back as { kind: "network-error" }.
 *
 * Uses CapacitorHttp (built into @capacitor/core since v4) instead of
 * fetch(). On web it transparently falls back to the browser's fetch; on
 * Android/iOS it routes the request through native networking instead of
 * the WebView's fetch, which sidesteps the browser's CORS enforcement
 * entirely -- native requests never have to clear apps/api's CORS
 * allowlist the way a hosted web build's browser tab does.
 */
export async function fetchReferenceStrategy(
  spot: Spot,
): Promise<ReferenceStrategyResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots/reference-strategy`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: spot,
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    return { kind: "match", data: asJson(res.data) as ReferenceStrategyResponse };
  }
  if (res.status === 404) return { kind: "no-match" };
  if (res.status === 422) {
    return { kind: "invalid", issues: parseValidationIssues(asJson(res.data)) };
  }
  return { kind: "error", status: res.status };
}

// CapacitorHttp's default responseType ("json") hands back an already-parsed
// body, but the web fallback and some edge cases can hand back a raw string
// instead -- normalize both rather than assuming one shape.
function asJson(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function parseValidationIssues(body: unknown): SpotValidationIssue[] {
  if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as { detail?: unknown }).detail)
  ) {
    return (body as { detail: unknown[] }).detail.filter(
      (d): d is SpotValidationIssue =>
        !!d && typeof d === "object" && "msg" in d && "loc" in d,
    );
  }
  return [];
}

// Every reachable outcome of POST /spots, mirroring fetchReferenceStrategy's
// shape. Until the backend lane ships this route, real calls resolve to
// { kind: "error", status: 404 } -- a legitimate, already-styled outcome,
// not a broken build.
export type SaveSpotResult =
  | { kind: "saved"; spot: Spot }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * POSTs a Spot to /spots to persist it. Same CapacitorHttp-based convention
 * as fetchReferenceStrategy -- never throws, transport failures come back
 * as { kind: "network-error" }. Assumes the endpoint echoes back the saved
 * Spot (server-assigned id/created_at) -- confirm against the backend
 * lane's actual response shape once it ships.
 */
export async function saveSpot(spot: Spot): Promise<SaveSpotResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots`,
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      data: spot,
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    return { kind: "saved", spot: asJson(res.data) as Spot };
  }
  if (res.status === 422) {
    return { kind: "invalid", issues: parseValidationIssues(asJson(res.data)) };
  }
  return { kind: "error", status: res.status };
}

// Every reachable outcome of GET /spots.
export type ListSpotsResult =
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * GETs the current user's saved spots. Same CapacitorHttp-based convention
 * as the rest of this module. Assumes a bare JSON array response -- confirm
 * against the backend lane's actual response shape once it ships.
 */
export async function listSpots(): Promise<ListSpotsResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots`,
      method: "GET",
      headers: await authHeaders(),
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    return { kind: "ok", spots: asJson(res.data) as Spot[] };
  }
  return { kind: "error", status: res.status };
}

// Shaped to match apps/api/app/solve.py's response dict.
export interface LiveSolveResponse {
  source: "live_solve";
  iterations: number;
  // How far the result is from equilibrium -- what a perfect opponent could
  // gain against it, as % of the pot. apps/api trains until this drops
  // below its target (0.5%). Optional: an older deployed backend (before
  // range-vs-range CFR) doesn't send it, and Render deploys separately from
  // the web build -- so only show it when it's there.
  exploitability_pct?: number;
  // False when the server's time budget (or iteration cap) cut training off
  // before that target -- e.g. a wide flop on the slow deployed host. The
  // answer is still real, just rougher, and the UI says so. Optional for
  // the same deploy-lag reason as exploitability_pct.
  converged?: boolean;
  position: Position;
  strategy: Record<string, Record<string, number>>;
  // Human-readable notes on any bet/raise in the submitted actions that
  // got lossily bucketed onto the engine's fixed bet-size menu (e.g. "BTN's
  // 47% pot bet -> bucketed to 75% pot (bet_medium)") -- see
  // apps/api/app/solve.py's _replay_street_actions. Empty when nothing
  // needed bucketing (e.g. the seeded action was only a check).
  bucketed_actions: string[];
}

// /spots/solve's 422s aren't one shape: a schema-invalid Spot (missing
// field, wrong type) comes from FastAPI/Pydantic as { detail: [...] },
// same as every other route here ("invalid"); a well-formed Spot this
// route still can't solve (wrong board length, a missing range, a bet
// already recorded this street) comes from solve.py's own
// InvalidSolveRequest as { detail: "<message>" } -- a plain string. These
// need different UI treatment ("fix these fields" vs. "this route can't
// solve that yet, here's why"), so they're different kinds, not one
// generic "invalid".
export type SolveSpotResult =
  | { kind: "solved"; data: LiveSolveResponse }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "rejected"; reason: string }
  // 503: apps/api runs one solve at a time (a 0.1-CPU host can't usefully
  // run two), so this means "someone else's solve is running," not broken.
  | { kind: "busy" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * POSTs a Spot to /spots/solve and classifies the response. Same
 * CapacitorHttp-based convention as the rest of this module -- never
 * throws, transport failures come back as { kind: "network-error" }.
 */
export async function solveSpot(spot: Spot): Promise<SolveSpotResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots/solve`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: spot,
      // CapacitorHttp's native default read timeout is far shorter than a
      // real solve can take (measured: 60s+ on the deployed host for a
      // wide range) -- without this, the app gives up and reports
      // "network-error" while the solve is still running server-side. No
      // other function in this module needs this; they're all fast.
      connectTimeout: 20_000,
      readTimeout: 150_000,
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    const data = asJson(res.data) as LiveSolveResponse;
    // A deploy lag between frontend and backend is real (Render deploys
    // separately from the web build) -- bucketed_actions is a newer field
    // the live API may not send yet. Normalize here, once, rather than
    // every consumer needing an optional check: an older backend's
    // response is still a fully valid "solved" result, just with nothing
    // to disclose.
    return { kind: "solved", data: { ...data, bucketed_actions: data.bucketed_actions ?? [] } };
  }
  if (res.status === 422) {
    const body = asJson(res.data);
    const detail = (body as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") {
      return { kind: "rejected", reason: detail };
    }
    return { kind: "invalid", issues: parseValidationIssues(body) };
  }
  if (res.status === 503) {
    return { kind: "busy" };
  }
  return { kind: "error", status: res.status };
}
