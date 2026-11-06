"""The tools Gemini can call (docs/coach.md §4): their declarations, sent with
every request, and the Python that runs them.

Executors store their cards as they go, through `ToolContext.store`, and
return a small dict the model reads. Cards are built here from tool results,
never from the model's text.

Phase 2 runs describe_spot, give_general_advice and suggest_followups. The
solver tools are declared already, so the prompt doesn't change in Phase 3, but
for now they answer that the solver isn't connected yet.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import UUID

from poker_solver_schema import Spot

from . import spot_builder

log = logging.getLogger("ask_coach")

MAX_ADVICE_PARAS = 3
MAX_ADVICE_CHARS = 700
MAX_SUGGESTIONS = 3
MAX_SUGGESTION_CHARS = 40
SOLVER_NOT_CONNECTED = (
    "The solver isn't connected to the Coach yet, so there's no solver answer for this spot. "
    "That's coming in an update."
)

_SEATS = {"type": "STRING", "enum": spot_builder.SIX_MAX}

DECLARATIONS: list[dict] = [
    {
        "name": "describe_spot",
        "description": (
            "Record the spot the user described, heads-up. Call it before any solver tool. The "
            "backend computes the pot and stacks itself. Returns the street, who is to act, a "
            "summary, and `problems`: if any, ask the user about the first one instead of going on."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "hero_position": {**_SEATS, "description": "The user's seat."},
                "villain_position": {**_SEATS, "description": "The opponent's seat."},
                "effective_stack_bb": {"type": "NUMBER", "description": "Effective stack in big blinds. Omit for 100."},
                "hero_hand": {
                    "type": "STRING",
                    "description": (
                        'The user\'s two cards with suits ONLY if the user wrote suits ("AhQd"); otherwise '
                        'a hand type ("AQo", "AKs", "TT"). Never invent suits.'
                    ),
                },
                "board": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": 'Board cards like "Qs", in order: 0, 3, 4 or 5 of them.',
                },
                "preflop": {
                    "type": "OBJECT",
                    "description": "How the preflop betting went, heads-up.",
                    "properties": {
                        "line": {
                            "type": "STRING",
                            "enum": list(spot_builder.CLOSED_LINES + spot_builder.DECISION_LINES),
                            "description": (
                                "Preflop betting that FINISHED (there is a flop): open_call (raise, call), "
                                "three_bet_call (open, 3-bet, call), four_bet_call (open, 3-bet, 4-bet, call). "
                                "The user ASKING what to do preflop: unopened (folded to them), facing_open "
                                "(the opponent opened), facing_three_bet (the user opened, the opponent 3-bet). "
                                "Who raised is worked out from the seats."
                            ),
                        },
                        "open_size_bb": {"type": "NUMBER", "description": "The open, raised to, in bb. Omit for 2.5."},
                        "three_bet_size_bb": {"type": "NUMBER", "description": "The 3-bet, raised to, in bb. Omit for 3x the open."},
                        "four_bet_size_bb": {"type": "NUMBER", "description": "The 4-bet, raised to, in bb."},
                    },
                    "required": ["line"],
                },
                "postflop_actions": {
                    "type": "ARRAY",
                    "description": (
                        "Every action after the flop, in order, checks included: 'checked to me' is the "
                        "opponent's check, 'check-raised' is a check then a raise. The out-of-position "
                        "player acts first on each street. Omit if none yet."
                    ),
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "street": {"type": "STRING", "enum": ["flop", "turn", "river"]},
                            "actor": {"type": "STRING", "enum": ["hero", "villain"]},
                            "action": {"type": "STRING", "enum": ["check", "bet", "call", "raise", "fold", "all_in"]},
                            "amount_bb": {
                                "type": "NUMBER",
                                "description": "For a bet, its size in bb; for a raise, the total it raised TO on this street.",
                            },
                        },
                        "required": ["street", "actor", "action"],
                    },
                },
                "assumptions": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": 'Every default or guess you made, short ("100bb stacks", "2.5bb open", "rainbow flop").',
                },
            },
            "required": ["hero_position", "preflop"],
        },
    },
    {
        "name": "get_preflop_strategy",
        "description": "The solver's preflop play for the user's hand in the current spot (a spot with no board). No arguments.",
    },
    {
        "name": "solve_current_spot",
        "description": "Solve the current spot (it needs a board) and return the play for the user's hand. Takes 10-90 seconds. No arguments.",
    },
    {
        "name": "give_general_advice",
        "description": (
            "Show general poker advice that is NOT from the solver, in a box labeled that way. For "
            "conceptual questions, or spots the solver can't handle. At most 3 short paragraphs."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {"paras": {"type": "ARRAY", "items": {"type": "STRING"}}},
            "required": ["paras"],
        },
    },
    {
        "name": "suggest_followups",
        "description": "Offer up to 3 short follow-up questions the user can tap (each under 40 characters).",
        "parameters": {
            "type": "OBJECT",
            "properties": {"items": {"type": "ARRAY", "items": {"type": "STRING"}}},
            "required": ["items"],
        },
    },
]


@dataclass
class ToolContext:
    """What a turn's tools can see and do."""

    conversation_id: UUID
    # Stores a card: (kind, payload, title_if_untitled_or_auto).
    store: Callable[[str, dict, str | None], None]
    # A spot parsed from a pasted hand history, sent with the user's message.
    attached_spot: Spot | None = None
    # The latest spot card's payload: what follow-ups are about.
    current_spot: dict | None = None
    # Everything the user has written in this conversation, to check the model
    # didn't invent the suits of their hand (spot_builder.keep_only_written_suits).
    user_texts: list[str] = field(default_factory=list)
    # The general advice shown this turn, so the runner can drop the model
    # repeating it as its own (unlabeled) text.
    advice_paras: list[str] = field(default_factory=list)
    called: list[str] = field(default_factory=list)


def execute(name: str, args: dict | None, ctx: ToolContext) -> dict:
    """Runs one tool call. Never raises: a failure is a result the model reads."""
    ctx.called.append(name)
    handler = _HANDLERS.get(name)
    if handler is None:
        log.info("ask_coach: unknown tool %s conversation=%s", name, ctx.conversation_id)
        return {"ok": False, "reason": f"There is no tool called {name}."}
    try:
        result = handler(args or {}, ctx)
    except Exception as e:
        log.exception("ask_coach: tool %s failed conversation=%s (%s)", name, ctx.conversation_id, type(e).__name__)
        return {"ok": False, "reason": "That tool failed on our side."}
    log.info("ask_coach: tool %s ok=%s conversation=%s", name, result.get("ok"), ctx.conversation_id)
    return result


def _describe_spot(args: dict, ctx: ToolContext) -> dict:
    note = None
    if args.get("hero_hand"):
        given, _ = spot_builder.normalize_hand(args["hero_hand"])
        kept, changed = spot_builder.keep_only_written_suits(given, ctx.user_texts)
        if changed:
            log.info("ask_coach: describe_spot dropped invented suits conversation=%s", ctx.conversation_id)
            args = {**args, "hero_hand": kept}
            note = f"The user didn't write those suits, so the hand is {kept}. Don't mention suits for it."
    if ctx.attached_spot is not None:
        d = spot_builder.from_attached(ctx.attached_spot, args)
    else:
        d = spot_builder.describe(args)
    if not d.ok:
        return {"ok": False, "problems": d.problems}
    villain = next(p for p in (pos.value for pos in d.spot.positions_in_hand) if p != d.hero_position)
    payload = {
        "spot": d.spot.model_dump(mode="json"),
        "hero_position": d.hero_position,
        "hero_hand": d.hero_hand,
        "facts": d.facts,
        "assumptions": d.assumptions,
        "summary": d.summary,
    }
    ctx.store("spot_card", payload, spot_builder.title_for(d.hero_position, d.hero_hand, villain, d.spot.board))
    ctx.current_spot = payload
    return {
        "ok": True,
        "street": d.spot.current_street.value,
        "to_act": d.to_act,
        "summary": d.summary,
        "assumptions": d.assumptions,
        "problems": [],
        **({"note": note} if note else {}),
    }


def _solver_not_connected(args: dict, ctx: ToolContext) -> dict:
    if ctx.current_spot is None:
        return {"ok": False, "reason": "No spot yet: call describe_spot first."}
    return {"ok": False, "reason": SOLVER_NOT_CONNECTED}


def _clean(items, max_items: int, max_chars: int, *, drop_long: bool) -> list[str]:
    out: list[str] = []
    for item in items or []:
        text = " ".join(str(item).split())
        if not text:
            continue
        if len(text) > max_chars:
            if drop_long:
                continue
            text = text[: max_chars - 1].rstrip() + "…"
        if text not in out:
            out.append(text)
        if len(out) == max_items:
            break
    return out


def _give_general_advice(args: dict, ctx: ToolContext) -> dict:
    paras = _clean(args.get("paras"), MAX_ADVICE_PARAS, MAX_ADVICE_CHARS, drop_long=False)
    if not paras:
        return {"ok": False, "reason": "No advice given."}
    ctx.store("general_advice", {"paras": paras}, None)
    ctx.advice_paras += paras
    return {"ok": True}


def _suggest_followups(args: dict, ctx: ToolContext) -> dict:
    items = _clean(args.get("items"), MAX_SUGGESTIONS, MAX_SUGGESTION_CHARS, drop_long=True)
    if not items:
        return {"ok": False, "reason": "Each suggestion must be under 40 characters."}
    ctx.store("suggestions", {"items": items}, None)
    return {"ok": True}


_HANDLERS = {
    "describe_spot": _describe_spot,
    "get_preflop_strategy": _solver_not_connected,
    "solve_current_spot": _solver_not_connected,
    "give_general_advice": _give_general_advice,
    "suggest_followups": _suggest_followups,
}
