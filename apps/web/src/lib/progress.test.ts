import { fetchProgress, putProgress } from "./api";
import { mergeProgress, readProgress, syncProgress, writeProgress, type ProgressMap } from "./progress";

vi.mock("./api", () => ({ fetchProgress: vi.fn(), putProgress: vi.fn() }));
const mockFetch = vi.mocked(fetchProgress);
const mockPut = vi.mocked(putProgress);

const entry = (correct: number, at?: number, done = true) => ({ done, correct, total: 3, ...(at === undefined ? {} : { at }) });

beforeEach(() => {
  window.localStorage.clear();
  mockFetch.mockReset();
  mockPut.mockReset();
  mockPut.mockImplementation(async (_id, p) => ({ kind: "saved", stored: { done: p.done, correct: p.correct, total: p.total, at: p.at ?? 0 } }));
});

describe("storage", () => {
  it("round-trips, stamps the time, and keeps other lessons", () => {
    expect(writeProgress("a", { done: true, correct: 2, total: 3 }, null, 111)).toEqual({ done: true, correct: 2, total: 3, at: 111 });
    writeProgress("b", { done: false, correct: 0, total: 3 }, null, 222);
    expect(readProgress()).toEqual({
      a: { done: true, correct: 2, total: 3, at: 111 },
      b: { done: false, correct: 0, total: 3, at: 222 },
    });
  });

  it("keeps each account's progress apart from the guest's and from each other's", () => {
    writeProgress("a", { done: true, correct: 1, total: 3 }, null);
    writeProgress("a", { done: true, correct: 3, total: 3 }, "ann@x.com");
    writeProgress("a", { done: true, correct: 2, total: 3 }, "bob@x.com");
    expect(readProgress(null).a.correct).toBe(1);
    expect(readProgress("ann@x.com").a.correct).toBe(3);
    expect(readProgress("bob@x.com").a.correct).toBe(2);
  });

  it("survives corrupt or blocked storage", () => {
    window.localStorage.setItem("poker-solver.train.progress.v1", "{not json");
    expect(readProgress()).toEqual({});
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeProgress("a", { done: true, correct: 1, total: 1 })).not.toThrow();
    spy.mockRestore();
  });
});

describe("mergeProgress", () => {
  it("keeps the newer attempt per lesson and every lesson either side has", () => {
    const a: ProgressMap = { x: entry(1, 100), y: entry(3, 500) };
    const b: ProgressMap = { x: entry(2, 200), z: entry(1, 50) };
    expect(mergeProgress(a, b)).toEqual({ x: entry(2, 200), y: entry(3, 500), z: entry(1, 50) });
  });

  it("treats an entry with no time as the oldest, and the first argument wins a tie", () => {
    expect(mergeProgress({ x: entry(1) }, { x: entry(2, 5) }).x.correct).toBe(2);
    expect(mergeProgress({ x: entry(1, 5) }, { x: entry(2, 5) }).x.correct).toBe(1);
  });
});

describe("syncProgress", () => {
  it("takes the server's newer attempt and uploads this device's newer one", async () => {
    writeProgress("positions", { done: true, correct: 3, total: 3 }, "ann@x.com", 900); // newer here
    writeProgress("pot-odds", { done: true, correct: 1, total: 3 }, "ann@x.com", 100); // older here
    mockFetch.mockResolvedValue({
      kind: "ok",
      lessons: { "pot-odds": { done: true, correct: 3, total: 3, at: 800 }, positions: { done: true, correct: 1, total: 3, at: 300 } },
    });

    const merged = await syncProgress("ann@x.com");
    expect(merged.positions.correct).toBe(3);
    expect(merged["pot-odds"].correct).toBe(3);
    expect(readProgress("ann@x.com")).toEqual(merged);
    // Only the lesson this device is ahead on is uploaded.
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith("positions", expect.objectContaining({ correct: 3, at: 900 }));
  });

  it("works offline: uses the device copy and uploads nothing", async () => {
    writeProgress("positions", { done: true, correct: 2, total: 3 }, "ann@x.com", 5);
    mockFetch.mockResolvedValue({ kind: "network-error" });
    const merged = await syncProgress("ann@x.com");
    expect(merged.positions.correct).toBe(2);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("uploads a lesson the server has never seen, even one saved before times were recorded", async () => {
    window.localStorage.setItem("poker-solver.train.progress.v1:ann@x.com", JSON.stringify({ positions: entry(3) })); // no `at`
    mockFetch.mockResolvedValue({ kind: "ok", lessons: {} });
    await syncProgress("ann@x.com");
    expect(mockPut).toHaveBeenCalledWith("positions", expect.objectContaining({ correct: 3 }));
  });

  it("lets the account claim what was played signed out, then clears the guest copy", async () => {
    writeProgress("positions", { done: true, correct: 3, total: 3 }, null, 700);
    mockFetch.mockResolvedValue({ kind: "ok", lessons: {} });

    const merged = await syncProgress("ann@x.com");
    expect(merged.positions.correct).toBe(3);
    expect(mockPut).toHaveBeenCalledWith("positions", expect.objectContaining({ at: 700 }));
    expect(readProgress(null)).toEqual({});
    expect(readProgress("ann@x.com").positions.correct).toBe(3);
  });

  it("keeps the guest copy when the upload fails or the server is unreachable", async () => {
    writeProgress("positions", { done: true, correct: 3, total: 3 }, null, 700);

    mockFetch.mockResolvedValue({ kind: "network-error" });
    await syncProgress("ann@x.com");
    expect(readProgress(null).positions).toBeDefined();

    mockFetch.mockResolvedValue({ kind: "ok", lessons: {} });
    mockPut.mockResolvedValue({ kind: "network-error" });
    await syncProgress("ann@x.com");
    expect(readProgress(null).positions).toBeDefined();
    expect(readProgress("ann@x.com").positions).toBeDefined(); // and the account has it locally to retry
  });

  it("does not re-upload what the server already has", async () => {
    writeProgress("positions", { done: true, correct: 3, total: 3 }, "ann@x.com", 700);
    mockFetch.mockResolvedValue({ kind: "ok", lessons: { positions: { done: true, correct: 3, total: 3, at: 700 } } });
    await syncProgress("ann@x.com");
    expect(mockPut).not.toHaveBeenCalled();
  });
});
