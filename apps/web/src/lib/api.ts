import { CapacitorHttp } from "@capacitor/core";
import type { Position, Spot } from "@poker-solver/schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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
      headers: { "Content-Type": "application/json" },
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
    res = await CapacitorHttp.request({ url: `${API_BASE_URL}/spots`, method: "GET" });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    return { kind: "ok", spots: asJson(res.data) as Spot[] };
  }
  return { kind: "error", status: res.status };
}
