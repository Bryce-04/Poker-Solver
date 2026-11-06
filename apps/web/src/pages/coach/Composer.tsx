import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Spot } from "@poker-solver/schema";
import { CardPicker } from "../../components/CardPicker/CardPicker";
import { SegmentedControl } from "../../components/SegmentedControl/SegmentedControl";
import type { CoachUsage } from "../../lib/api";
import { LOW_USAGE, MAX_TEXT, cardsText, readHistory, withHistory, type AttachedHistory } from "./coachText";

export function Composer({
  value,
  onChange,
  onSend,
  busy,
  usage,
  autoFocusKey,
  pasteKey,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: (text: string, attachedSpot?: Spot) => Promise<boolean>;
  busy: boolean;
  usage: CoachUsage | null;
  /** Changes when the box should take focus (a starter prompt, Edit). */
  autoFocusKey?: number;
  /** Changes when the paste-a-hand-history dialog should open (a starter prompt). */
  pasteKey?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<null | "hand" | "board">(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const [attached, setAttached] = useState<AttachedHistory | null>(null);
  const [geminiNote, setGeminiNote] = useState(false);

  useEffect(() => {
    if (autoFocusKey) box.current?.focus();
  }, [autoFocusKey]);

  // A starter prompt asked for the paste dialog (adjusting state while rendering,
  // React's pattern for responding to a prop change).
  const [seenPasteKey, setSeenPasteKey] = useState(pasteKey);
  if (pasteKey !== seenPasteKey) {
    setSeenPasteKey(pasteKey);
    if (pasteKey) setPasteOpen(true);
  }

  async function submit() {
    if (busy) return;
    const text = withHistory(value, attached);
    if (!text) return;
    const sent = await onSend(text, attached?.spot);
    if (sent) {
      onChange("");
      setAttached(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function insertCards() {
    if (picked.length === 0) return;
    const phrase = `${picker === "hand" ? "my hand" : "board"}: ${cardsText(picked)}`;
    onChange(value.trim() ? `${value.trimEnd()} ${phrase}` : phrase);
    setPicker(null);
    setPicked([]);
    box.current?.focus();
  }

  function usePastedHand() {
    const read = readHistory(pasteText);
    if ("problem" in read) {
      setPasteProblem(read.problem);
      return;
    }
    setAttached(read.attached);
    setPasteOpen(false);
    setPasteText("");
    setPasteProblem(null);
    box.current?.focus();
  }

  const left = usage ? Math.max(0, usage.limit - usage.used) : null;
  const low = left !== null && left <= LOW_USAGE;

  return (
    <div className="coach-composer">
      {usage?.all_users_exhausted ? (
        <p className="coach-composer__warning" role="status">
          The Coach has answered as many questions as it can for everyone today. Try again later.
        </p>
      ) : (
        low && (
          <p className="coach-composer__warning" role="status">
            {left === 0
              ? "No messages left this hour. The limit frees up as the hour passes."
              : `${left} message${left === 1 ? "" : "s"} left this hour. The limit frees up as the hour passes.`}
          </p>
        )
      )}

      {attached && (
        <div className="coach-composer__attached">
          <span>Hand history attached: {attached.summary}</span>
          <button type="button" className="btn-ghost" onClick={() => setAttached(null)} aria-label="Remove the hand history">
            Remove
          </button>
        </div>
      )}

      <div className="coach-composer__box">
        <label className="visually-hidden" htmlFor="coach-message">
          Your message
        </label>
        <textarea
          id="coach-message"
          ref={box}
          className="coach-composer__input"
          rows={2}
          maxLength={MAX_TEXT}
          placeholder="Describe your spot: your cards, position, the board, and what happened..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="coach-composer__tools">
          <span className="coach-composer__tool-buttons">
            <button type="button" className="btn-ghost" onClick={() => setPicker(picker ? null : "hand")} aria-expanded={picker !== null}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="3" width="14" height="18" rx="2" />
                <path d="M12 9v6M9 12h6" />
              </svg>
              Add cards
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPasteOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="6" y="4" width="12" height="17" rx="2" />
                <path d="M9 4V3h6v1" />
              </svg>
              Paste hand history
            </button>
          </span>
          <button
            type="button"
            className="coach-composer__send btn-primary"
            onClick={submit}
            disabled={busy || (!value.trim() && !attached)}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>

        {picker && (
          <div className="coach-popover" role="dialog" aria-label="Add cards">
            <SegmentedControl
              label="Which cards"
              options={[
                { value: "hand", label: "My hand" },
                { value: "board", label: "Board" },
              ]}
              value={picker}
              onChange={(v) => {
                setPicker(v as "hand" | "board");
                setPicked([]);
              }}
            />
            <CardPicker value={picked} onChange={setPicked} max={picker === "hand" ? 2 : 5} />
            <div className="coach-popover__actions">
              <button type="button" className="btn-ghost" onClick={() => setPicker(null)}>
                Cancel
              </button>
              <button type="button" className="btn-secondary" onClick={insertCards} disabled={picked.length === 0}>
                Insert {picked.length > 0 ? cardsText(picked) : "cards"}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="coach-composer__footer">
        Study tool: review spots after you play, not during a hand. Messages are processed by{" "}
        <button type="button" className="coach-link" onClick={() => setGeminiNote((v) => !v)} aria-expanded={geminiNote}>
          Google Gemini
        </button>
        .{left !== null && !low && ` ${left} of ${usage!.limit} messages left this hour.`}
      </p>
      {geminiNote && (
        <p className="coach-composer__note">
          The Coach sends your messages to Google Gemini to read them. On the free tier Google may use them
          to improve its products, so don&rsquo;t include personal information. Deleting a conversation
          deletes our copy; Google&rsquo;s copy follows Google&rsquo;s terms.
        </p>
      )}

      {pasteOpen && (
        <div className="coach-dialog" role="dialog" aria-modal="true" aria-label="Paste a hand history">
          <div className="coach-dialog__panel">
            <h2 className="coach-dialog__title">Paste a hand history</h2>
            <p className="coach-dialog__hint">
              The app reads the hand and the Coach looks at the last decision in it. Say which player you were
              in your message if it isn&rsquo;t clear from the history.
            </p>
            <textarea
              className="coach-dialog__input"
              rows={10}
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteProblem(null);
              }}
              aria-label="Hand history"
            />
            {pasteProblem && (
              <p className="coach-dialog__problem" role="alert">
                {pasteProblem}
              </p>
            )}
            <div className="coach-dialog__actions">
              <button type="button" className="btn-ghost" onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-secondary" onClick={usePastedHand} disabled={!pasteText.trim()}>
                Attach hand
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
