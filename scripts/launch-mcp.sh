#!/bin/sh
set -eu
JLC_EDA_PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ -n "${CODEX_MCP_NODE_PATH:-}" ]; then
  exec "$CODEX_MCP_NODE_PATH" "$JLC_EDA_PLUGIN_DIR/dist/server.mjs"
fi
exec node "$JLC_EDA_PLUGIN_DIR/dist/server.mjs"
