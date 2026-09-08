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

/**
 * POSTs a Spot to /spots/reference-strategy. Returns null when the API
 * 404s (no matching reference chart yet) and throws on any other
 * non-2xx response.
 */
export async function fetchReferenceStrategy(
  spot: Spot
): Promise<ReferenceStrategyResponse | null> {
  const res = await fetch(`${API_BASE_URL}/spots/reference-strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spot),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reference-strategy request failed: ${res.status}`);
  return res.json();
}
