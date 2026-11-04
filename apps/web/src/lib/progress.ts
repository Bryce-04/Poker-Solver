import { fetchProgress, putProgress } from "./api";
import type { LessonProgress } from "./lessons";

// Where lesson progress lives. Always in this browser (so a lesson works
// offline and signed out), per account so two people on one device don't mix;
// and, when signed in, on the server (apps/api's /progress) so it follows the
// account to other devices. The server and each device merge by "newest
// attempt wins", per lesson.

export type ProgressMap = Record<string, LessonProgress>;

const KEY = "poker-solver.train.progress.v1";

/** The storage key for an account (its email), or the signed-out "guest" one. */
const keyFor = (account: string | null): string => (account === null ? KEY : `${KEY}:${account}`);

export function readProgress(account: string | null = null): ProgressMap {
  try {
    const raw = window.localStorage.getItem(keyFor(account));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function store(account: string | null, all: ProgressMap): void {
  try {
    window.localStorage.setItem(keyFor(account), JSON.stringify(all));
  } catch {
    // Storage blocked or full: progress just isn't remembered on this device.
  }
}

/** Records an attempt that just finished, stamped now. Returns what was stored. */
export function writeProgress(
  id: string,
  progress: Omit<LessonProgress, "at">,
  account: string | null = null,
  now: number = Date.now(),
): LessonProgress {
  const entry = { ...progress, at: now };
  store(account, { ...readProgress(account), [id]: entry });
  return entry;
}

const at = (p: LessonProgress | undefined): number => p?.at ?? 0;

/** Per lesson, the newer attempt (an entry with no time counts as oldest). On a
 * tie the first argument wins. */
export function mergeProgress(a: ProgressMap, b: ProgressMap): ProgressMap {
  const out: ProgressMap = { ...b };
  for (const [id, entry] of Object.entries(a)) {
    if (!(id in out) || at(entry) >= at(out[id])) out[id] = entry;
  }
  return out;
}

/**
 * Brings this device and the account's server copy into agreement, and
 * returns the result. Anything played while signed out (the guest copy) is
 * claimed by the account on its first sync and then cleared. If the server
 * can't be reached the device's own copy is used as is, and the next sync
 * uploads what is newer. Never throws.
 */
export async function syncProgress(account: string): Promise<ProgressMap> {
  const guest = readProgress(null);
  const local = mergeProgress(readProgress(account), guest);
  const remote = await fetchProgress();
  if (remote.kind !== "ok") {
    store(account, local);
    return local;
  }
  const merged = mergeProgress(local, remote.lessons);
  store(account, merged);
  // Upload what the server doesn't have or has older; the server ignores any
  // that turn out to be stale, so a lost race costs nothing.
  const uploads = Object.entries(merged).filter(([id, entry]) => !(id in remote.lessons) || at(entry) > at(remote.lessons[id]));
  const results = await Promise.all(uploads.map(([id, entry]) => putProgress(id, entry)));
  // The guest copy is gone only once the account really holds it.
  if (results.every((r) => r.kind === "saved")) {
    try {
      window.localStorage.removeItem(keyFor(null));
    } catch {
      // ignore
    }
  }
  return merged;
}
