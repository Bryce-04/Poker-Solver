#!/usr/bin/env bash
# PreToolUse guard: packages/schema/generated/** is produced by
# `pnpm generate` (see packages/schema/package.json) from
# packages/schema/src/poker_solver_schema/models.py and must never be
# hand-edited — a hand edit just gets silently overwritten next regen.
#
# No jq dependency on purpose (not guaranteed present on every teammate's
# machine) — file_path is pulled out with sed instead.
set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p')"
# JSON escapes backslashes as \\, and Windows paths use \ as the separator
# either way, so collapse any run of \ or / into a single / before matching.
normalized="$(printf '%s' "$file_path" | tr '\\' '/' | tr -s '/')"

case "$normalized" in
  */packages/schema/generated/*)
    reason='packages/schema/generated/** is generated output (Pydantic models -> JSON Schema -> TypeScript), not source. Edit packages/schema/src/poker_solver_schema/models.py instead, then run `pnpm generate` in packages/schema to regenerate it.'
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
    ;;
esac
