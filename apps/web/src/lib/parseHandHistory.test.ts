import { parseHandHistory, parseHandHistoryToPostflopSetup } from './parseHandHistory'

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

// Button at seat 1. Dave(BTN) opens, everyone folds except Hero(BB), who
// calls. Heads-up to the flop: pot = Eve's forfeited 0.5 SB + Hero's 3
// (1 blind + 2 call) + Dave's 3 = 6.5bb; both remain at 100-3=97bb behind.
// Hero (BB) is OOP postflop, checks; Dave (BTN) still has the decision.
const FLOP_CHECK_HH = `PokerStars Hand #3:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #1 is the button
Seat 1: Dave ($100 in chips)
Seat 2: Eve ($100 in chips)
Seat 3: Hero ($100 in chips)
Seat 4: Alice ($100 in chips)
Seat 5: Grace ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Hero: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [7h 7s]
Alice: folds
Grace: folds
Frank: folds
Dave: raises $2 to $3
Eve: folds
Hero: calls $2
*** FLOP *** [2h 7d Jc]
Hero: checks
`

const TURN_CHECK_HH = `${FLOP_CHECK_HH}Dave: checks
*** TURN *** [2h 7d Jc] [4s]
Hero: checks
`

const RIVER_CHECK_HH = `${TURN_CHECK_HH}Dave: checks
*** RIVER *** [2h 7d Jc 4s] [9c]
Hero: checks
`

describe('parseHandHistoryToPostflopSetup', () => {
  it('fast-forwards to a flop decision', () => {
    const result = parseHandHistoryToPostflopSetup(FLOP_CHECK_HH)
    expect(result).toEqual({
      kind: 'ok',
      setup: {
        oopPosition: 'BB',
        ipPosition: 'BTN',
        effectiveStackBb: 97,
        potBb: 6.5,
        board: ['2h', '7d', 'Jc'],
        oopAlreadyChecked: true,
      },
    })
  })

  it('fast-forwards to a turn decision, unaffected by the check-check flop', () => {
    const result = parseHandHistoryToPostflopSetup(TURN_CHECK_HH)
    expect(result).toEqual({
      kind: 'ok',
      setup: {
        oopPosition: 'BB',
        ipPosition: 'BTN',
        effectiveStackBb: 97,
        potBb: 6.5,
        board: ['2h', '7d', 'Jc', '4s'],
        oopAlreadyChecked: true,
      },
    })
  })

  it('fast-forwards to a river decision', () => {
    const result = parseHandHistoryToPostflopSetup(RIVER_CHECK_HH)
    expect(result).toEqual({
      kind: 'ok',
      setup: {
        oopPosition: 'BB',
        ipPosition: 'BTN',
        effectiveStackBb: 97,
        potBb: 6.5,
        board: ['2h', '7d', 'Jc', '4s', '9c'],
        oopAlreadyChecked: true,
      },
    })
  })

  it('reads a raise-to amount as a new total, not an addition on top of the blind', () => {
    // Eve (SB) posts 0.5, then re-raises to 10 -- her street contribution
    // must land on exactly 10, not 0.5 + 10. Dave calls Eve's re-raise;
    // Hero (BB) folds without matching the BB's own 1 already posted.
    const hh = `PokerStars Hand #4:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/01/01 12:00:00 ET
Table 'Atlas' 6-max Seat #1 is the button
Seat 1: Dave ($100 in chips)
Seat 2: Eve ($100 in chips)
Seat 3: Hero ($100 in chips)
Seat 4: Alice ($100 in chips)
Seat 5: Grace ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Hero: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [2c 3d]
Alice: folds
Grace: folds
Frank: folds
Dave: raises $2 to $3
Eve: raises $7 to $10
Hero: folds
Dave: calls $7
*** FLOP *** [2h 7d Jc]
Eve: checks
`
    const result = parseHandHistoryToPostflopSetup(hh)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.setup.potBb).toBe(21)
      expect(result.setup.effectiveStackBb).toBe(90)
      expect(result.setup.oopPosition).toBe('SB')
      expect(result.setup.ipPosition).toBe('BTN')
    }
  })

  it('rejects a hand that never reaches the flop', () => {
    const result = parseHandHistoryToPostflopSetup(VS_RAISE_HH)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/never reaches the flop/i)
    }
  })

  it('rejects when more than two players are still live', () => {
    const hh = FLOP_CHECK_HH.replace('Grace: folds', 'Grace: calls $3')
    const result = parseHandHistoryToPostflopSetup(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/3 players are still in the hand/i)
    }
  })

  it('rejects when the target street already has betting action past one check', () => {
    const hh = FLOP_CHECK_HH + 'Dave: bets $5\n'
    const result = parseHandHistoryToPostflopSetup(hh)
    expect(result.kind).toBe('unrecognized')
    if (result.kind === 'unrecognized') {
      expect(result.reason).toMatch(/already betting action/i)
    }
  })
})
