import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamCoach, type CoachContext } from "./api";

vi.mock("./auth", () => ({ getAccessToken: vi.fn().mockResolvedValue("tok") }));

const CONTEXT: CoachContext = {
  lesson_title: "Poker Drill",
  prompt: "p",
  board: ["Ks", "7h", "2d"],
  hand: ["Ah", "Kh"],
  picked: "Check",
  correct: "Bet",
  explanation: "e",
};

/** A fetch Response whose body arrives in the given chunks (split wherever we like). */
function sse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        controller.close();
      },
    }),
    init,
  );
}
const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;

describe("streamCoach", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the context and history with the sign-in token, and streams the deltas", async () => {
    fetchMock.mockResolvedValue(sse([ev({ delta: "Hel" }), ev({ delta: "lo" }), ev({ done: true })]));
    const got: string[] = [];
    const history = [
      { role: "assistant" as const, content: "a" },
      { role: "user" as const, content: "q" },
    ];
    const out = await streamCoach(CONTEXT, history, (d) => got.push(d));
    expect(out).toEqual({ kind: "done", fallback: null });
    expect(got).toEqual(["Hel", "lo"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/coach\/chat$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ context: CONTEXT, messages: history });
  });

  it("reassembles events split across network chunks", async () => {
    const whole = ev({ delta: "split me" }) + ev({ done: true });
    fetchMock.mockResolvedValue(sse([whole.slice(0, 9), whole.slice(9, 25), whole.slice(25)]));
    const got: string[] = [];
    expect(await streamCoach(CONTEXT, [], (d) => got.push(d))).toEqual({ kind: "done", fallback: null });
    expect(got).toEqual(["split me"]);
  });

  it("reports an error event as interrupted, keeping the words already delivered", async () => {
    fetchMock.mockResolvedValue(sse([ev({ delta: "half" }), ev({ error: "x" })]));
    const got: string[] = [];
    expect(await streamCoach(CONTEXT, [], (d) => got.push(d))).toEqual({ kind: "interrupted" });
    expect(got).toEqual(["half"]);
  });

  it("treats a stream that just ends after some text as interrupted, and one with none as an error", async () => {
    fetchMock.mockResolvedValueOnce(sse([ev({ delta: "half" })]));
    expect(await streamCoach(CONTEXT, [], () => {})).toEqual({ kind: "interrupted" });
    fetchMock.mockResolvedValueOnce(sse([]));
    expect(await streamCoach(CONTEXT, [], () => {})).toEqual({ kind: "error", status: 200 });
  });

  it("reports the server's fallback reason, with the app's own text as the delta", async () => {
    fetchMock.mockResolvedValue(
      sse([ev({ fallback: "rate_limited" }), ev({ delta: "app text" }), ev({ done: true })]),
    );
    const got: string[] = [];
    expect(await streamCoach(CONTEXT, [], (d) => got.push(d))).toEqual({ kind: "done", fallback: "rate_limited" });
    expect(got).toEqual(["app text"]);
  });

  it.each([
    [401, { kind: "signed-out" }],
    [422, { kind: "error", status: 422 }],
    [500, { kind: "error", status: 500 }],
  ])("maps HTTP %i", async (status, expected) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    expect(await streamCoach(CONTEXT, [], () => {})).toEqual(expected);
  });

  it("never throws when the request itself fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await streamCoach(CONTEXT, [], () => {})).toEqual({ kind: "network-error" });
  });
});
