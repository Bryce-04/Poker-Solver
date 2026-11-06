import { CapacitorHttp } from "@capacitor/core";
import type { HandRange, Position, Spot } from "@poker-solver/schema";
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

// Every reachable outcome of PATCH /spots/{id}. `not-found` covers a spot
// that's gone or isn't the caller's -- apps/api answers both with a 404.
export type RenameSpotResult =
  | { kind: "renamed"; spot: Spot }
  | { kind: "not-found" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Renames one of the signed-in user's saved spots. Never throws. */
export async function renameSpot(id: string, name: string): Promise<RenameSpotResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots/${encodeURIComponent(id)}`,
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      data: { name },
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) return { kind: "renamed", spot: asJson(res.data) as Spot };
  if (res.status === 404) return { kind: "not-found" };
  if (res.status === 422) return { kind: "invalid", issues: parseValidationIssues(asJson(res.data)) };
  return { kind: "error", status: res.status };
}

// Every reachable outcome of DELETE /spots/{id}.
export type DeleteSpotResult =
  | { kind: "deleted" }
  | { kind: "not-found" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Deletes one of the signed-in user's saved spots. Never throws. */
export async function deleteSpot(id: string): Promise<DeleteSpotResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots/${encodeURIComponent(id)}`,
      method: "DELETE",
      headers: await authHeaders(),
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) return { kind: "deleted" };
  if (res.status === 404) return { kind: "not-found" };
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
  // Per-suit strategies for hand types whose suits play differently (flush
  // draws, blockers), keyed by specific combo ("AhKh"). Hand types whose
  // suits all play alike are in `strategy` alone. Normalized to {} for an
  // older backend -- see solveSpot.
  combo_strategy?: Record<string, Record<string, number>>;
  // Human-readable notes on any bet/raise in the submitted actions that
  // got lossily bucketed onto the engine's fixed bet-size menu (e.g. "BTN's
  // 47% pot bet -> bucketed to 75% pot (bet_medium)") -- see
  // apps/api/app/solve.py's _replay_street_actions. Empty when nothing
  // needed bucketing (e.g. the seeded action was only a check).
  bucketed_actions: string[];
  // Flop solves only (apps/api/app/hand_notes.py), else {}: each hand type's
  // category ("Top pair, strong kicker") and the rule-of-thumb "why" bullets
  // the Drill uses. Normalized to {} for an older backend -- see solveSpot.
  hand_categories?: Record<string, string>;
  hand_reasons?: Record<string, string[]>;
  // The bet menu this solve used (the Spot's own `bet_menu`, else the default
  // 25/75/125%): each bet action's size as a fraction of the pot, keyed by the
  // action name used in `strategy` ("bet_small", or "bet_33" for a custom
  // menu). Absent from an older backend. Nothing in the UI sets a custom menu
  // yet -- a custom menu's action names ("bet_33") aren't known to the chart's
  // colours and labels (lib/strategySummary.ts), which is the work a bet-size
  // control would bring with it.
  bet_menu?: {
    is_default: boolean;
    sizes: Record<string, number>;
    max_aggressive_actions: number;
  };
  // Present for a joint turn + river solve (Spot.river), null/absent otherwise:
  // exactly what the river was solved with. `exact` is false when `river_cards`
  // (a sample, spread over ranks and suits) stand in for all `river_cards_total`.
  // Nothing in the UI requests a joint solve yet.
  joint?: {
    river_cards: string[];
    river_cards_total: number;
    exact: boolean;
    river_bet_menu: { sizes: Record<string, number>; max_aggressive_actions: number } | null;
    closing_turn_lines: number;
  } | null;
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

type SolveFailure = Exclude<SolveSpotResult, { kind: "solved" }>;

/**
 * POSTs a Spot to one of the solver routes (/spots/solve, /spots/narrow --
 * same request contract, same failure shapes) and classifies the response.
 * Same CapacitorHttp-based convention as the rest of this module -- never
 * throws, transport failures come back as { kind: "network-error" }.
 */
async function postSolverRoute(
  path: string,
  spot: Spot,
): Promise<{ kind: "ok"; data: unknown } | SolveFailure | { kind: "not-found" }> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}${path}`,
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
    return { kind: "ok", data: asJson(res.data) };
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
  if (res.status === 404 || res.status === 405) {
    return { kind: "not-found" };
  }
  return { kind: "error", status: res.status };
}

export async function solveSpot(spot: Spot): Promise<SolveSpotResult> {
  const result = await postSolverRoute("/spots/solve", spot);
  if (result.kind === "not-found") return { kind: "error", status: 404 };
  if (result.kind !== "ok") return result;
  const data = result.data as LiveSolveResponse;
  // A deploy lag between frontend and backend is real (Render deploys
  // separately from the web build) -- bucketed_actions and combo_strategy
  // are newer fields the live API may not send yet. Normalize here, once,
  // rather than every consumer needing an optional check: an older
  // backend's response is still a fully valid "solved" result, just with
  // nothing to disclose and no per-suit detail.
  return {
    kind: "solved",
    data: {
      ...data,
      bucketed_actions: data.bucketed_actions ?? [],
      combo_strategy: data.combo_strategy ?? {},
      hand_categories: data.hand_categories ?? {},
      hand_reasons: data.hand_reasons ?? {},
    },
  };
}

// Shaped to match apps/api/app/solve.py's narrow_ranges response.
export interface NarrowResponse {
  // Each player's range after the street's recorded line: 169-type labels
  // ("AKs") where a hand's suits agree, specific combos ("AhKh") where they
  // differ -- exactly HandRange's two key formats.
  ranges: Record<string, HandRange>;
  // How likely each player was to take their side of the line at all. Near
  // 0 means the equilibrium (almost) never plays it, and the ranges above
  // are numerical noise rather than something to build on.
  line_probability: Record<string, number>;
  converged?: boolean;
  exploitability_pct?: number;
  // What the server's tail trim removed from each range (hands under 2% of
  // the heaviest hand's weight): how many, and their share of the total
  // weight. Optional -- an API from before the trim doesn't send it.
  trimmed?: Record<string, { dropped_entries: number; dropped_weight_pct: number }>;
  bucketed_actions: string[];
}

export type NarrowRangesResult =
  | { kind: "narrowed"; data: NarrowResponse }
  // The deployed API predates /spots/narrow (Render deploys separately from
  // the web build) -- the UI says so rather than showing a generic error.
  | { kind: "unsupported" }
  | Exclude<SolveFailure, never>;

/**
 * POSTs a Spot to /spots/narrow: solves the spot's current street from its
 * start and returns each player's range conditional on that street's
 * recorded actions -- the next street's starting ranges.
 */
export async function narrowRanges(spot: Spot): Promise<NarrowRangesResult> {
  const result = await postSolverRoute("/spots/narrow", spot);
  if (result.kind === "not-found") return { kind: "unsupported" };
  if (result.kind !== "ok") return result;
  const data = result.data as NarrowResponse;
  return { kind: "narrowed", data: { ...data, bucketed_actions: data.bucketed_actions ?? [] } };
}

// Shaped to match apps/api/app/preflop_ranges.py's ranges_for_preflop_line.
export interface PreflopRangesResponse {
  source: "reference_chart";
  line: "single_raised" | "three_bet" | "four_bet";
  // "BTN opens, BB 3-bets, BTN calls" -- the line the ranges are for.
  description: string;
  chart_source: string;
  ranges: Record<string, HandRange>;
}

export type PreflopRangesResult =
  | { kind: "ok"; data: PreflopRangesResponse }
  // 404: a real line the charts don't cover (limped pot, 5-bet, a seat pair or
  // stack with no chart) -- or an API older than this route. The reason is the
  // server's own sentence where it sent one.
  | { kind: "unsupported"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * POSTs a preflop line (two seats + the preflop actions, as a Spot) to
 * /spots/preflop-ranges and returns both players' ranges for the postflop
 * spot it leads to: open + call, 3-bet, or 4-bet pot. Never throws.
 */
export async function fetchPreflopRanges(spot: Spot): Promise<PreflopRangesResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/spots/preflop-ranges`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: spot,
    });
  } catch {
    return { kind: "network-error" };
  }
  if (res.status >= 200 && res.status < 300) {
    return { kind: "ok", data: asJson(res.data) as PreflopRangesResponse };
  }
  const detail = (asJson(res.data) as { detail?: unknown } | undefined)?.detail;
  const reason = typeof detail === "string" ? detail : undefined;
  if (res.status === 404) {
    return {
      kind: "unsupported",
      reason: reason ?? "The server has no ranges for this preflop line.",
    };
  }
  if (res.status === 422) {
    return { kind: "invalid", reason: reason ?? "The server couldn't read that preflop line." };
  }
  return { kind: "error", status: res.status };
}

// ---------------------------------------------------------------------------
// The Train tab's AI coach (apps/api's POST /coach). The server answers from
// the facts the lesson already computed; when the model is unavailable it
// returns the app's own explanation with `source: "fallback"`, so a reply is
// always usable.

export interface CoachContext {
  lesson_title: string;
  prompt: string;
  board: string[];
  hand: string[];
  picked: string;
  correct: string;
  /** Plain text for the learner; also what's shown when the model can't answer. */
  explanation: string;
  /** More facts for the model only (never shown as the fallback). */
  details?: string;
}

export interface CoachAnswer {
  answer: string;
  source: "ai" | "fallback";
  reason: "not_configured" | "rate_limited" | "unavailable" | null;
}

export type AskCoachResult =
  | { kind: "answer"; data: CoachAnswer }
  | { kind: "signed-out" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Asks the coach a question about one lesson answer. Never throws. */
export async function askCoach(question: string, context: CoachContext): Promise<AskCoachResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/coach`,
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      data: { question, context },
      // The model call can take several seconds; the server gives up at 20s.
      connectTimeout: 15000,
      readTimeout: 40000,
    });
  } catch {
    return { kind: "network-error" };
  }

  if (res.status >= 200 && res.status < 300) {
    const body = asJson(res.data) as Partial<CoachAnswer>;
    if (typeof body.answer !== "string") return { kind: "error", status: res.status };
    return {
      kind: "answer",
      data: { answer: body.answer, source: body.source === "ai" ? "ai" : "fallback", reason: body.reason ?? null },
    };
  }
  if (res.status === 401) return { kind: "signed-out" };
  return { kind: "error", status: res.status };
}

// ---------------------------------------------------------------------------
// The coach as a streamed chat (apps/api's POST /coach/chat): the same grounded coach, but the
// answer arrives word by word and the learner can ask follow-ups. Same rule as askCoach above:
// when the model can't answer, the reply is the app's own explanation (`fallback` says why), so
// there is always something to show.

/** One turn of a conversation. It always opens with the coach's first answer. */
export interface CoachChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The server accepts at most this many messages (the new question included). */
export const COACH_MAX_MESSAGES = 12;

export type CoachChatOutcome =
  | { kind: "done"; fallback: CoachAnswer["reason"] }
  | { kind: "signed-out" }
  | { kind: "interrupted" } // words started, then the stream broke
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/**
 * Streams the coach's reply to `onDelta` as it is written. `messages` empty = explain the answer;
 * otherwise the conversation so far, opening with the coach's earlier answer and ending with the
 * learner's new question. Never throws.
 *
 * Uses fetch, not CapacitorHttp: CapacitorHttp returns a finished response, and the point here is
 * showing words as they arrive. apps/api's CORS list already allows the native apps' origin.
 */
export async function streamCoach(
  context: CoachContext,
  messages: CoachChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<CoachChatOutcome> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/coach/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ context, messages }),
      signal,
    });
  } catch {
    return { kind: "network-error" };
  }
  if (res.status === 401) return { kind: "signed-out" };
  if (!res.ok) return { kind: "error", status: res.status };

  // Server-Sent Events: "data: {json}" blocks separated by a blank line.
  const reader = res.body?.getReader();
  if (!reader) return { kind: "error", status: res.status };
  const decoder = new TextDecoder();
  let buffer = "";
  let sawText = false;
  let fallback: CoachAnswer["reason"] = null;
  const handle = (block: string): CoachChatOutcome | null => {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return null;
    let event: { delta?: unknown; done?: unknown; error?: unknown; fallback?: unknown };
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return null;
    }
    if (typeof event.fallback === "string") fallback = event.fallback as CoachAnswer["reason"];
    if (typeof event.delta === "string" && event.delta) {
      sawText = true;
      onDelta(event.delta);
    }
    if (event.error) return { kind: "interrupted" };
    if (event.done) return { kind: "done", fallback };
    return null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const outcome = handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (outcome) return outcome;
      }
    }
  } catch {
    return sawText ? { kind: "interrupted" } : { kind: "network-error" };
  }
  return sawText ? { kind: "interrupted" } : { kind: "error", status: res.status };
}

// ---------------------------------------------------------------------------
// Train-tab lesson progress (apps/api's GET /progress, PUT /progress/{id}).
// Server rows are the account's copy; lib/progress.ts merges them with the
// device's by "newest attempt wins".

export interface ServerProgress {
  done: boolean;
  correct: number;
  total: number;
  at: number;
}

export type FetchProgressResult =
  | { kind: "ok"; lessons: Record<string, ServerProgress> }
  | { kind: "signed-out" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** The signed-in user's lesson progress. Never throws. */
export async function fetchProgress(): Promise<FetchProgressResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/progress`,
      method: "GET",
      headers: { ...(await authHeaders()) },
    });
  } catch {
    return { kind: "network-error" };
  }
  if (res.status >= 200 && res.status < 300) {
    const body = asJson(res.data) as { lessons?: Record<string, ServerProgress> };
    return { kind: "ok", lessons: body.lessons ?? {} };
  }
  if (res.status === 401) return { kind: "signed-out" };
  return { kind: "error", status: res.status };
}

export type PutProgressResult =
  | { kind: "saved"; stored: ServerProgress }
  | { kind: "signed-out" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Uploads one lesson attempt; `stored` is what the server holds afterwards
 * (the newer attempt if it already had one). Never throws. */
export async function putProgress(
  lessonId: string,
  progress: { done: boolean; correct: number; total: number; at?: number },
): Promise<PutProgressResult> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.request({
      url: `${API_BASE_URL}/progress/${encodeURIComponent(lessonId)}`,
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      data: { done: progress.done, correct: progress.correct, total: progress.total, at: progress.at ?? Date.now() },
    });
  } catch {
    return { kind: "network-error" };
  }
  if (res.status >= 200 && res.status < 300) {
    return { kind: "saved", stored: asJson(res.data) as ServerProgress };
  }
  if (res.status === 401) return { kind: "signed-out" };
  return { kind: "error", status: res.status };
}

// ---------------------------------------------------------------------------
// The Coach page (docs/coach.md §3.3, apps/api/app/ask_coach/routes.py). All
// signed-in; someone else's conversation is the same 404 as a missing one.

export type CoachStatus = "idle" | "working" | "waiting_for_solver" | "error";

export interface CoachConversationSummary {
  id: string;
  title: string | null;
  /** The start of the latest Coach text. */
  preview: string | null;
  updated_at: string;
  status: CoachStatus;
}

/** One stored item; `kind` says which card renders `payload` (spec §3.1). */
export interface CoachMessage {
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CoachConversation {
  id: string;
  title: string | null;
  status: CoachStatus;
  messages: CoachMessage[];
}

/** The shared Gemini limit: `used` of `limit` this hour (it's per hour, not per day). */
export interface CoachUsage {
  used: number;
  limit: number;
  resets_at: string;
  all_users_exhausted: boolean;
}

async function coachRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  data?: unknown,
): Promise<{ status: number; data: unknown } | null> {
  try {
    return await CapacitorHttp.request({
      url: `${API_BASE_URL}${path}`,
      method,
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(await authHeaders()),
      },
      ...(data === undefined ? {} : { data }),
    });
  } catch {
    return null;
  }
}

const ok = (status: number) => status >= 200 && status < 300;

export type CreateConversationResult =
  | { kind: "created"; id: string }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Starts an empty conversation. Never throws. */
export async function createConversation(): Promise<CreateConversationResult> {
  const res = await coachRequest("/coach/conversations", "POST", {});
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "created", id: (asJson(res.data) as { id: string }).id };
  return { kind: "error", status: res.status };
}

export type ListConversationsResult =
  | { kind: "ok"; conversations: CoachConversationSummary[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** The signed-in user's conversations, newest first. Never throws. */
export async function listConversations(): Promise<ListConversationsResult> {
  const res = await coachRequest("/coach/conversations", "GET");
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "ok", conversations: asJson(res.data) as CoachConversationSummary[] };
  return { kind: "error", status: res.status };
}

export type GetConversationResult =
  | { kind: "ok"; conversation: CoachConversation }
  | { kind: "not-found" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** A conversation's status and its messages after `after` (0 = all). The
 * page polls this while a turn runs. Never throws. */
export async function getConversation(id: string, after = 0): Promise<GetConversationResult> {
  const res = await coachRequest(`/coach/conversations/${encodeURIComponent(id)}?after=${after}`, "GET");
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "ok", conversation: asJson(res.data) as CoachConversation };
  if (res.status === 404) return { kind: "not-found" };
  return { kind: "error", status: res.status };
}

export type SendCoachMessageResult =
  | { kind: "sent"; lastSeq: number }
  /** 409: the Coach is still answering the previous message. */
  | { kind: "busy" }
  /** 429: over the shared hourly limit, or everyone's daily total is used up. */
  | { kind: "limit"; used: number; limit: number; allUsersExhausted: boolean }
  | { kind: "not-found" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Sends the user's message; the answer arrives by polling getConversation.
 * `attachedSpot` is a pasted hand history the app already parsed, which the
 * backend uses instead of the model's reading of the text (spec §4.1). */
export async function sendCoachMessage(
  id: string,
  text: string,
  attachedSpot?: Spot,
): Promise<SendCoachMessageResult> {
  const res = await coachRequest(`/coach/conversations/${encodeURIComponent(id)}/messages`, "POST", {
    text,
    ...(attachedSpot ? { attached_spot: attachedSpot } : {}),
  });
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "sent", lastSeq: (asJson(res.data) as { last_seq: number }).last_seq };
  if (res.status === 409) return { kind: "busy" };
  if (res.status === 429) {
    const body = (asJson(res.data) ?? {}) as { used?: number; limit?: number; all_users_exhausted?: boolean };
    return {
      kind: "limit",
      used: body.used ?? 0,
      limit: body.limit ?? 0,
      allUsersExhausted: body.all_users_exhausted === true,
    };
  }
  if (res.status === 404) return { kind: "not-found" };
  if (res.status === 422) return { kind: "invalid", issues: parseValidationIssues(asJson(res.data)) };
  return { kind: "error", status: res.status };
}

export type RenameConversationResult =
  | { kind: "renamed"; conversation: CoachConversationSummary }
  | { kind: "not-found" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Renames a conversation. Never throws. */
export async function renameConversation(id: string, title: string): Promise<RenameConversationResult> {
  const res = await coachRequest(`/coach/conversations/${encodeURIComponent(id)}`, "PATCH", { title });
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "renamed", conversation: asJson(res.data) as CoachConversationSummary };
  if (res.status === 404) return { kind: "not-found" };
  return { kind: "error", status: res.status };
}

export type DeleteConversationResult =
  | { kind: "deleted" }
  | { kind: "not-found" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** Deletes a conversation and its messages. Never throws. */
export async function deleteConversation(id: string): Promise<DeleteConversationResult> {
  const res = await coachRequest(`/coach/conversations/${encodeURIComponent(id)}`, "DELETE");
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "deleted" };
  if (res.status === 404) return { kind: "not-found" };
  return { kind: "error", status: res.status };
}

export type CoachUsageResult =
  | { kind: "ok"; usage: CoachUsage }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

/** How much of the shared hourly limit the user has used. Never throws. */
export async function getCoachUsage(): Promise<CoachUsageResult> {
  const res = await coachRequest("/coach/usage", "GET");
  if (!res) return { kind: "network-error" };
  if (ok(res.status)) return { kind: "ok", usage: asJson(res.data) as CoachUsage };
  return { kind: "error", status: res.status };
}
