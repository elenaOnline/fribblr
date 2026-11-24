/* @ts-self-types="./wasm_bridge.d.ts" */

/**
 * One editor with tldraw's default shapes, tools and overlays.
 */
export class Whiteboard {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WhiteboardFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_whiteboard_free(ptr, 0);
    }
    /**
     * The window lost focus: interrupt what is in progress (held keys
     * are the page's to release with `key_up`).
     * @param {number} now
     */
    blur(now) {
        wasm.whiteboard_blur(this.__wbg_ptr, now);
    }
    /**
     * @returns {boolean}
     */
    can_redo() {
        const ret = wasm.whiteboard_can_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    can_undo() {
        const ret = wasm.whiteboard_can_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    cancel() {
        wasm.whiteboard_cancel(this.__wbg_ptr);
    }
    /**
     * Bumps whenever the document (not the session: camera, selection)
     * changes: a page debounces saves on it.
     * @returns {number}
     */
    change_count() {
        const ret = wasm.whiteboard_change_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    delete_selected() {
        wasm.whiteboard_delete_selected(this.__wbg_ptr);
    }
    /**
     * The bundled fonts (tldraw_draw, _sans, _serif, _mono; 16 faces,
     * about 5 MB) as `@font-face` rules with data URLs.
     * @returns {string}
     */
    static font_faces_css() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_font_faces_css();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * One display frame at page time `now`: moves the clock, ticks the
     * editor, and returns what to paint (module docs), or `""` when the
     * picture is the same as the last frame's.
     * @param {number} now
     * @returns {string}
     */
    frame(now) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_frame(this.__wbg_ptr, now);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * tldraw `getSnapshot`: `{ document, session }` (with the camera and
     * selection).
     * @returns {string}
     */
    get_snapshot() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_get_snapshot(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Inserts text into the edited label at the selection (a paste as
     * plain text, an IME commit).
     * @param {string} text
     */
    insert_text(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.whiteboard_insert_text(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Whether a label is being edited (the page routes keys and the
     * clipboard to the text).
     * @returns {boolean}
     */
    is_editing_text() {
        const ret = wasm.whiteboard_is_editing_text(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * A DOM `keydown`, through the edited label's text editor (while one
     * is edited: typing, arrows, ⌘B…, Enter, Escape), then tldraw's
     * keyboard shortcuts (tool letters, ⌘Z / ⌘⇧Z, Delete, ⌘A, Escape…)
     * and the tools. A typed character is inserted here (there is no
     * platform text input). Returns 1 when handled (the page should
     * `preventDefault`), else 0. IME: send composed text with
     * [`insert_text`](Self::insert_text) instead.
     * @param {string} key
     * @param {string} code
     * @param {number} mods
     * @param {boolean} repeat
     * @param {number} now
     * @returns {number}
     */
    key_down(key, code, mods, repeat, now) {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(code, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.whiteboard_key_down(this.__wbg_ptr, ptr0, len0, ptr1, len1, mods, repeat, now);
        return ret >>> 0;
    }
    /**
     * A DOM `keyup`.
     * @param {string} key
     * @param {string} code
     * @param {number} mods
     * @param {number} now
     */
    key_up(key, code, mods, now) {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(code, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.whiteboard_key_up(this.__wbg_ptr, ptr0, len0, ptr1, len1, mods, now);
    }
    /**
     * tldraw `loadSnapshot` (a `{ document, session }` or `{ store, schema }`).
     * @param {string} json
     */
    load_snapshot(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.whiteboard_load_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Replaces the document with a `.tldr` file (migrated to the current
     * schema; history cleared). On error nothing changes.
     * @param {string} json
     */
    load_tldr(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.whiteboard_load_tldr(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * An empty document in a `width` × `height` CSS-px canvas.
     * @param {number} width
     * @param {number} height
     */
    constructor(width, height) {
        const ret = wasm.whiteboard_new(width, height);
        this.__wbg_ptr = ret;
        WhiteboardFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * A DOM pointer event: `kind` 0 down, 1 move, 2 up, 3 cancel (an up,
     * then the editor's `cancel`). `pressure` 0..1 (0.5 for a mouse; 0 for
     * a move with no button held), `button` the DOM button (macOS
     * ctrl-click: pass 2), `pointer_id` 1 for the mouse, 2 for a pen.
     * Moves wait for the next frame; the rest is processed at once. For
     * the draw tools ([`uses_coalesced_events`](Self::uses_coalesced_events))
     * send every `getCoalescedEvents()` sample.
     * @param {number} kind
     * @param {number} x
     * @param {number} y
     * @param {number} pressure
     * @param {number} button
     * @param {number} pointer_id
     * @param {boolean} is_pen
     * @param {number} mods
     * @param {number} now
     * @param {number} clicks
     */
    pointer(kind, x, y, pressure, button, pointer_id, is_pen, mods, now, clicks) {
        wasm.whiteboard_pointer(this.__wbg_ptr, kind, x, y, pressure, button, pointer_id, is_pen, mods, now, clicks);
    }
    /**
     * A mouse down / move / up at the current clock (Node tests).
     * @param {number} x
     * @param {number} y
     * @param {number} mods
     */
    pointer_down(x, y, mods) {
        wasm.whiteboard_pointer_down(this.__wbg_ptr, x, y, mods);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} mods
     */
    pointer_move(x, y, mods) {
        wasm.whiteboard_pointer_move(this.__wbg_ptr, x, y, mods);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} mods
     */
    pointer_up(x, y, mods) {
        wasm.whiteboard_pointer_up(this.__wbg_ptr, x, y, mods);
    }
    redo() {
        wasm.whiteboard_redo(this.__wbg_ptr);
    }
    /**
     * What to paint now, without ticking (`""` if unchanged).
     * @returns {string}
     */
    render() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_render(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Forgets what the page has been sent: the next frame carries every
     * node and the overlays (after the page lost its caches).
     */
    reset_frames() {
        wasm.whiteboard_reset_frames(this.__wbg_ptr);
    }
    /**
     * The canvas was resized (CSS px).
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        wasm.whiteboard_resize(this.__wbg_ptr, width, height);
    }
    /**
     * The document as a `.tldr` file (JSON), as tldraw saves it.
     * @returns {string}
     */
    save_tldr() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_save_tldr(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    select_all() {
        wasm.whiteboard_select_all(this.__wbg_ptr);
    }
    /**
     * Sets the camera (`screen = (page + (x, y)) * z`).
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    set_camera(x, y, z) {
        wasm.whiteboard_set_camera(this.__wbg_ptr, x, y, z);
    }
    /**
     * The caret's blink phase (the page toggles it every 500 ms while
     * editing, and shows it after each key).
     * @param {boolean} visible
     */
    set_caret_visible(visible) {
        wasm.whiteboard_set_caret_visible(this.__wbg_ptr, visible);
    }
    /**
     * The geo tool's next shape: `rectangle`, `ellipse`, `triangle`,
     * `diamond`, `star`, `cloud`, `arrow-right`, … (tldraw's geo kinds).
     * @param {string} kind
     */
    set_geo(kind) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.whiteboard_set_geo(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The pointer entered (`pointerenter`) or left (`pointerleave`) the
     * canvas: hover indicators show only while it is over it. Any pointer
     * event sets it.
     * @param {boolean} hovering
     */
    set_hovering(hovering) {
        wasm.whiteboard_set_hovering(this.__wbg_ptr, hovering);
    }
    /**
     * Whether the page runs on macOS (default true): ⌘ is the shortcut
     * key, and shift does not turn a vertical wheel horizontal. (The
     * engine's own `cfg!(target_os = "macos")` is false in wasm.)
     * @param {boolean} mac
     */
    set_mac(mac) {
        wasm.whiteboard_set_mac(this.__wbg_ptr, mac);
    }
    /**
     * Sets a style for the next shapes (`tldraw:color` = `"red"`, …), as
     * a JSON value.
     * @param {string} style_id
     * @param {string} value_json
     */
    set_style(style_id, value_json) {
        const ptr0 = passStringToWasm0(style_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(value_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.whiteboard_set_style(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * Selects a tool by tldraw id: `select`, `hand`, `draw`, `eraser`,
     * `arrow`, `text`, `note`, `line`, `frame`, `geo`, `highlight`, `laser`.
     * @param {string} id
     */
    set_tool(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.whiteboard_set_tool(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The current page's shape records as JSON (tldraw's record format).
     * @returns {string}
     */
    shapes_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_shapes_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * A frame of `elapsed_ms` without a page clock (tests and Node): the
     * clock moves by `elapsed_ms`. Returns nothing; call
     * [`render`](Self::render) for the picture.
     * @param {number} elapsed_ms
     */
    tick(elapsed_ms) {
        wasm.whiteboard_tick(this.__wbg_ptr, elapsed_ms);
    }
    /**
     * The current tool state path (`select.idle`, `draw.drawing`).
     * @returns {string}
     */
    tool_path() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.whiteboard_tool_path(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    undo() {
        wasm.whiteboard_undo(this.__wbg_ptr);
    }
    /**
     * Whether the current tool wants every coalesced pointer sample.
     * @returns {boolean}
     */
    uses_coalesced_events() {
        const ret = wasm.whiteboard_uses_coalesced_events(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the page should keep requesting animation frames: a pointer
     * is down, input came in the last second, events or timers wait, the
     * camera moves, a scribble fades, or the canvas edge-scrolls.
     * @param {number} now
     * @returns {boolean}
     */
    wants_frames(now) {
        const ret = wasm.whiteboard_wants_frames(this.__wbg_ptr, now);
        return ret !== 0;
    }
    /**
     * A DOM wheel event (`deltaX`, `deltaY`, `deltaMode`), normalized as
     * tldraw's `normalizeWheel`: it pans, and zooms with ctrl, alt or meta
     * held (Chrome's trackpad pinch is a ctrl wheel). Waits for the next
     * frame.
     * @param {number} x
     * @param {number} y
     * @param {number} delta_x
     * @param {number} delta_y
     * @param {number} delta_mode
     * @param {number} mods
     * @param {number} now
     */
    wheel(x, y, delta_x, delta_y, delta_mode, mods, now) {
        wasm.whiteboard_wheel(this.__wbg_ptr, x, y, delta_x, delta_y, delta_mode, mods, now);
    }
}
if (Symbol.dispose) Whiteboard.prototype[Symbol.dispose] = Whiteboard.prototype.free;

/**
 * Panics abort on wasm32-unknown-unknown (the engine's `catch_unwind`
 * containment cannot catch them): report the message before the trap.
 */
export function start() {
    wasm.start();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_9c75d47bf9e7731e: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_787e04c3fda68ff2: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_3f44b700395062e5: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wasm_bridge_bg.js": import0,
    };
}

const WhiteboardFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_whiteboard_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wasm_bridge_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
