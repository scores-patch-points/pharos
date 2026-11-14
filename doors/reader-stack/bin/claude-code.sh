#!/bin/sh
# Run Claude Code through the fold's Anthropic-compatible door. Process-local; writes nothing.
: "${FOLD_PORT:=11436}"
export ANTHROPIC_BASE_URL="http://127.0.0.1:${FOLD_PORT}"
export ANTHROPIC_MODEL="${FOLD_MODEL:-fold:opencode/claude-sonnet-4-6}"
export ANTHROPIC_SMALL_FAST_MODEL="${FOLD_SMALL_MODEL:-fold:opencode/claude-haiku-4-5}"
export ANTHROPIC_API_KEY="not-needed"   # any non-empty value; overrides a real key for this child only
exec claude "$@"
