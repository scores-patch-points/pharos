#!/bin/sh
# Use the ollama CLI against the fold's gated channel. Process-local; writes nothing.
: "${FOLD_CHANNEL_PORT:=11434}"
export OLLAMA_HOST="http://127.0.0.1:${FOLD_CHANNEL_PORT}"
exec ollama "$@"
