#!/bin/sh
# Drawxide proof of concept: copies the Iron Drawxide wasm bridge build into
# public/drawxide/pkg/, where the whiteboard page loads it.
#
#   scripts/drawxide-engine.sh /path/to/iron_drawxide-checkout [--build]
#
# The checkout must have examples/wasm-bridge (branch fribblr-poc). --build runs
# its build.sh first (needs the wasm32-unknown-unknown target and
# wasm-bindgen-cli 0.2.120). Without --build it copies the existing pkg/.
set -eu
engine=${1:?usage: drawxide-engine.sh ENGINE_CHECKOUT [--build]}
here=$(cd "$(dirname "$0")/.." && pwd)
bridge="$engine/examples/wasm-bridge"
[ -d "$bridge" ] || { echo "no examples/wasm-bridge in $engine" >&2; exit 1; }
if [ "${2:-}" = "--build" ]; then "$bridge/build.sh"; fi
mkdir -p "$here/public/drawxide/pkg"
cp "$bridge/pkg/wasm_bridge.js" "$bridge/pkg/wasm_bridge_bg.wasm" "$here/public/drawxide/pkg/"
ls -l "$here/public/drawxide/pkg/wasm_bridge_bg.wasm"
