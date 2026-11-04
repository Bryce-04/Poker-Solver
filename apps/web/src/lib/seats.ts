// How a seat is spoken of in the lessons and at the practice table. One place, so
// the two never disagree and a seat is never described with someone who isn't there:
// UTG acts first, so nobody can have "folded to" it.

const PHRASE: Record<string, string> = {
  UTG: "under the gun (UTG)",
  HJ: "in the hijack (HJ)",
  CO: "in the cutoff (CO)",
  BTN: "on the button (BTN)",
  SB: "in the small blind (SB)",
  BB: "in the big blind (BB)",
};

/** "on the button (BTN)", "under the gun (UTG)": fits after "You're". */
export function seatPhrase(seat: string): string {
  return PHRASE[seat] ?? `in the ${seat}`;
}

/** "the BTN": a seat's short name with its article, for running text. */
export const the = (seat: string): string => `the ${seat}`;

/** A sentence-initial "The BTN". */
export const The = (seat: string): string => `The ${seat}`;

/** The first-in question, worded for who has acted: UTG is first to act, everyone else has folded to you. */
export function openPrompt(seat: string): string {
  return seat === "UTG"
    ? `You're ${seatPhrase(seat)} with 100bb, so you act first. Open or fold?`
    : `You're ${seatPhrase(seat)} with 100bb and everyone has folded to you. Open or fold?`;
}
