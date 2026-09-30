import { parseHandHistory } from './parseHandHistory'

// Button at seat 4 = Hero -> Hero is BTN (offset 0). Everyone folds to
// Hero, so this should parse as an unopened spot.
const UNOPENED_HH = `PokerStars Hand #1:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($100 in chips)
Seat 3: Carol ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: Eve ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Frank: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Alice: folds
Bob: folds
Carol: folds
Hero: raises $2 to $3
`

// Button at seat 1. Hero at seat 3 -> BB. Grace at seat 5 -> HJ, raises;
// everyone else folds to Hero. Should parse as BB facing an HJ open.
const VS_RAISE_HH = `PokerStars Hand #2:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #1 is the button
Seat 1: Dave ($100 in chips)
Seat 2: Eve ($100 in chips)
Seat 3: Hero ($150 in chips)
Seat 4: Alice ($100 in chips)
Seat 5: Grace ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Hero: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Alice: folds
Grace: raises $2 to $3
Frank: folds
Dave: folds
Eve: folds
Hero: calls $2
`

describe('parseHandHistory', () => {
  it('parses an unopened pot (folds to Hero) into an open Spot', () => {
    const result = parseHandHistory(UNOPENED_HH)
    expect(result).toEqual({
      kind: 'parsed',
      spot: {
        positions_in_hand: ['BTN'],
        effective_stack_bb: 100,
        current_street: 'preflop',
        actions: [],
      },
    })
  })

  it('parses Hero facing a single raise into a vs-raise Spot', () => {
    const result = parseHandHistory(VS_RAISE_HH)
    expect(result).toEqual({
      kind: 'parsed',
      spot: {
        positions_in_hand: ['BB'],
        effective_stack_bb: 150,
        current_street: 'preflop',
        actions: [{ position: 'HJ', street: 'preflop', action: 'raise' }],
      },
    })
  })

  it('rejects more than one raise before Hero acts', () => {
    const hh = VS_RAISE_HH.replace('Alice: folds', 'Alice: raises $2 to $3')
    const result = parseHandHistory(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/more than one raise/i)
    }
  })

  it('rejects a call before Hero acts', () => {
    const hh = VS_RAISE_HH.replace('Frank: folds', 'Frank: calls $3')
    const result = parseHandHistory(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/call, check, or bet/i)
    }
  })

  it('rejects a table that is not 6-max', () => {
    const hh = UNOPENED_HH.replace('6-max', '9-max')
    const result = parseHandHistory(hh)
    expect(result).toEqual({ kind: 'unrecognized', reason: 'Only 6-max hands are supported right now.' })
  })

  it('rejects a hand with fewer than 6 seated players', () => {
    const hh = UNOPENED_HH.replace('Seat 6: Frank ($100 in chips)\n', '')
    const result = parseHandHistory(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/found 5 seated/i)
    }
  })

  it("rejects a hand with no seat literally named Hero", () => {
    const hh = UNOPENED_HH.replace('Hero', 'Villain')
    const result = parseHandHistory(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/couldn.t find hero/i)
    }
  })

  it('rejects text with no recognizable header at all', () => {
    const result = parseHandHistory('just some random pasted text')
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/table size and button seat/i)
    }
  })
})
