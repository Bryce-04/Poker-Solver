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
//   network-error -> fetch() itself rejected (API down / DNS / CORS / offline)
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
 */
export async function fetchReferenceStrategy(
  spot: Spot,
): Promise<ReferenceStrategyResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/spots/reference-strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spot),
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.ok) {
    const data = (await res.json()) as ReferenceStrategyResponse;
    return { kind: "match", data };
  }
  if (res.status === 404) return { kind: "no-match" };
  if (res.status === 422) {
    return { kind: "invalid", issues: await parseValidationIssues(res) };
  }
  return { kind: "error", status: res.status };
}

async function parseValidationIssues(res: Response): Promise<SpotValidationIssue[]> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (Array.isArray(body.detail)) {
      return body.detail.filter(
        (d): d is SpotValidationIssue =>
          !!d && typeof d === "object" && "msg" in d && "loc" in d,
      );
    }
  } catch {
    // 422 with a non-JSON / unexpected body -- fall through to [].
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
 * POSTs a Spot to /spots to persist it. Never throws, same convention as
 * fetchReferenceStrategy. Assumes the endpoint echoes back the saved Spot
 * (server-assigned id/created_at) -- confirm against the backend lane's
 * actual response shape once it ships.
 */
export async function saveSpot(spot: Spot): Promise<SaveSpotResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/spots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spot),
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.ok) {
    const saved = (await res.json()) as Spot;
    return { kind: "saved", spot: saved };
  }
  if (res.status === 422) {
    return { kind: "invalid", issues: await parseValidationIssues(res) };
  }
  return { kind: "error", status: res.status };
}

// Every reachable outcome of GET /spots.
export type ListSpotsResult =
  | { kind: "ok"; spots: Spot[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * GETs the current user's saved spots. Never throws, same convention as
 * the rest of this module. Assumes a bare JSON array response -- confirm
 * against the backend lane's actual response shape once it ships.
 */
export async function listSpots(): Promise<ListSpotsResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/spots`);
  } catch {
    return { kind: "network-error" };
  }

  if (res.ok) {
    const spots = (await res.json()) as Spot[];
    return { kind: "ok", spots };
  }
  return { kind: "error", status: res.status };
}
