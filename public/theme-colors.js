import {drawingColor, isDrawingColor, isHexDrawingColor} from "./drawing-palette.js";
import {onThemeChange, token} from "./tokens.js";

export const appearanceThemes = ["light", "dark"];

// The theme's own colours come from tokens.css, by role. "light" is the desk: the white ground only lightens what
// stands on it and every ink the light appearance uses is dark, so a contrast that holds on the desk holds on white.
// Each appearance is read from an off-screen probe (tokens.css [data-token-probe]), so both are known whichever one
// <html> shows. Outside a browser (node tests) the same tokens are used, written out.
const roles = {canvas: "--ground", deep: "--ground-deep", paper: "--fill-paper", tint: "--fill-tint", strong: "--fill-strong",
  ink: "--ink", muted: "--ink-2", edge: "--line-edge", select: "--mark-blue"};
const written = {
  light: {canvas: "#dae5ec", deep: "#c5d3dc", paper: "#ffffff", tint: "#c5d3dc", strong: "#3b5360", ink: "#000000", muted: "#595959", edge: "#9f9f9f", select: "#005e8b"},
  dark: {canvas: "#1c2328", deep: "#151b1f", paper: "#2a3136", tint: "#151b1f", strong: "#4a6170", ink: "#e9edf0", muted: "#a7b1b8", edge: "#69757e", select: "#4ba3d6"},
};
let resolved = null, probes = null, pixel = null, listening = false;
const stepped = new Map();
function probe(theme) {
  probes ||= {};
  if (!probes[theme]?.isConnected) {
    const element = document.createElement("i");
    element.hidden = true;
    element.dataset.tokenProbe = theme;
    document.head.append(element);
    probes[theme] = element;
  }
  return probes[theme];
}
// Any CSS colour (a token, a relative colour) as #rrggbb, through the browser's own colour engine.
function cssColor(value, theme) {
  const element = probe(theme);
  element.style.color = "";
  element.style.color = value;
  pixel ||= document.createElement("canvas").getContext("2d", {willReadFrequently: true});
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = "#000";
  pixel.fillStyle = getComputedStyle(element).color;
  pixel.fillRect(0, 0, 1, 1);
  return hex([...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)]);
}
const inBrowser = () => typeof document !== "undefined" && !!document.head;
function themeColors() {
  if (resolved) return resolved;
  if (!inBrowser() || !token("--ground", probe("light"))) return written;   // tokens.css not applied yet: read again later
  resolved = Object.fromEntries(appearanceThemes.map(theme => [theme,
    Object.fromEntries(Object.entries(roles).map(([role, name]) => [role, cssColor(`var(${name})`, theme)]))]));
  if (!listening) { listening = true; onThemeChange(() => { resolved = null; stepped.clear(); }); }
  return resolved;
}
export const themeColor = (role, theme) => themeColors()[theme][role];
const byTheme = role => ({get light() { return themeColor(role, "light"); }, get dark() { return themeColor(role, "dark"); }});
const canvas = byTheme("canvas");
export const themePaper = byTheme("paper");
// A Text block's fill options keep upstream's stored names; each is the theme's colour for that job (tokens.css --fill-*).
export const textFillColors = {paper: themePaper, tint: byTheme("tint"), strong: byTheme("strong")};
export const textFillToken = value => Object.hasOwn(textFillColors, value) ? `var(--fill-${value})` : null;
// A drawing saved with no valid colour shows the palette's desk blue-grey (what new shapes are stored with);
// a text with no ink takes the theme's ink, a border with no colour the edge grey.
export const fallbackDrawingColor = "palette:slate";
export const fallbackInk = theme => themeColor("ink", theme);
export const fallbackEdge = theme => themeColor("edge", theme);

// A container is a tray cut into the ground (depth.css): its floor is one step down (the desk family's own step,
// tokens.css --desk-deep) from the ground when she gave it no colour (upstream's default for a new container counts as
// none), else from the ground tinted a little toward her hue's fill: a coloured tray stays a piece of the desk, quieter
// than what it holds; its rim carries the hue (whiteboard.css).
// `paint` is the CSS that paints the floor live on either ground; `fill` is that floor on the desk, for the contrast maths.
export const plainContainerColor = "#dbe5d3";
const trayTint = .22;
export function trayFloor(color, theme) {
  if (!isDrawingColor(color) || color.toLowerCase() === plainContainerColor)
    return {fill: themeColor("deep", theme), opacity: 1, paint: "var(--ground-deep)"};
  const hue = hex(compositeColor(renderDrawingColor(color, "fill", theme), unpackColor(canvas[theme])[0]));
  const step = ground => `oklch(from color-mix(in oklab, ${hue} ${trayTint * 100}%, ${ground}) calc(l - .057) calc(c * 1.30) h)`;
  const paint = step("var(--ground)");
  if (!resolved) return {fill: hex(mixColor(mixColor(unpackColor(hue)[0], unpackColor(canvas[theme])[0], trayTint), [0, 0, 0], .93)), opacity: 1, paint};
  const key = theme + hue;
  if (!stepped.has(key)) stepped.set(key, cssColor(step(canvas[theme]), theme));
  return {fill: stepped.get(key), opacity: 1, paint};
}
const surfaceLightness = {board: [.13, .22], paper: [.17, .33], fill: [.20, .39]};

export function unpackColor(color) {
  let hex = color.slice(1);
  if (hex.length < 5) hex = [...hex].map(channel => channel + channel).join("");
  const colorBytes = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  return [colorBytes, hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
}

function hex(rgb, alpha = 1) {
  const bytes = alpha === 1 ? rgb : [...rgb, alpha * 255];
  return "#" + bytes.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

export function mixColor(front, back, amount) {
  return front.map((channel, index) => channel * amount + back[index] * (1 - amount));
}

export function compositeColor(color, backing, opacity = 1) {
  const [rgb, alpha] = unpackColor(color);
  return mixColor(rgb, backing, alpha * opacity);
}

export function luminance(rgb) {
  const linear = rgb.map(channel => {
    const n = channel / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

export function contrastRatio(a, b) {
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

// Move lightness while maintaining the hue. Limit the chroma to what is
// representable at the target lightness so an RGB channel never clips.
function withLightness(rgb, target) {
  const min = Math.min(...rgb), max = Math.max(...rgb);
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  const chroma = half ? Math.min(1, target / half, (255 - target) / half) : 1;
  return rgb.map(channel => Math.round(target + (channel - mid) * chroma));
}

// Keep already-dark surfaces, and compress lighter values into the role's
// usable dark range. Hue and the order of shades are retained. Foreground
// polarity flips, then the renderer checks the actual surface.
// Upstream's default item paper (stored as the "Paper" choice) is the theme's own white paper; the stored value is kept.
export const defaultItemPaper = "#f6f7f1";
const isDefaultPaper = value => typeof value === "string" && value.toLowerCase() === defaultItemPaper;

export function renderDrawingColor(value, role, theme) {
  if (role === "paper" && isDefaultPaper(value)) return themePaper[theme];
  const surface = surfaceLightness[role];
  if (theme !== "dark" || !isHexDrawingColor(value))
    return drawingColor(value, surface ? "fill" : role, theme);
  const [rgb, alpha] = unpackColor(value);
  const lightness = (Math.min(...rgb) + Math.max(...rgb)) / 510;
  if (surface && lightness <= surface[0]) return value;
  const target = surface ? surface[0] + (lightness - surface[0]) * (surface[1] - surface[0]) / (1 - surface[0]) :
    1 - lightness;
  return hex(withLightness(rgb, target * 255), alpha);
}

export function canvasBackdrop(color, theme) {
  const [base] = unpackColor(canvas[theme]);
  const fill = renderDrawingColor(color, "board", theme);
  return fill ? compositeColor(fill, base) : base;
}

export function boardColorVariables(value) {
  if (!isHexDrawingColor(value)) return {};
  return Object.fromEntries(appearanceThemes.flatMap(theme => {
    const backing = canvasBackdrop(value, theme);
    const ring = readableColor(themeColor("select", theme), [backing], 3).color;   // the selection line on this colour
    return [[`--board-color-${theme}`, hex(backing)], [`--board-ring-${theme}`, ring],
      [`--board-pattern-${theme}`, surfaceInk(backing, theme)]];
  }));
}

export function textFillColor(value, theme) {
  return Object.hasOwn(textFillColors, value) ? textFillColors[value][theme] :
    renderDrawingColor(value, "fill", theme);
}

// Find the smallest lightness shift that can read across the sampled surfaces.
// At a boundary where neither polarity can satisfy every sample, maximize the
// weakest contrast. The caller can give that case a contrasting outline.
export function readableColor(color, backdrops, minimum) {
  const backgrounds = backdrops.map(luminance);
  const [rgb, alpha] = unpackColor(color);
  const contrast = (candidate, opacity = 1) => Math.min(...backgrounds.map((background, index) =>
    contrastRatio(luminance(mixColor(candidate, backdrops[index], opacity)), background)));
  // Browser CSS interpolation and 8-bit channel rounding can move a value just
  // below an exact threshold. Leave a small margin for the final painted pixels.
  const target = minimum + .08;
  if (contrast(rgb, alpha) >= target) return {color, meetsContrast: true};

  let result = {rgb, contrast: contrast(rgb), distance: 0};
  for (let tone = 0; tone <= 255; tone++) {
    const candidate = withLightness(rgb, tone);
    const score = contrast(candidate);
    const distance = Math.abs(tone - (Math.min(...rgb) + Math.max(...rgb)) / 2);
    const passes = score >= target, alreadyPasses = result.contrast >= target;
    if (passes ? !alreadyPasses || distance < result.distance : !alreadyPasses && score > result.contrast)
      result = {rgb: candidate, contrast: score, distance};
  }
  return {color: hex(result.rgb), meetsContrast: result.contrast >= minimum};
}

export function surfaceInk(backing, theme, muted = false) {
  const role = muted ? "muted" : "ink", options = [themeColor(role, "light"), themeColor(role, "dark")];
  const contrast = color => contrastRatio(luminance(unpackColor(color)[0]), luminance(backing));
  const preferred = options.sort((a, b) => contrast(b) - contrast(a))[0];
  return readableColor(preferred, [backing], 4.5).color;
}

// Resolve title/caption ink against the paper after its alpha composites over
// the local backing. Provide both theme values so a toggle never rebuilds tiles.
export function paperVariables(value, backdrop = theme => canvasBackdrop(undefined, theme)) {
  if (!isHexDrawingColor(value) || isDefaultPaper(value)) return "";   // the theme's paper, drawn from its token
  return appearanceThemes.map(theme => {
    const paper = renderDrawingColor(value, "paper", theme);
    const backing = backdrop(theme);
    const surface = compositeColor(paper, backing);
    return `--item-paper-${theme}:${paper};--item-ink-${theme}:${surfaceInk(surface, theme)};--item-muted-${theme}:${surfaceInk(surface, theme, true)};`;
  }).join("");
}
