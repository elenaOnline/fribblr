# Drawxide whiteboard: what is in `pkg/`

`pkg/wasm_bridge_bg.wasm` and `pkg/wasm_bridge.js` are a compiled build of the
Iron Drawxide engine (github.com/elenaOnline/iron-drawxide), its GPUI-free core
plus `examples/wasm-bridge`, built for `wasm32-unknown-unknown` with
wasm-bindgen 0.2.120 from engine commit 83ee56a7. Iron Drawxide is the fribblr owner's
own project; they approved shipping this build inside fribblr on 2026-11-23.

The build embeds the fonts the engine draws text with, all under the SIL Open
Font License 1.1: IBM Plex Sans, Serif and Mono (Medium and Bold, with italics)
and Shantell Sans Informal. None came from tldraw's repository, CDN or package.
Their licence texts and sources are in the engine repository under
`crates/drawxide-text/assets/fonts/`.

To rebuild: `scripts/drawxide-engine.sh /path/to/iron-drawxide --build`.
This is a proof of concept. fribblr otherwise has no build step and no runtime
dependencies, and nothing here loads unless a whiteboard is opened.
