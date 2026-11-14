#!/bin/sh
# Smoke test of the doorways. This runs REAL model inference (it loads a model). Needs curl and jq. Writes nothing.
: "${FOLD_PORT:=11436}"
BASE="http://127.0.0.1:${FOLD_PORT}"
set -e
echo "== roster =="; curl -fsS "$BASE/v1/models" | jq -r '.data[].id'
echo "== openai chat =="; curl -fsS "$BASE/v1/chat/completions" -H 'content-type: application/json' -d '{"model":"fold:gemma2:2b","messages":[{"role":"user","content":"Reply with exactly: fold ok"}]}' | jq -r '.choices[0].message.content'
echo "== simplest door =="; curl -fsS "$BASE/v1/ask" -H 'content-type: application/json' -d '{"task":"Reply with exactly: fold ok"}' | jq -r '.answer'
